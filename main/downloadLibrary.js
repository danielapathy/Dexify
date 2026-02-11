const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { readJson, ensureDir, writeJsonAtomic, safeStat, listDirents } = require("./downloadLibrary/fs");
const { createOfflineTracklistResolver } = require("./downloadLibrary/offlineTracklist");
const {
  AUDIO_EXTS,
  IMAGE_EXTS,
  toIdString,
  normalizeQuality,
  pickBestQuality,
  inferAlbumCoverUrl,
  downloadBinaryToFile,
  moveFileSync,
  findFirstFileByExt,
  findFirstFileRecursive,
} = require("./downloadLibrary/helpers");
const { createDownloadLibraryPaths } = require("./downloadLibrary/paths");
const { createDbIndexApi } = require("./downloadLibrary/dbIndex");
const { createLibraryScanner } = require("./downloadLibrary/scanner");
const { ensurePlaylistTrackMirror: ensurePlaylistTrackMirrorOnDisk } = require("./downloadLibrary/playlistMirror");

function createDownloadLibrary({ downloadsDir }) {
  const paths = createDownloadLibraryPaths({ downloadsDir, toIdString, normalizeQuality });
  const {
    rootDir,
    albumsRoot,
    playlistsRoot,
    orphansRoot,
    stagingRoot,
    dbPath,
    getPaths,
    getAlbumDir,
    getAlbumJsonPath,
    getAlbumCoverPath,
    getTrackQualityDir,
    getTrackJsonPath,
    stageDirForUuid,
  } = paths;

  let db = null;
  const getDb = () => db;
  const setDb = (next) => {
    db = next;
  };

  const { emptyDb, resolveTrack, listDownloadedTracks, listDownloadedPlaylists, upsertDbAlbum, upsertDbTrack, stampTrackUuid, save } = createDbIndexApi({
    getDb,
    dbPath,
    readJson,
    writeJsonAtomic,
    safeStat,
    pathToFileURL,
    pickBestQuality,
    toIdString,
    normalizeQuality,
    getAlbumJsonPath,
    getAlbumCoverPath,
    getTrackJsonPath,
  });

  const { hasDownloadsOnDisk, scanAndRebuild } = createLibraryScanner({
    getDb,
    setDb,
    emptyDb,
    dbPath,
    albumsRoot,
    playlistsRoot,
    orphansRoot,
    rootDir,
    stagingRoot,
    ensureDir,
    listDirents,
    readJson,
    writeJsonAtomic,
    safeStat,
    toIdString,
    normalizeQuality,
    findFirstFileByExt,
    findFirstFileRecursive,
    AUDIO_EXTS,
    IMAGE_EXTS,
  });

  function ensureLoaded() {
    if (db) return { ok: true };
    ensureDir(rootDir);
    ensureDir(albumsRoot);
    ensureDir(playlistsRoot);
    ensureDir(orphansRoot);
    ensureDir(stagingRoot);

    const loaded = readJson(dbPath);
    if (loaded && typeof loaded === "object" && loaded.v === 1) {
      setDb(loaded);
      db.tracks = db.tracks && typeof db.tracks === "object" ? db.tracks : {};
      db.albums = db.albums && typeof db.albums === "object" ? db.albums : {};
      db.playlists = db.playlists && typeof db.playlists === "object" ? db.playlists : {};

      if (Object.keys(db.tracks).length === 0 && hasDownloadsOnDisk()) {
        const scanRes = scanAndRebuild();
        return { ok: Boolean(scanRes?.ok), loaded: true, rebuilt: true };
      }

      return { ok: true, loaded: true };
    }

    const scanRes = scanAndRebuild();
    return { ok: scanRes.ok, loaded: false };
  }

  const getOfflineTracklist = createOfflineTracklistResolver({
    ensureLoaded,
    getDb,
    toIdString,
    readJson,
    safeStat,
    pathToFileURL,
    getAlbumJsonPath,
    getAlbumCoverPath,
  });

  const ensureAlbumMetadata = async ({ albumId, albumJson }) => {
    const id = toIdString(albumId);
    if (!id) return { ok: false, error: "bad_request" };
    ensureDir(getAlbumDir(id));

    const albumJsonPath = getAlbumJsonPath(id);
    const existing = readJson(albumJsonPath);
    const merged = existing && typeof existing === "object" ? { ...existing, ...(albumJson && typeof albumJson === "object" ? albumJson : {}) } : albumJson;
    if (merged && typeof merged === "object") writeJsonAtomic(albumJsonPath, merged);

    const coverPath = getAlbumCoverPath(id);
    const coverExists = safeStat(coverPath)?.isFile();
    if (!coverExists) {
      const url = inferAlbumCoverUrl(merged || albumJson);
      if (url) await downloadBinaryToFile(url, coverPath);
    }

    upsertDbAlbum({ albumId: id, albumJson: merged || albumJson || null });
    return { ok: true, albumJsonPath, coverPath };
  };

  const healMissingAlbumCovers = async ({ max = 25 } = {}) => {
    if (!db) return { ok: false, error: "db_not_loaded" };
    const limit = Number.isFinite(Number(max)) ? Math.max(0, Math.min(250, Number(max))) : 25;

    let checked = 0;
    let fixed = 0;
    let failed = 0;
    const failures = [];

    const albumIds = Object.keys(db.albums || {});
    for (const albumId of albumIds) {
      if (checked >= limit) break;
      const entry = db.albums[albumId];
      if (!entry || typeof entry !== "object") continue;

      const coverPath = typeof entry.coverPath === "string" && entry.coverPath ? entry.coverPath : getAlbumCoverPath(albumId);
      const st = safeStat(coverPath);
      checked++;
      if (st && st.isFile() && st.size > 0) continue;

      const albumJsonPath = typeof entry.albumJsonPath === "string" && entry.albumJsonPath ? entry.albumJsonPath : getAlbumJsonPath(albumId);
      const albumJson = readJson(albumJsonPath);
      const url = inferAlbumCoverUrl(albumJson);
      if (!url) {
        failed++;
        failures.push({ albumId: Number(albumId), error: "missing_cover_url" });
        continue;
      }

      const res = await downloadBinaryToFile(url, coverPath);
      if (res?.ok) fixed++;
      else {
        failed++;
        failures.push({ albumId: Number(albumId), error: res?.error || "fetch_failed" });
      }
    }

    try {
      save();
    } catch {}

    return { ok: true, checked, fixed, failed, failures };
  };

  const ensureTrackMetadata = ({ albumId, trackId, quality, trackJson }) => {
    const aid = toIdString(albumId);
    const tid = toIdString(trackId);
    const q = normalizeQuality(quality);
    if (!aid || !tid || !q) return { ok: false, error: "bad_request" };
    const p = getTrackJsonPath({ albumId: aid, trackId: tid, quality: q });
    if (trackJson && typeof trackJson === "object") writeJsonAtomic(p, trackJson);
    return { ok: true, trackJsonPath: p };
  };

  const ensureTrackStoredFromStaging = async ({ albumId, trackId, quality, stagingDir, trackJson, albumJson, uuid }) => {
    const aid = toIdString(albumId);
    const tid = toIdString(trackId);
    const q = normalizeQuality(quality);
    if (!aid || !tid || !q) return { ok: false, error: "bad_request" };

    ensureLoaded();
    await ensureAlbumMetadata({ albumId: aid, albumJson });
    ensureTrackMetadata({ albumId: aid, trackId: tid, quality: q, trackJson });

    const audioSrc = findFirstFileRecursive(stagingDir, AUDIO_EXTS);
    if (!audioSrc) return { ok: false, error: "no_audio_file" };
    const ext = path.extname(audioSrc) || (q === "flac" ? ".flac" : ".mp3");
    const destAudioPath = path.join(getTrackQualityDir({ albumId: aid, trackId: tid, quality: q }), `audio${ext}`);
    const mv = moveFileSync(audioSrc, destAudioPath);
    if (!mv.ok) return mv;

    upsertDbTrack({ trackId: tid, albumId: aid, quality: q, audioPath: destAudioPath, uuid: typeof uuid === "string" ? uuid : "" });
    save();
    const fileSize = safeStat(destAudioPath)?.size || 0;
    return { ok: true, audioPath: destAudioPath, fileUrl: pathToFileURL(destAudioPath).href, fileSize };
  };

  const removeEmptyDirsUp = (startDir, stopDir) => {
    const stop = path.resolve(String(stopDir || ""));
    let cur = path.resolve(String(startDir || ""));
    while (cur && cur !== stop && cur.startsWith(stop + path.sep)) {
      let entries = [];
      try {
        entries = fs.readdirSync(cur);
      } catch {
        break;
      }
      if (entries.length > 0) break;
      try {
        fs.rmdirSync(cur);
      } catch {
        break;
      }
      cur = path.dirname(cur);
    }
  };

  const removeDownloadForTrack = ({ trackId, quality, deleteAlbumContainer = false } = {}) => {
    ensureLoaded();
    const tid = toIdString(trackId);
    if (!tid) return { ok: false, error: "bad_request" };

    const entry = db.tracks[tid];
    if (!entry || typeof entry !== "object") return { ok: false, error: "not_found" };

    const qualities = entry.qualities && typeof entry.qualities === "object" ? entry.qualities : {};
    const q = normalizeQuality(quality);
    const targets = q ? (qualities[q] ? [q] : []) : Object.keys(qualities);
    if (targets.length === 0) return { ok: false, error: "not_found" };

    const albumId = toIdString(entry.albumId);
    for (const k of targets) {
      const item = qualities[k];
      const audioPath = item?.audioPath ? String(item.audioPath) : "";
      const trackJsonPath = (() => {
        try {
          const qDir = audioPath ? path.dirname(audioPath) : "";
          return qDir ? path.join(qDir, "track.json") : "";
        } catch {
          return "";
        }
      })();
      try {
        if (audioPath) fs.unlinkSync(audioPath);
      } catch {}
      try {
        if (trackJsonPath) fs.unlinkSync(trackJsonPath);
      } catch {}

      try {
        const qDir = audioPath ? path.dirname(audioPath) : trackJsonPath ? path.dirname(trackJsonPath) : "";
        if (qDir) removeEmptyDirsUp(qDir, albumId ? getAlbumDir(albumId) : rootDir);
      } catch {}

      delete qualities[k];
    }

    if (Object.keys(qualities).length === 0) {
      delete db.tracks[tid];
      if (albumId && db.albums[albumId] && typeof db.albums[albumId] === "object") {
        const albumEntry = db.albums[albumId];
        const ids = Array.isArray(albumEntry.trackIds) ? albumEntry.trackIds : [];
        albumEntry.trackIds = ids.filter((n) => Number(n) !== Number(tid));
      }
      const prunePlaylistMirror = ({ pid, itemsPath }) => {
        const playlistId = toIdString(pid);
        if (!playlistId) return;
        try {
          fs.rmSync(path.join(playlistsRoot, playlistId, "tracks", tid), { recursive: true, force: true });
        } catch {}
        try {
          const resolvedItemsPath =
            typeof itemsPath === "string" && itemsPath
              ? itemsPath
              : path.join(playlistsRoot, playlistId, "items.json");
          const items = readJson(resolvedItemsPath);
          if (!items || typeof items !== "object" || Array.isArray(items)) return;
          const prevTrackIds = Array.isArray(items.trackIds) ? items.trackIds : [];
          const prevDownloads = items.downloads && typeof items.downloads === "object" ? items.downloads : null;
          if (!prevDownloads || !Object.prototype.hasOwnProperty.call(prevDownloads, tid)) return;
          const nextDownloads = { ...prevDownloads };
          delete nextDownloads[tid];
          const nextTrackIds = prevTrackIds.filter((x) => String(x) !== tid);
          writeJsonAtomic(resolvedItemsPath, { trackIds: nextTrackIds, downloads: nextDownloads });
          // Also prune db.playlists trackIds to stay consistent.
          const dbPl = db.playlists[playlistId];
          if (dbPl && Array.isArray(dbPl.trackIds)) {
            dbPl.trackIds = dbPl.trackIds.filter((x) => String(x) !== tid);
          }
        } catch {}
      };
      for (const [pid, plEntry] of Object.entries(db.playlists || {})) {
        if (!plEntry || typeof plEntry !== "object") continue;
        prunePlaylistMirror({
          pid,
          itemsPath: typeof plEntry.itemsJsonPath === "string" ? plEntry.itemsJsonPath : "",
        });
      }
      // Also sweep playlist directories that may exist on disk but not in db.playlists.
      for (const ent of listDirents(playlistsRoot).filter((d) => d.isDirectory())) {
        const pid = toIdString(ent.name);
        if (!pid) continue;
        if (db.playlists && db.playlists[pid]) continue;
        prunePlaylistMirror({ pid, itemsPath: path.join(playlistsRoot, pid, "items.json") });
      }
    } else {
      entry.qualities = qualities;
      db.tracks[tid] = entry;
    }

    if (deleteAlbumContainer && albumId) {
      const albumEntry = db.albums[albumId];
      const remaining = Array.isArray(albumEntry?.trackIds) ? albumEntry.trackIds : [];
      if (remaining.length === 0) {
        try {
          fs.rmSync(getAlbumDir(albumId), { recursive: true, force: true });
        } catch {}
        delete db.albums[albumId];
      }
    }

    if (deleteAlbumContainer) {
      for (const [pid, plEntry] of Object.entries(db.playlists || {})) {
        if (!plEntry || typeof plEntry !== "object") continue;
        const plRemaining = Array.isArray(plEntry.trackIds) ? plEntry.trackIds : [];
        if (plRemaining.length > 0) continue;
        // Don't delete playlist directories that still have audio files on disk
        // (e.g. playlist mirrors that remain valid after an album-context track deletion).
        try {
          const plTracksDir = path.join(playlistsRoot, pid, "tracks");
          if (findFirstFileRecursive(plTracksDir, AUDIO_EXTS)) continue;
        } catch {}
        try {
          fs.rmSync(path.join(playlistsRoot, pid), { recursive: true, force: true });
        } catch {}
        delete db.playlists[pid];
      }
    }

    save();
    return { ok: true };
  };

  const ensurePlaylistMetadata = async ({ playlistId, playlistJson, trackIds }) => {
    ensureLoaded();
    const pid = toIdString(playlistId);
    if (!pid) return { ok: false, error: "bad_request" };
    const dir = path.join(playlistsRoot, pid);
    ensureDir(dir);
    const playlistJsonPath = path.join(dir, "playlist.json");
    const itemsJsonPath = path.join(dir, "items.json");
    if (playlistJson && typeof playlistJson === "object") writeJsonAtomic(playlistJsonPath, playlistJson);
    const existingItems = readJson(itemsJsonPath);
    const prevDownloads =
      existingItems && typeof existingItems === "object" && existingItems.downloads && typeof existingItems.downloads === "object"
        ? existingItems.downloads
        : null;
    const nextTrackIds = Array.isArray(trackIds)
      ? trackIds
      : Array.isArray(existingItems?.trackIds)
        ? existingItems.trackIds
        : Array.isArray(existingItems)
          ? existingItems
          : [];
    const nextItems = prevDownloads ? { trackIds: nextTrackIds, downloads: prevDownloads } : { trackIds: nextTrackIds };
    writeJsonAtomic(itemsJsonPath, nextItems);
    db.playlists[pid] = {
      playlistId: Number(pid),
      title: String(playlistJson?.title || ""),
      playlistJsonPath,
      itemsJsonPath,
      trackIds: nextTrackIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0),
      updatedAt: Date.now(),
    };
    save();
    return { ok: true, playlistJsonPath, itemsJsonPath };
  };

  const deleteAlbumFromDisk = ({ albumId } = {}) => {
    ensureLoaded();
    const aid = toIdString(albumId);
    if (!aid) return { ok: false, error: "bad_request" };
    try {
      fs.rmSync(getAlbumDir(aid), { recursive: true, force: true });
    } catch {}
    // Rebuild index from disk so playlist mirrors remain playable.
    try {
      scanAndRebuild();
    } catch {}
    return { ok: true, albumId: Number(aid) };
  };

  const deletePlaylistFromDisk = ({ playlistId } = {}) => {
    ensureLoaded();
    const pid = toIdString(playlistId);
    if (!pid) return { ok: false, error: "bad_request" };

    // Collect trackIds belonging to this playlist BEFORE deleting anything.
    const plEntry = db.playlists[pid] && typeof db.playlists[pid] === "object" ? db.playlists[pid] : null;
    const plTrackIds = (() => {
      const ids = new Set();
      // From db entry
      if (plEntry) {
        const arr = Array.isArray(plEntry.trackIds) ? plEntry.trackIds : [];
        for (const t of arr) { const n = toIdString(t); if (n) ids.add(n); }
      }
      // From items.json on disk
      try {
        const itemsPath = plEntry?.itemsJsonPath || path.join(playlistsRoot, pid, "items.json");
        const items = readJson(itemsPath);
        if (items && typeof items === "object") {
          const arr = Array.isArray(items.trackIds) ? items.trackIds : [];
          for (const t of arr) { const n = toIdString(t); if (n) ids.add(n); }
          // Also include tracks listed in the downloads map
          if (items.downloads && typeof items.downloads === "object") {
            for (const k of Object.keys(items.downloads)) { const n = toIdString(k); if (n) ids.add(n); }
          }
        }
      } catch {}
      return ids;
    })();

    // Delete each track's album-canonical audio files so they don't linger on disk.
    // Only delete tracks whose uuids are strictly owned by THIS playlist across
    // all qualities. Shared or unknown ownership is preserved.
    for (const tid of plTrackIds) {
      const trackEntry = db.tracks[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
      if (!trackEntry) continue;
      // Check if this track is ONLY associated with this playlist (not also downloaded
      // independently or via another playlist).  We check the uuid of each quality slot.
      const qualities = trackEntry.qualities && typeof trackEntry.qualities === "object" ? trackEntry.qualities : {};
      let onlyThisPlaylist = true;
      for (const q of Object.keys(qualities)) {
        const uuid = qualities[q]?.uuid ? String(qualities[q].uuid) : "";
        if (!uuid || !uuid.startsWith(`playlist_${pid}_track_`)) {
          // If uuid is missing or points to any other context (other playlist,
          // album, single-track, artist), treat this track as shared.
          onlyThisPlaylist = false;
          break;
        }
      }
      if (onlyThisPlaylist) {
        try {
          removeDownloadForTrack({ trackId: Number(tid), quality: null, deleteAlbumContainer: true });
        } catch {}
      }
    }

    // Now delete the playlist directory itself (mirrors, playlist.json, items.json).
    try {
      fs.rmSync(path.join(playlistsRoot, pid), { recursive: true, force: true });
    } catch {}
    // Remove from DB
    delete db.playlists[pid];
    try {
      save();
    } catch {}
    try {
      scanAndRebuild();
    } catch {}
    return { ok: true, playlistId: Number(pid) };
  };

  return {
    getPaths,
    ensureLoaded,
    scanAndRebuild,
    resolveTrack,
    listDownloadedTracks,
    listDownloadedPlaylists,
    getOfflineTracklist,
    ensureAlbumMetadata,
    ensureTrackStoredFromStaging,
    ensurePlaylistMetadata,
    ensurePlaylistTrackMirror: ({ playlistId, trackId, quality, sourceAudioPath, trackJson }) => {
      ensureLoaded();
      const res = ensurePlaylistTrackMirrorOnDisk({
        playlistsRoot,
        playlistId,
        trackId,
        quality,
        sourceAudioPath,
        trackJson,
        ensureDir,
        safeStat,
        readJson,
        writeJsonAtomic,
        toIdString,
        normalizeQuality,
      });
      if (!res?.ok) return res;

      const pid = toIdString(playlistId);
      if (!pid) return res;
      const playlistDir = path.join(playlistsRoot, pid);
      const playlistJsonPath = path.join(playlistDir, "playlist.json");
      const itemsJsonPath = path.join(playlistDir, "items.json");
      const playlistJson = readJson(playlistJsonPath);
      const items = readJson(itemsJsonPath);
      const trackIds = Array.isArray(items?.trackIds)
        ? items.trackIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
        : Array.isArray(res?.trackIds)
          ? res.trackIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
          : [];
      const existing = db.playlists[pid] && typeof db.playlists[pid] === "object" ? db.playlists[pid] : {};
      db.playlists[pid] = {
        ...existing,
        playlistId: Number(pid),
        title: String(playlistJson?.title || existing?.title || ""),
        playlistJsonPath,
        itemsJsonPath,
        trackIds,
        updatedAt: Date.now(),
      };
      try {
        save();
      } catch {}
      return res;
    },
    stageDirForUuid,
    removeDownloadForTrack,
    healMissingAlbumCovers,
    stampTrackUuid,
    deleteAlbumFromDisk,
    deletePlaylistFromDisk,
  };
}

module.exports = { createDownloadLibrary, normalizeQuality, toIdString };
