function createOfflineTracklistResolver({
  ensureLoaded,
  getDb,
  toIdString,
  readJson,
  safeStat,
  pathToFileURL,
  getAlbumJsonPath,
  getAlbumCoverPath,
}) {
  return ({ type, id }) => {
    ensureLoaded();
    const db = getDb();
    const t = String(type || "").trim().toLowerCase();
    const entityId = toIdString(id);
    if (!t || !entityId) return { ok: false, error: "bad_request" };

    if (t === "album") {
      const albumEntry = db.albums?.[entityId] && typeof db.albums[entityId] === "object" ? db.albums[entityId] : null;
      if (!albumEntry) return { ok: false, error: "not_downloaded" };

      const albumJsonPath = typeof albumEntry.albumJsonPath === "string" && albumEntry.albumJsonPath ? albumEntry.albumJsonPath : getAlbumJsonPath(entityId);
      const coverPath = typeof albumEntry.coverPath === "string" && albumEntry.coverPath ? albumEntry.coverPath : getAlbumCoverPath(entityId);
      const albumJson = readJson(albumJsonPath) || {};

      const coverUrl =
        coverPath && safeStat(coverPath)?.isFile()
          ? pathToFileURL(coverPath).href
          : String(albumJson?.cover_medium || albumJson?.cover || albumJson?.cover_big || albumJson?.cover_small || "").trim();

      const albumTrackMeta = (() => {
        const raw = albumJson && typeof albumJson === "object" ? albumJson : null;
        const tracks = Array.isArray(raw?.tracks) ? raw.tracks : Array.isArray(raw?.tracks?.data) ? raw.tracks.data : [];
        return Array.isArray(tracks) ? tracks : [];
      })();

      const allTrackIds = (() => {
        const ids = [];
        const seen = new Set();
        const push = (value) => {
          const id = toIdString(value);
          if (!id || seen.has(id)) return;
          seen.add(id);
          ids.push(id);
        };
        for (const t0 of albumTrackMeta) push(t0?.id || t0?.SNG_ID);
        for (const t0 of Array.isArray(albumEntry?.allTrackIds) ? albumEntry.allTrackIds : []) push(t0);
        for (const t0 of Array.isArray(albumEntry?.trackIds) ? albumEntry.trackIds : []) push(t0);
        return ids;
      })();

      const trackHasAnyAudio = (entry) => {
        const e = entry && typeof entry === "object" ? entry : null;
        if (!e) return false;
        const qualities = e.qualities && typeof e.qualities === "object" ? e.qualities : {};
        for (const q of Object.keys(qualities)) {
          const audioPath = qualities[q]?.audioPath ? String(qualities[q].audioPath) : "";
          if (!audioPath) continue;
          const st = safeStat(audioPath);
          if (st && st.isFile() && st.size > 0) return true;
        }
        return false;
      };

      const trackMetaById = (() => {
        const map = new Map();
        for (const t0 of albumTrackMeta) {
          const id = toIdString(t0?.id || t0?.SNG_ID);
          if (!id) continue;
          map.set(id, t0);
        }
        return map;
      })();

      const downloadedByTrackId = (() => {
        const map = new Map();
        for (const tid of allTrackIds) {
          const entry = db.tracks?.[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
          if (!entry) continue;
          if (String(toIdString(entry?.albumId) || "") !== String(entityId)) continue;
          map.set(tid, entry);
        }
        // Preserve downloaded rows even if they are not present in album metadata (legacy edge cases).
        for (const [tid, entry] of Object.entries(db.tracks || {})) {
          if (map.has(tid)) continue;
          const e = entry && typeof entry === "object" ? entry : null;
          if (!e) continue;
          if (String(toIdString(e?.albumId) || "") !== String(entityId)) continue;
          if (!trackHasAnyAudio(e)) continue;
          map.set(tid, e);
        }
        return map;
      })();

      const tracks = [];
      const seenTrackIds = new Set();
      for (const tid of allTrackIds) {
        if (!tid) continue;
        const meta = trackMetaById.get(tid) || null;
        const entry = downloadedByTrackId.get(tid) || null;
        const hasAudio = trackHasAnyAudio(entry);

        const trackJsonPath = typeof entry?.trackJsonPath === "string" ? entry.trackJsonPath : "";
        const trackJson = trackJsonPath ? readJson(trackJsonPath) : null;
        const base =
          trackJson && typeof trackJson === "object"
            ? { ...trackJson }
            : meta && typeof meta === "object"
              ? { ...meta }
              : { id: Number(tid), title: `Track #${tid}` };

        if (!base.id) base.id = Number(tid);
        const nextAlbum = base.album && typeof base.album === "object" ? { ...base.album } : {};
        if (!nextAlbum.id) nextAlbum.id = Number(entityId);
        if (coverUrl) {
          nextAlbum.cover_small = String(nextAlbum.cover_small || coverUrl);
          nextAlbum.cover_medium = String(nextAlbum.cover_medium || coverUrl);
          nextAlbum.cover = String(nextAlbum.cover || coverUrl);
          base.cover = String(base.cover || coverUrl);
        }
        base.album = nextAlbum;
        if (!hasAudio) base.__missing = true;

        tracks.push(base);
        seenTrackIds.add(tid);
      }

      // If metadata is unavailable, still surface downloaded tracks so the album page remains usable.
      for (const [tid, entry] of downloadedByTrackId.entries()) {
        if (seenTrackIds.has(tid)) continue;
        const trackJsonPath = typeof entry?.trackJsonPath === "string" ? entry.trackJsonPath : "";
        const trackJson = trackJsonPath ? readJson(trackJsonPath) : null;
        if (!trackJson || typeof trackJson !== "object") continue;
        const next = { ...trackJson };
        const nextAlbum = next.album && typeof next.album === "object" ? { ...next.album } : {};
        if (!nextAlbum.id) nextAlbum.id = Number(entityId);
        if (coverUrl) {
          nextAlbum.cover_small = String(nextAlbum.cover_small || coverUrl);
          nextAlbum.cover_medium = String(nextAlbum.cover_medium || coverUrl);
          nextAlbum.cover = String(nextAlbum.cover || coverUrl);
          next.cover = String(next.cover || coverUrl);
        }
        next.album = nextAlbum;
        tracks.push(next);
      }

      tracks.sort((a, b) => Number(a?.track_position || 0) - Number(b?.track_position || 0));

      const data = {
        ...albumJson,
        id: Number(entityId),
        title: String(albumJson?.title || albumEntry.title || "Album"),
        record_type: albumJson?.record_type || albumJson?.recordType || "album",
        artist:
          albumJson?.artist && typeof albumJson.artist === "object"
            ? albumJson.artist
            : {
                name: String(albumEntry.artist || ""),
              },
        cover_medium: coverUrl || String(albumJson?.cover_medium || ""),
        cover_small: coverUrl || String(albumJson?.cover_small || ""),
        cover: coverUrl || String(albumJson?.cover || ""),
        tracks,
      };

      return { ok: true, data };
    }

    if (t === "playlist") {
      const pl = db.playlists?.[entityId] && typeof db.playlists[entityId] === "object" ? db.playlists[entityId] : null;
      if (!pl) return { ok: false, error: "not_downloaded" };
      const playlistJsonPath = typeof pl.playlistJsonPath === "string" ? pl.playlistJsonPath : "";
      const playlistJson = playlistJsonPath ? readJson(playlistJsonPath) : {};
      const itemsJsonPath = typeof pl.itemsJsonPath === "string" ? pl.itemsJsonPath : "";
      const itemsJson = itemsJsonPath ? readJson(itemsJsonPath) : null;
      const downloadsMap =
        itemsJson && typeof itemsJson === "object" && itemsJson.downloads && typeof itemsJson.downloads === "object"
          ? itemsJson.downloads
          : null;
      const hasDownloadsMap = Boolean(downloadsMap);
      const ids = (() => {
        const fromItems = itemsJson && typeof itemsJson === "object" && Array.isArray(itemsJson.trackIds) ? itemsJson.trackIds : [];
        if (fromItems.length > 0) return fromItems;
        if (downloadsMap && typeof downloadsMap === "object") return Object.keys(downloadsMap);
        return Array.isArray(pl.trackIds) ? pl.trackIds : [];
      })();
      if (ids.length === 0) return { ok: false, error: "not_downloaded" };
      const trackHasPlaylistTaggedAudio = (entry) => {
        const e = entry && typeof entry === "object" ? entry : null;
        if (!e) return false;
        const qualities = e.qualities && typeof e.qualities === "object" ? e.qualities : {};
        for (const q of Object.keys(qualities)) {
          const audioPath = qualities[q]?.audioPath ? String(qualities[q].audioPath) : "";
          const uuid = qualities[q]?.uuid ? String(qualities[q].uuid) : "";
          if (!uuid.startsWith(`playlist_${entityId}_track_`)) continue;
          if (!audioPath) continue;
          const st = safeStat(audioPath);
          if (st && st.isFile() && st.size > 0) return true;
        }
        return false;
      };
      const metaByTrackId = (() => {
        const map = new Map();
        const raw = playlistJson && typeof playlistJson === "object" ? playlistJson : null;
        const tracks =
          Array.isArray(raw?.tracks) ? raw.tracks : Array.isArray(raw?.tracks?.data) ? raw.tracks.data : [];
        for (const t of tracks) {
          const id = toIdString(t?.id || t?.SNG_ID);
          if (!id) continue;
          map.set(id, t);
        }
        return map;
      })();
      const tracks = [];
      for (const trackId0 of ids) {
        const tid = toIdString(trackId0);
        if (!tid) continue;
        const entry = db.tracks?.[tid] && typeof db.tracks[tid] === "object" ? db.tracks[tid] : null;
        const slot = downloadsMap?.[tid] && typeof downloadsMap[tid] === "object" ? downloadsMap[tid] : null;
        const slotAudioPath = slot?.audioPath ? String(slot.audioPath) : "";
        const slotStat = slotAudioPath ? safeStat(slotAudioPath) : null;
        const hasAudioFromMap = Boolean(slotStat && slotStat.isFile() && slotStat.size > 0);
        const hasAudio = hasAudioFromMap || (!hasDownloadsMap && trackHasPlaylistTaggedAudio(entry));
        const trackJsonPath = typeof entry?.trackJsonPath === "string" ? entry.trackJsonPath : "";
        const trackJson = trackJsonPath ? readJson(trackJsonPath) : null;
        if (trackJson && typeof trackJson === "object") {
          const next = { ...trackJson };
          if (!hasAudio) next.__missing = true;
          tracks.push(next);
          continue;
        }

        const meta = metaByTrackId.get(tid) || null;
        const title = String(meta?.title || meta?.SNG_TITLE || `Track #${tid}`);
        const artistName = String(meta?.artist?.name || meta?.ART_NAME || "Unknown artist");
        const album = meta?.album && typeof meta.album === "object" ? meta.album : null;
        const cover = String(album?.cover_small || album?.cover_medium || album?.cover || meta?.cover || "").trim();
        const albumId = Number(album?.id || meta?.ALB_ID || 0);
        const artistId = Number(meta?.artist?.id || meta?.ART_ID || 0);

        tracks.push({
          id: Number(tid),
          title,
          artist: { id: Number.isFinite(artistId) && artistId > 0 ? artistId : null, name: artistName },
          album:
            cover || (Number.isFinite(albumId) && albumId > 0)
              ? {
                  id: Number.isFinite(albumId) && albumId > 0 ? albumId : null,
                  cover_small: cover,
                  cover_medium: cover,
                  cover,
                }
              : undefined,
          ...(cover ? { cover } : {}),
          ...(hasAudio ? {} : { __missing: true }),
        });
      }
      const data = {
        ...playlistJson,
        id: Number(entityId),
        title: String(playlistJson?.title || pl.title || "Playlist"),
        tracks,
      };
      return { ok: true, data };
    }

    if (t === "artist") {
      const tracks = [];
      let artistName = "";
      let artistPicture = "";
      let fallbackCover = "";
      const seenTrackIds = new Set();

      for (const [trackId, entry] of Object.entries(db.tracks || {})) {
        if (!entry || typeof entry !== "object") continue;
        if (seenTrackIds.has(trackId)) continue;

        const trackJsonPath = typeof entry.trackJsonPath === "string" ? entry.trackJsonPath : "";
        const trackJson = trackJsonPath ? readJson(trackJsonPath) : null;
        if (!trackJson || typeof trackJson !== "object") continue;

        const artistId = Number(trackJson?.artist?.id || trackJson?.ART_ID);
        if (!Number.isFinite(artistId) || artistId <= 0) continue;
        if (String(Math.trunc(artistId)) !== entityId) continue;

        if (!artistName) artistName = String(trackJson?.artist?.name || trackJson?.ART_NAME || "").trim();
        if (!artistPicture) artistPicture = String(trackJson?.artist?.picture_medium || trackJson?.artist?.picture || "").trim();

        const coverPath = typeof entry.coverPath === "string" ? entry.coverPath : "";
        const coverUrl = coverPath && safeStat(coverPath)?.isFile() ? pathToFileURL(coverPath).href : "";
        const cover =
          String(
            trackJson?.album?.cover_medium ||
              trackJson?.album?.cover_small ||
              trackJson?.album?.cover ||
              trackJson?.cover ||
              coverUrl ||
              "",
          ).trim() || "";
        if (!fallbackCover && cover) fallbackCover = cover;

        const next = { ...trackJson };
        const nextAlbum = next.album && typeof next.album === "object" ? { ...next.album } : {};
        const albumId = toIdString(nextAlbum?.id || next?.ALB_ID || next?.album_id);
        if (albumId) nextAlbum.id = Number(albumId);
        if (cover) {
          nextAlbum.cover_small = String(nextAlbum.cover_small || cover);
          nextAlbum.cover_medium = String(nextAlbum.cover_medium || cover);
          nextAlbum.cover = String(nextAlbum.cover || cover);
          next.cover = String(next.cover || cover);
        }
        next.album = nextAlbum;

        tracks.push(next);
        seenTrackIds.add(trackId);
      }

      if (tracks.length === 0) return { ok: false, error: "not_downloaded" };

      tracks.sort((a, b) => {
        const ap = Number(a?.track_position || a?.TRACK_NUMBER || 0);
        const bp = Number(b?.track_position || b?.TRACK_NUMBER || 0);
        if (ap && bp && ap !== bp) return ap - bp;
        const at = String(a?.title || a?.SNG_TITLE || "").toLowerCase();
        const bt = String(b?.title || b?.SNG_TITLE || "").toLowerCase();
        return at.localeCompare(bt);
      });

      const data = {
        id: Number(entityId),
        name: artistName || "Artist",
        picture_medium: (artistPicture || fallbackCover || "").trim(),
        picture: (artistPicture || fallbackCover || "").trim(),
        topTracks: tracks,
      };
      return { ok: true, data };
    }

    return { ok: false, error: "unsupported_type" };
  };
}

module.exports = { createOfflineTracklistResolver };
