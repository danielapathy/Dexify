const path = require("node:path");

function createLibraryScanner({
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
}) {
  const bitrateFromQuality = (q) => {
    const s = String(q || "").toLowerCase();
    if (s === "flac") return 9;
    if (s === "mp3_320") return 3;
    if (s === "mp3_128") return 1;
    return 0;
  };

  const hasDownloadsOnDisk = () => {
    try {
      const albumDirs = listDirents(albumsRoot).filter((d) => d.isDirectory());
      for (const ent of albumDirs.slice(0, 40)) {
        const albumDir = path.join(albumsRoot, ent.name);
        const tracksDir = path.join(albumDir, "tracks");
        const hit = findFirstFileRecursive(tracksDir, AUDIO_EXTS);
        if (hit) return true;
      }
    } catch {}
    try {
      const hit = findFirstFileRecursive(orphansRoot, AUDIO_EXTS);
      if (hit) return true;
    } catch {}
    return false;
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
      const allTrackIds = (() => {
        const tracks = Array.isArray(albumJson?.tracks) ? albumJson.tracks : Array.isArray(albumJson?.tracks?.data) ? albumJson.tracks.data : [];
        const ids = [];
        const seen = new Set();
        for (const t of tracks) {
          const tid = toIdString(t?.id || t?.SNG_ID);
          if (!tid || seen.has(tid)) continue;
          seen.add(tid);
          ids.push(Number(tid));
        }
        return ids;
      })();
      next.albums[albumId] = {
        albumId: Number(albumId),
        title: String(albumJson?.title || ""),
        artist: String(albumJson?.artist?.name || albumJson?.artist?.ART_NAME || ""),
        albumJsonPath,
        coverPath,
        trackIds: [],
        allTrackIds,
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

      // Scan playlist-local mirrored tracks so the DB can survive album deletions.
      const metaByTrackId = (() => {
        const map = new Map();
        const raw = playlistJson && typeof playlistJson === "object" ? playlistJson : null;
        const tracks =
          Array.isArray(raw?.tracks) ? raw.tracks : Array.isArray(raw?.tracks?.data) ? raw.tracks.data : [];
        for (const t of tracks) {
          const tid = toIdString(t?.id || t?.SNG_ID);
          if (!tid) continue;
          map.set(tid, t);
        }
        return map;
      })();

      const playlistTracksDir = path.join(playlistDir, "tracks");
      const trackDirs = listDirents(playlistTracksDir).filter((d) => d.isDirectory());
      for (const tdir of trackDirs) {
        const trackId = toIdString(tdir.name);
        if (!trackId) continue;
        const perTrackDir = path.join(playlistTracksDir, tdir.name);
        const qualityDirs = listDirents(perTrackDir).filter((d) => d.isDirectory());
        for (const qdir of qualityDirs) {
          const q = normalizeQuality(qdir.name) || qdir.name;
          const qPath = path.join(perTrackDir, qdir.name);
          const audioPath = findFirstFileByExt(qPath, AUDIO_EXTS);
          if (!audioPath) continue;
          const st = safeStat(audioPath);
          if (!st || !st.isFile() || st.size <= 0) continue;

          const existing = next.tracks[trackId] && typeof next.tracks[trackId] === "object" ? next.tracks[trackId] : null;
          const nextEntry = existing
            ? { ...existing }
            : {
                trackId: Number(trackId),
                albumId: 0,
                qualities: {},
              };
          nextEntry.qualities = nextEntry.qualities && typeof nextEntry.qualities === "object" ? nextEntry.qualities : {};
          // Don't override album-canonical audio if we already indexed it.
          if (!nextEntry.qualities[q]) {
            const bitrate = bitrateFromQuality(q);
            const uuid = bitrate ? `playlist_${playlistId}_track_${trackId}_${bitrate}` : "";
            nextEntry.qualities[q] = { audioPath, uuid, size: st.size, mtimeMs: st.mtimeMs };
          }

          const trackJsonPath = path.join(qPath, "track.json");
          if (!nextEntry.trackJsonPath) nextEntry.trackJsonPath = trackJsonPath;

          const meta = metaByTrackId.get(trackId) || null;
          if (meta && typeof meta === "object") {
            if (!nextEntry.title) nextEntry.title = String(meta?.title || meta?.SNG_TITLE || nextEntry.title || "");
            if (!nextEntry.artist) nextEntry.artist = String(meta?.artist?.name || meta?.ART_NAME || nextEntry.artist || "");
            const albumId = Number(meta?.album?.id || meta?.ALB_ID || 0);
            if (!Number(nextEntry.albumId) && Number.isFinite(albumId) && albumId > 0) nextEntry.albumId = albumId;
          }

          next.tracks[trackId] = nextEntry;
        }
      }
    }

    setDb(next);
    try {
      writeJsonAtomic(dbPath, getDb());
    } catch {}
    return { ok: true, db: getDb() };
  };

  return { hasDownloadsOnDisk, scanAndRebuild };
}

module.exports = { createLibraryScanner };
