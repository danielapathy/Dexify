function createDownloadUrlHandler({
  log,
  getDzClient,
  parseDeezerUrl,
  normalizeQuality,
  toIdString,
  qualityToBitrate,
  tryFetchAlbumFull,
  tryFetchPlaylistFull,
  tryFetchArtistAlbums,
  downloadSingleTrack,
  library,
  broadcastDownloadEvent,
  isGroupCancelled,
  clearGroupCancelled,
}) {
  return async function handleDownloadUrl(payload) {
    log("dl:downloadUrl:start", { payload });
    const url = String(payload?.url || "").trim();
    if (!url) return { ok: false, error: "bad_request" };

    const parsed = parseDeezerUrl(url);
    if (!parsed) return { ok: false, error: "bad_request" };

    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    const quality = String(payload?.quality || "mp3_128");
    const q = normalizeQuality(quality) || "mp3_128";

    if (parsed.type === "track") {
      return downloadSingleTrack({ dz: dzRes.dz, trackId: parsed.id, quality: q, uuid: payload?.uuid || null });
    }

    if (parsed.type === "album") {
      const album = await tryFetchAlbumFull(dzRes.dz, parsed.id);
      if (!album) return { ok: false, error: "album_fetch_failed" };
      const tracks = Array.isArray(album?.tracks) ? album.tracks : Array.isArray(album?.tracks?.data) ? album.tracks.data : [];
      const albumId = Number(album?.id || parsed.id);
      if (!Number.isFinite(albumId) || albumId <= 0) return { ok: false, error: "album_fetch_failed" };

      const groupKey = `album:${albumId}`;
      const groupPrefix = `album_${albumId}_track_`;
      const plannedTrackIds = tracks
        .map((t) => Number(t?.id))
        .filter((id) => Number.isFinite(id) && id > 0);

      try {
        if (typeof broadcastDownloadEvent === "function") {
          broadcastDownloadEvent({
            event: "downloadGroupPlanned",
            data: {
              kind: "album",
              groupKey,
              groupPrefix,
              total: plannedTrackIds.length,
              startedAt: Date.now(),
              albumId,
              title: String(album?.title || ""),
              albumTitle: String(album?.title || ""),
              artist: String(album?.artist?.name || album?.artist?.ART_NAME || ""),
              cover: String(album?.cover_medium || album?.cover || album?.cover_big || album?.cover_small || ""),
            },
          });
        }
      } catch {}

      const results = [];
      let cancelled = false;
      for (const t of tracks) {
        try {
          if (typeof isGroupCancelled === "function" && isGroupCancelled(groupPrefix)) {
            cancelled = true;
            break;
          }
        } catch {}

        const id = Number(t?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const r = await downloadSingleTrack({
          dz: dzRes.dz,
          trackId: id,
          quality: q,
          uuid: `album_${albumId}_track_${id}_${qualityToBitrate(q)}`,
          trackJson: t,
          albumJson: album,
        });
        results.push({ trackId: id, ok: Boolean(r?.ok), error: r?.error || null });
        if (r?.error === "download_cancelled") {
          try {
            if (typeof isGroupCancelled === "function" && isGroupCancelled(groupPrefix)) {
              cancelled = true;
              break;
            }
          } catch {}
        }
      }

      try {
        if (typeof clearGroupCancelled === "function") clearGroupCancelled(groupPrefix);
      } catch {}
      if (cancelled) {
        try {
          if (typeof broadcastDownloadEvent === "function") {
            broadcastDownloadEvent({
              event: "downloadGroupCancelled",
              data: { kind: "album", groupKey, groupPrefix, albumId, updatedAt: Date.now() },
            });
          }
        } catch {}
      }
      return { ok: true, type: "album", albumId, count: results.length, results };
    }

    if (parsed.type === "playlist") {
      const playlist = await tryFetchPlaylistFull(dzRes.dz, parsed.id);
      if (!playlist) return { ok: false, error: "playlist_fetch_failed" };
      const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : Array.isArray(playlist?.tracks?.data) ? playlist.tracks.data : [];
      const playlistId = Number(playlist?.id || parsed.id);
      if (!Number.isFinite(playlistId) || playlistId <= 0) return { ok: false, error: "playlist_fetch_failed" };

      const trackIds = [];
      for (const t of tracks) {
        const id = Number(t?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        trackIds.push(id);
      }
      await library.ensurePlaylistMetadata({ playlistId, playlistJson: playlist, trackIds });

      const groupKey = `playlist:${playlistId}`;
      const groupPrefix = `playlist_${playlistId}_track_`;
      try {
        if (typeof broadcastDownloadEvent === "function") {
          broadcastDownloadEvent({
            event: "downloadGroupPlanned",
            data: {
              kind: "playlist",
              groupKey,
              groupPrefix,
              total: trackIds.length,
              startedAt: Date.now(),
              playlistId,
              title: String(playlist?.title || ""),
              artist: String(playlist?.creator?.name || ""),
              cover: String(playlist?.picture_medium || playlist?.picture || ""),
            },
          });
        }
      } catch {}

      const albumCache = new Map();
      const getAlbum = async (albumId) => {
        const key = toIdString(albumId);
        if (!key) return null;
        if (albumCache.has(key)) return albumCache.get(key);
        const full = await tryFetchAlbumFull(dzRes.dz, key);
        const val = full || null;
        albumCache.set(key, val);
        return val;
      };

      const results = [];
      let cancelled = false;
      for (const t of tracks) {
        try {
          if (typeof isGroupCancelled === "function" && isGroupCancelled(groupPrefix)) {
            cancelled = true;
            break;
          }
        } catch {}

        const id = Number(t?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const albumId = toIdString(t?.album?.id) || toIdString(t?.ALB_ID) || null;
        const album = albumId ? await getAlbum(albumId) : null;
        const r = await downloadSingleTrack({
          dz: dzRes.dz,
          trackId: id,
          quality: q,
          uuid: `playlist_${playlistId}_track_${id}_${qualityToBitrate(q)}`,
          trackJson: t,
          albumJson: album || t?.album || null,
        });
        results.push({ trackId: id, ok: Boolean(r?.ok), error: r?.error || null });
        if (r?.error === "download_cancelled") {
          try {
            if (typeof isGroupCancelled === "function" && isGroupCancelled(groupPrefix)) {
              cancelled = true;
              break;
            }
          } catch {}
        }
      }
      try {
        if (typeof clearGroupCancelled === "function") clearGroupCancelled(groupPrefix);
      } catch {}
      if (cancelled) {
        try {
          if (typeof broadcastDownloadEvent === "function") {
            broadcastDownloadEvent({
              event: "downloadGroupCancelled",
              data: { kind: "playlist", groupKey, groupPrefix, playlistId, updatedAt: Date.now() },
            });
          }
        } catch {}
      }
      return { ok: true, type: "playlist", playlistId, count: results.length, results };
    }

    if (parsed.type === "artist") {
      const artistId = toIdString(parsed.id);
      if (!artistId) return { ok: false, error: "artist_fetch_failed" };

      const albums = await tryFetchArtistAlbums(dzRes.dz, artistId);
      const albumIds = Array.from(
        new Set(
          albums
            .map((a) => Number(a?.id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
      if (albumIds.length === 0) return { ok: false, error: "artist_albums_fetch_failed" };

      const results = [];
      for (const albumId of albumIds) {
        const album = await tryFetchAlbumFull(dzRes.dz, albumId);
        if (!album) {
          results.push({ albumId, ok: false, error: "album_fetch_failed" });
          continue;
        }
        const tracks = Array.isArray(album?.tracks) ? album.tracks : Array.isArray(album?.tracks?.data) ? album.tracks.data : [];
        for (const t of tracks) {
          const id = Number(t?.id);
          if (!Number.isFinite(id) || id <= 0) continue;
          const r = await downloadSingleTrack({
            dz: dzRes.dz,
            trackId: id,
            quality: q,
            uuid: `artist_${artistId}_album_${albumId}_track_${id}_${qualityToBitrate(q)}`,
            trackJson: t,
            albumJson: album,
          });
          results.push({ albumId, trackId: id, ok: Boolean(r?.ok), error: r?.error || null });
        }
      }
      return { ok: true, type: "artist", artistId, albums: albumIds.length, count: results.length, results };
    }

    return { ok: false, error: "unsupported_type", type: parsed.type };
  };
}

module.exports = { createDownloadUrlHandler };
