function createDbIndexApi({
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
}) {
  const emptyDb = () => ({
    v: 1,
    updatedAt: Date.now(),
    tracks: {},
    albums: {},
    playlists: {},
  });

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
    const db = getDb();
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
    const db = getDb();
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
        uuid: q?.uuid ? String(q.uuid) : "",
        bestQuality: best,
        qualities: Object.keys(qualities),
        audioPath,
        mtimeMs: Number.isFinite(mtimeMs) && mtimeMs > 0 ? mtimeMs : 0,
        fileSize: st.size || 0,
        fileUrl: pathToFileURL(audioPath).href,
        track: trackJson || null,
        album: albumJson || null,
        coverUrl: coverUrl || "",
      });
    }
    out.sort((a, b) => Number(b.trackId) - Number(a.trackId));
    return { ok: true, tracks: out };
  };

  const upsertDbAlbum = ({ albumId, albumJson }) => {
    const id = toIdString(albumId);
    if (!id) return;
    const db = getDb();
    if (!db) return;
    const existing = db.albums[id] && typeof db.albums[id] === "object" ? db.albums[id] : null;
    const next = existing ? { ...existing } : { albumId: Number(id), trackIds: [] };
    const albumTracks = Array.isArray(albumJson?.tracks) ? albumJson.tracks : Array.isArray(albumJson?.tracks?.data) ? albumJson.tracks.data : [];
    const allTrackIds = [];
    const seenAllTrackIds = new Set();
    for (const t of albumTracks) {
      const tid = toIdString(t?.id || t?.SNG_ID);
      if (!tid || seenAllTrackIds.has(tid)) continue;
      seenAllTrackIds.add(tid);
      allTrackIds.push(Number(tid));
    }
    next.albumJsonPath = getAlbumJsonPath(id);
    next.coverPath = getAlbumCoverPath(id);
    next.title = String(albumJson?.title || next.title || "");
    next.artist = String(albumJson?.artist?.name || albumJson?.artist?.ART_NAME || next.artist || "");
    if (allTrackIds.length > 0) next.allTrackIds = allTrackIds;
    db.albums[id] = next;
  };

  const upsertDbTrack = ({ trackId, albumId, quality, audioPath, uuid }) => {
    const tid = toIdString(trackId);
    const aid = toIdString(albumId);
    const q = normalizeQuality(quality);
    if (!tid || !aid || !q) return;

    const db = getDb();
    if (!db) return;
    const existing = db.tracks[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
    const next = existing ? { ...existing } : { trackId: Number(tid), albumId: Number(aid), qualities: {} };
    next.albumId = Number(aid);
    next.trackJsonPath = getTrackJsonPath({ albumId: aid, trackId: tid, quality: q });
    next.albumJsonPath = getAlbumJsonPath(aid);
    next.coverPath = getAlbumCoverPath(aid);
    next.qualities = next.qualities && typeof next.qualities === "object" ? next.qualities : {};
    const prev = next.qualities[q] && typeof next.qualities[q] === "object" ? next.qualities[q] : {};
    next.qualities[q] = {
      audioPath,
      uuid: typeof uuid === "string" && uuid ? uuid : prev?.uuid ? String(prev.uuid) : "",
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

  const listDownloadedPlaylists = () => {
    const db = getDb();
    if (!db) return { ok: false, error: "db_not_loaded" };

    const trackHasAnyAudio = (trackId0) => {
      const tid = toIdString(trackId0);
      if (!tid) return false;
      const entry = db.tracks?.[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
      if (!entry) return false;
      const qualities = entry.qualities && typeof entry.qualities === "object" ? entry.qualities : {};
      for (const q of Object.keys(qualities)) {
        const audioPath = qualities[q]?.audioPath ? String(qualities[q].audioPath) : "";
        if (validateAudioPath(audioPath)) return true;
      }
      return false;
    };

    const readPlaylistItems = (itemsJsonPath) => {
      const p = typeof itemsJsonPath === "string" ? itemsJsonPath : "";
      if (!p) return null;
      const parsed = readJson(p);
      if (Array.isArray(parsed)) {
        return { trackIds: parsed, downloads: null };
      }
      if (parsed && typeof parsed === "object") {
        return {
          trackIds: Array.isArray(parsed.trackIds) ? parsed.trackIds : [],
          downloads: parsed.downloads && typeof parsed.downloads === "object" ? parsed.downloads : null,
        };
      }
      return null;
    };

    const out = [];
    for (const [playlistId, entry] of Object.entries(db.playlists || {})) {
      if (!entry || typeof entry !== "object") continue;
      const pid = toIdString(playlistId) || toIdString(entry.playlistId);
      if (!pid) continue;

      const playlistItems = readPlaylistItems(entry.itemsJsonPath);
      const trackIds = Array.isArray(playlistItems?.trackIds) && playlistItems.trackIds.length > 0 ? playlistItems.trackIds : Array.isArray(entry.trackIds) ? entry.trackIds : [];
      const total = trackIds.length;
      let downloaded = 0;
      const downloadsMap = playlistItems?.downloads && typeof playlistItems.downloads === "object" ? playlistItems.downloads : null;
      for (const tid0 of trackIds) {
        const tid = toIdString(tid0);
        if (!tid) continue;
        const slot = downloadsMap?.[tid] && typeof downloadsMap[tid] === "object" ? downloadsMap[tid] : null;
        const audioPath = slot?.audioPath ? String(slot.audioPath) : "";
        const ok = (audioPath && validateAudioPath(audioPath)) || trackHasAnyAudio(tid);
        if (ok) downloaded += 1;
      }

      const playlistJsonPath = typeof entry.playlistJsonPath === "string" ? entry.playlistJsonPath : "";
      const playlistJson = playlistJsonPath ? readJson(playlistJsonPath) : null;

      out.push({
        playlistId: Number(pid),
        title: String(playlistJson?.title || entry.title || ""),
        picture: String(playlistJson?.picture_medium || playlistJson?.picture || ""),
        total,
        downloaded,
        updatedAt: Number(entry.updatedAt) || Number(db.updatedAt) || 0,
      });
    }

    out.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
    return { ok: true, playlists: out };
  };

  const stampTrackUuid = ({ trackId, quality, uuid }) => {
    const tid = toIdString(trackId);
    const q = normalizeQuality(quality);
    const u = typeof uuid === "string" ? uuid.trim() : "";
    if (!tid || !q || !u) return { ok: false, error: "bad_request" };
    const db = getDb();
    if (!db) return { ok: false, error: "db_not_loaded" };

    const entry = db.tracks?.[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
    if (!entry) return { ok: false, error: "not_found" };
    const qualities = entry.qualities && typeof entry.qualities === "object" ? entry.qualities : {};
    const slot = qualities[q] && typeof qualities[q] === "object" ? qualities[q] : null;
    if (!slot) return { ok: false, error: "not_found" };

    const prev = slot.uuid ? String(slot.uuid).trim() : "";
    if (prev) return { ok: true, changed: false };

    slot.uuid = u;
    qualities[q] = slot;
    entry.qualities = qualities;
    db.tracks[tid] = entry;
    db.updatedAt = Date.now();
    try {
      writeJsonAtomic(dbPath, db);
    } catch {}
    return { ok: true, changed: true };
  };

  const save = () => {
    const db = getDb();
    if (!db) return { ok: false, error: "db_not_loaded" };
    db.updatedAt = Date.now();
    writeJsonAtomic(dbPath, db);
    return { ok: true };
  };

  return {
    emptyDb,
    resolveTrack,
    listDownloadedTracks,
    listDownloadedPlaylists,
    upsertDbAlbum,
    upsertDbTrack,
    stampTrackUuid,
    save,
  };
}

module.exports = { createDbIndexApi };
