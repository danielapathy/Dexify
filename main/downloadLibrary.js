const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const AUDIO_EXTS = new Set([".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".wav"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return safeJsonParse(raw);
  } catch {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = `${filePath}.tmp_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function listDirents(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function toIdString(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function normalizeQuality(value) {
  const q = String(value || "").trim().toLowerCase();
  if (!q) return null;
  if (q === "flac") return "flac";
  if (q === "mp3_320" || q === "320" || q === "mp3-320") return "mp3_320";
  if (q === "mp3_128" || q === "128" || q === "mp3-128") return "mp3_128";
  return q;
}

function pickBestQuality(qualities, preferred) {
  const p = normalizeQuality(preferred);
  if (p && qualities[p]) return p;
  if (qualities.flac) return "flac";
  if (qualities.mp3_320) return "mp3_320";
  if (qualities.mp3_128) return "mp3_128";
  const keys = Object.keys(qualities || {});
  return keys[0] || null;
}

function inferAlbumCoverUrl(album) {
  if (!album || typeof album !== "object") return "";
  const candidates = [
    album.cover_xl,
    album.cover_big,
    album.cover_medium,
    album.cover_small,
    album.cover,
    album.picture_xl,
    album.picture_big,
    album.picture_medium,
    album.picture_small,
    album.picture,
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  return "";
}

async function downloadBinaryToFile(url, destPath, { timeoutMs = 15000 } = {}) {
  const u = String(url || "").trim();
  if (!u) return { ok: false, error: "missing_url" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: "http_error", status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, buf);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "fetch_failed", message: String(e?.message || e) };
  } finally {
    clearTimeout(timeout);
  }
}

function moveFileSync(fromPath, toPath) {
  ensureDir(path.dirname(toPath));
  try {
    fs.renameSync(fromPath, toPath);
    return { ok: true };
  } catch {
    try {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "move_failed", message: String(e?.message || e) };
    }
  }
}

function findFirstFileByExt(dirPath, extSet) {
  const entries = listDirents(dirPath);
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!extSet.has(ext)) continue;
    return path.join(dirPath, ent.name);
  }
  return null;
}

function findFirstFileRecursive(rootDir, extSet) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = listDirents(dir);
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!extSet.has(ext)) continue;
      return full;
    }
  }
  return null;
}

function createDownloadLibrary({ downloadsDir }) {
  const rootDir = path.join(String(downloadsDir || ""), "library");
  const albumsRoot = path.join(rootDir, "albums");
  const playlistsRoot = path.join(rootDir, "playlists");
  const orphansRoot = path.join(rootDir, "orphans");
  const stagingRoot = path.join(rootDir, "__staging");
  const dbPath = path.join(rootDir, "db.json");

  let db = null;

  const emptyDb = () => ({
    v: 1,
    updatedAt: Date.now(),
    tracks: {},
    albums: {},
    playlists: {},
  });

  const getPaths = () => ({ rootDir, albumsRoot, playlistsRoot, orphansRoot, stagingRoot, dbPath });

  const validateAudioPath = (audioPath) => {
    const p = typeof audioPath === "string" ? audioPath : "";
    if (!p) return false;
    const st = safeStat(p);
    if (!st || !st.isFile() || st.size <= 0) return false;
    return true;
  };

  const resolveTrack = ({ trackId, quality }) => {
    const id = toIdString(trackId);
    if (!id) return { ok: false, error: "bad_request" };
    if (!db) return { ok: false, error: "db_not_loaded" };

    const entry = db.tracks[id];
    if (!entry || typeof entry !== "object") return { ok: true, exists: false };

    const qualities = entry.qualities && typeof entry.qualities === "object" ? entry.qualities : {};
    const chosen = pickBestQuality(qualities, quality);
    if (!chosen) return { ok: true, exists: false };
    const q = qualities[chosen];
    const audioPath = q?.audioPath ? String(q.audioPath) : "";
    if (!validateAudioPath(audioPath)) {
      try {
        delete qualities[chosen];
        if (Object.keys(qualities).length === 0) delete db.tracks[id];
        db.updatedAt = Date.now();
        writeJsonAtomic(dbPath, db);
      } catch {}
      return { ok: true, exists: false };
    }

    return {
      ok: true,
      exists: true,
      trackId: Number(id),
      quality: chosen,
      audioPath,
      fileUrl: pathToFileURL(audioPath).href,
    };
  };

  const listDownloadedTracks = () => {
    if (!db) return { ok: false, error: "db_not_loaded" };
    const out = [];
    for (const [trackId, entry] of Object.entries(db.tracks || {})) {
      if (!entry || typeof entry !== "object") continue;
      const qualities = entry.qualities && typeof entry.qualities === "object" ? entry.qualities : {};
      const best = pickBestQuality(qualities, null);
      const q = best ? qualities[best] : null;
      const audioPath = q?.audioPath ? String(q.audioPath) : "";
      const st = audioPath ? safeStat(audioPath) : null;
      if (!st || !st.isFile() || st.size <= 0) continue;

      const trackJsonPath = typeof entry.trackJsonPath === "string" ? entry.trackJsonPath : "";
      const albumJsonPath = typeof entry.albumJsonPath === "string" ? entry.albumJsonPath : "";
      const trackJson = trackJsonPath ? readJson(trackJsonPath) : null;
      const albumJson = albumJsonPath ? readJson(albumJsonPath) : null;

      const coverPath = typeof entry.coverPath === "string" ? entry.coverPath : "";
      const coverUrl = coverPath && safeStat(coverPath)?.isFile() ? pathToFileURL(coverPath).href : "";

      const mtimeMs = Number(q?.mtimeMs) || Number(st.mtimeMs) || 0;

      out.push({
        trackId: Number(trackId),
        albumId: Number(entry.albumId) || null,
        bestQuality: best,
        qualities: Object.keys(qualities),
        audioPath,
        mtimeMs: Number.isFinite(mtimeMs) && mtimeMs > 0 ? mtimeMs : 0,
        fileUrl: pathToFileURL(audioPath).href,
        track: trackJson || null,
        album: albumJson || null,
        coverUrl: coverUrl || "",
      });
    }
    out.sort((a, b) => Number(b.trackId) - Number(a.trackId));
    return { ok: true, tracks: out };
  };

  const getAlbumDir = (albumId) => path.join(albumsRoot, toIdString(albumId) || "0");
  const getAlbumJsonPath = (albumId) => path.join(getAlbumDir(albumId), "album.json");
  const getAlbumCoverPath = (albumId) => path.join(getAlbumDir(albumId), "cover.jpg");
  const getTrackDir = ({ albumId, trackId }) => path.join(getAlbumDir(albumId), "tracks", toIdString(trackId) || "0");
  const getTrackQualityDir = ({ albumId, trackId, quality }) =>
    path.join(getTrackDir({ albumId, trackId }), normalizeQuality(quality) || "unknown");
  const getTrackJsonPath = ({ albumId, trackId, quality }) => path.join(getTrackQualityDir({ albumId, trackId, quality }), "track.json");

  const upsertDbAlbum = ({ albumId, albumJson }) => {
    const id = toIdString(albumId);
    if (!id) return;
    const existing = db.albums[id] && typeof db.albums[id] === "object" ? db.albums[id] : null;
    const next = existing ? { ...existing } : { albumId: Number(id), trackIds: [] };
    next.albumJsonPath = getAlbumJsonPath(id);
    next.coverPath = getAlbumCoverPath(id);
    next.title = String(albumJson?.title || next.title || "");
    next.artist = String(albumJson?.artist?.name || albumJson?.artist?.ART_NAME || next.artist || "");
    db.albums[id] = next;
  };

  const upsertDbTrack = ({ trackId, albumId, quality, audioPath }) => {
    const tid = toIdString(trackId);
    const aid = toIdString(albumId);
    const q = normalizeQuality(quality);
    if (!tid || !aid || !q) return;
    const existing = db.tracks[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
    const next = existing ? { ...existing } : { trackId: Number(tid), albumId: Number(aid), qualities: {} };
    next.albumId = Number(aid);
    next.trackJsonPath = getTrackJsonPath({ albumId: aid, trackId: tid, quality: q });
    next.albumJsonPath = getAlbumJsonPath(aid);
    next.coverPath = getAlbumCoverPath(aid);
    next.qualities = next.qualities && typeof next.qualities === "object" ? next.qualities : {};
    next.qualities[q] = {
      audioPath,
      size: safeStat(audioPath)?.size || 0,
      mtimeMs: safeStat(audioPath)?.mtimeMs || 0,
    };
    db.tracks[tid] = next;

    const albumEntry = db.albums[aid];
    if (albumEntry && typeof albumEntry === "object") {
      const list = Array.isArray(albumEntry.trackIds) ? albumEntry.trackIds : [];
      if (!list.includes(Number(tid))) list.push(Number(tid));
      albumEntry.trackIds = list;
    }
  };

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

  const stageDirForUuid = (_uuid) => {
    // Never leak user-facing IDs into folder names.
    // This is always temporary and will be removed after import.
    return path.join(stagingRoot, `job_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  };

  const ensureLoaded = () => {
    if (db) return { ok: true };
    ensureDir(rootDir);
    ensureDir(albumsRoot);
    ensureDir(playlistsRoot);
    ensureDir(orphansRoot);
    ensureDir(stagingRoot);

    const loaded = readJson(dbPath);
    if (loaded && typeof loaded === "object" && loaded.v === 1) {
      db = loaded;
      db.tracks = db.tracks && typeof db.tracks === "object" ? db.tracks : {};
      db.albums = db.albums && typeof db.albums === "object" ? db.albums : {};
      db.playlists = db.playlists && typeof db.playlists === "object" ? db.playlists : {};
      return { ok: true, loaded: true };
    }

    const scanRes = scanAndRebuild();
    return { ok: scanRes.ok, loaded: false };
  };

  const scanAndRebuild = () => {
    const next = emptyDb();
    ensureDir(rootDir);
    ensureDir(albumsRoot);
    ensureDir(playlistsRoot);
    ensureDir(orphansRoot);
    ensureDir(stagingRoot);

    const albumDirs = listDirents(albumsRoot).filter((d) => d.isDirectory());
    for (const ent of albumDirs) {
      const albumId = toIdString(ent.name);
      if (!albumId) continue;
      const albumDir = path.join(albumsRoot, ent.name);
      const albumJsonPath = path.join(albumDir, "album.json");
      const coverPath = findFirstFileByExt(albumDir, IMAGE_EXTS) || path.join(albumDir, "cover.jpg");

      const albumJson = readJson(albumJsonPath);
      next.albums[albumId] = {
        albumId: Number(albumId),
        title: String(albumJson?.title || ""),
        artist: String(albumJson?.artist?.name || albumJson?.artist?.ART_NAME || ""),
        albumJsonPath,
        coverPath,
        trackIds: [],
      };

      const tracksDir = path.join(albumDir, "tracks");
      const trackDirs = listDirents(tracksDir).filter((d) => d.isDirectory());
      for (const tdir of trackDirs) {
        const trackId = toIdString(tdir.name);
        if (!trackId) continue;
        const perTrackDir = path.join(tracksDir, tdir.name);
        const qualityDirs = listDirents(perTrackDir).filter((d) => d.isDirectory());
        for (const qdir of qualityDirs) {
          const q = normalizeQuality(qdir.name) || qdir.name;
          const qPath = path.join(perTrackDir, qdir.name);
          const audioPath = findFirstFileByExt(qPath, AUDIO_EXTS);
          if (!audioPath) continue;
          const st = safeStat(audioPath);
          if (!st || !st.isFile() || st.size <= 0) continue;

          const trackJsonPath = path.join(qPath, "track.json");
          const trackJson = readJson(trackJsonPath);

          const entry = next.tracks[trackId] && typeof next.tracks[trackId] === "object" ? next.tracks[trackId] : null;
          const nextEntry = entry
            ? { ...entry }
            : {
                trackId: Number(trackId),
                albumId: Number(albumId),
                qualities: {},
              };
          nextEntry.albumId = Number(albumId);
          nextEntry.trackJsonPath = trackJsonPath;
          nextEntry.albumJsonPath = albumJsonPath;
          nextEntry.coverPath = coverPath;
          nextEntry.qualities = nextEntry.qualities && typeof nextEntry.qualities === "object" ? nextEntry.qualities : {};
          nextEntry.qualities[q] = { audioPath, size: st.size, mtimeMs: st.mtimeMs };
          next.tracks[trackId] = nextEntry;

          const albumEntry = next.albums[albumId];
          if (albumEntry) {
            if (!albumEntry.trackIds.includes(Number(trackId))) albumEntry.trackIds.push(Number(trackId));
          }

          if (trackJson && typeof trackJson === "object") {
            nextEntry.title = String(trackJson?.title || trackJson?.SNG_TITLE || nextEntry.title || "");
            nextEntry.artist = String(trackJson?.artist?.name || trackJson?.ART_NAME || nextEntry.artist || "");
          }
        }
      }
    }

    const playlistDirs = listDirents(playlistsRoot).filter((d) => d.isDirectory());
    for (const ent of playlistDirs) {
      const playlistId = toIdString(ent.name);
      if (!playlistId) continue;
      const playlistDir = path.join(playlistsRoot, ent.name);
      const playlistJsonPath = path.join(playlistDir, "playlist.json");
      const itemsJsonPath = path.join(playlistDir, "items.json");
      const playlistJson = readJson(playlistJsonPath);
      const itemsJson = readJson(itemsJsonPath);
      const itemTrackIds = Array.isArray(itemsJson?.trackIds) ? itemsJson.trackIds : Array.isArray(itemsJson) ? itemsJson : [];
      next.playlists[playlistId] = {
        playlistId: Number(playlistId),
        title: String(playlistJson?.title || ""),
        playlistJsonPath,
        itemsJsonPath,
        trackIds: itemTrackIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0),
      };
    }

    db = next;
    try {
      writeJsonAtomic(dbPath, db);
    } catch {}
    return { ok: true, db };
  };

  const save = () => {
    if (!db) return { ok: false, error: "db_not_loaded" };
    db.updatedAt = Date.now();
    writeJsonAtomic(dbPath, db);
    return { ok: true };
  };

  const ensureTrackStoredFromStaging = async ({ albumId, trackId, quality, stagingDir, trackJson, albumJson }) => {
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

    upsertDbTrack({ trackId: tid, albumId: aid, quality: q, audioPath: destAudioPath });
    save();
    return { ok: true, audioPath: destAudioPath, fileUrl: pathToFileURL(destAudioPath).href };
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
    writeJsonAtomic(itemsJsonPath, { trackIds: Array.isArray(trackIds) ? trackIds : [] });
    db.playlists[pid] = {
      playlistId: Number(pid),
      title: String(playlistJson?.title || ""),
      playlistJsonPath,
      itemsJsonPath,
      trackIds: (Array.isArray(trackIds) ? trackIds : []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0),
    };
    save();
    return { ok: true, playlistJsonPath, itemsJsonPath };
  };

  return {
    getPaths,
    ensureLoaded,
    scanAndRebuild,
    resolveTrack,
    listDownloadedTracks,
    ensureAlbumMetadata,
    ensureTrackStoredFromStaging,
    ensurePlaylistMetadata,
    stageDirForUuid,
    removeDownloadForTrack,
    healMissingAlbumCovers,
  };
}

module.exports = { createDownloadLibrary, normalizeQuality, toIdString };
