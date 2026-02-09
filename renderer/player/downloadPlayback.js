export function createDownloadPlayback({
  state,
  lib,
  getQualitySetting,
  getCache,
  setCache,
  setNowPlayingUI,
  setPlayIcon,
  playResolvedTrackUrl,
  resolveTrackId,
  normalizeDownloadQuality,
}) {
  const rememberDownloadMeta = (track) => {
    const id = resolveTrackId(track);
    if (!Number.isFinite(id) || id <= 0) return;
    const title = String(track?.title || "");
    const artist = String(track?.artist || "");
    const cover = String(track?.cover || "");
    const albumIdRaw = Number(track?.album?.id || track?.raw?.album?.id || track?.raw?.ALB_ID);
    const albumId = Number.isFinite(albumIdRaw) && albumIdRaw > 0 ? albumIdRaw : null;
    const albumTitle = String(track?.album?.title || track?.raw?.album?.title || track?.raw?.ALB_TITLE || "");
    const map = window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById : {};
    map[String(id)] = { title, artist, cover, albumId, albumTitle, at: Date.now() };
    window.__downloadMetaById = map;
  };

  const attemptDownloadAndPlay = async (track, { startTime = 0, autoPlay = true } = {}) => {
    const trackId = resolveTrackId(track);
    if (!trackId || !window.dl?.downloadTrack) return false;
    const quality = getQualitySetting();
    state.lastDownloadError = null;
    state.lastDownloadStack = "";
    state.lastDownloadDebug = null;

    const startedAt = performance.now();
    try {
      console.groupCollapsed("[player] downloadTrack", { trackId, quality });
      console.log("track", track);
    } catch {}

    const qualityKey = String(quality || "").toLowerCase();

    // Check if renderer still considers this track as having a local download.
    // After removeDownloadedTrack clears state, this is false — causing us to skip
    // stale local resolution paths (resolveTrack, cache) and download fresh.
    const isTrackedAsDownloaded = (() => {
      try {
        const s = lib.load?.() || {};
        const dlEntry = s.downloadedTracks?.[String(trackId)];
        if (dlEntry && typeof dlEntry === "object" && dlEntry.download?.fileUrl) return true;
        const svEntry = s.savedTracks?.[String(trackId)];
        if (svEntry && typeof svEntry === "object" && svEntry.download?.fileUrl) return true;
      } catch {}
      return false;
    })();

    try {
      const rawDownload = track?.raw?.download && typeof track.raw.download === "object" ? track.raw.download : null;
      const rawFileUrl = rawDownload?.fileUrl ? String(rawDownload.fileUrl) : "";
      const rawQuality = rawDownload?.quality ? normalizeDownloadQuality(rawDownload.quality) : "";
      const matches = !rawQuality || rawQuality === quality;
      if (rawFileUrl) {
        const ok = await playResolvedTrackUrl(track, {
          fileUrl: rawFileUrl,
          downloadUuid: track?.raw?.download?.uuid || null,
          startTime,
          autoPlay,
        });
        if (ok) {
          console.log("using embedded download fileUrl", { fileUrl: rawFileUrl, matchesPreferredQuality: matches });
          console.groupEnd();
          return true;
        }
      }
    } catch {}

    try {
      const preferred = normalizeDownloadQuality(quality);
      if (window.dl?.resolveTrack && preferred && isTrackedAsDownloaded) {
        const resolved = await window.dl.resolveTrack({ id: trackId, quality: preferred });
        const fileUrl = resolved?.fileUrl ? String(resolved.fileUrl) : "";
        const gotQuality = resolved?.quality ? normalizeDownloadQuality(resolved.quality) : "";
        const match = gotQuality && preferred && gotQuality === preferred;
        if (resolved?.ok && resolved?.exists && fileUrl) {
          const ok = await playResolvedTrackUrl(track, { fileUrl, downloadUuid: resolved?.uuid || null, startTime, autoPlay });
          if (ok) {
            try {
              console.log("using downloads DB fileUrl", {
                fileUrl,
                quality: gotQuality || preferred,
                matchesPreferredQuality: match,
              });
            } catch {}
            console.groupEnd();
            return true;
          }
        }
      }
    } catch {}

    try {
      const s = lib.load?.();
      const saved = s?.savedTracks && typeof s.savedTracks === "object" ? s.savedTracks[String(trackId)] : null;
      const dl = saved?.download && typeof saved.download === "object" ? saved.download : null;
      const fileUrl = dl?.fileUrl ? String(dl.fileUrl) : "";
      const dlQuality = dl?.quality ? normalizeDownloadQuality(dl.quality) : "";
      const matches = !dlQuality || dlQuality === quality;
      if (fileUrl) {
        const ok = await playResolvedTrackUrl(track, { fileUrl, downloadUuid: dl?.uuid || null, startTime, autoPlay });
        if (ok) {
          console.log("using library download fileUrl", { fileUrl, matchesPreferredQuality: matches });
          console.groupEnd();
          return true;
        }
      }
    } catch {}

    try {
      const s = lib.load?.();
      const downloaded = s?.downloadedTracks && typeof s.downloadedTracks === "object" ? s.downloadedTracks[String(trackId)] : null;
      const dl = downloaded?.download && typeof downloaded.download === "object" ? downloaded.download : null;
      const fileUrl = dl?.fileUrl ? String(dl.fileUrl) : "";
      const dlQuality = dl?.quality ? normalizeDownloadQuality(dl.quality) : "";
      const matches = !dlQuality || dlQuality === quality;
      if (fileUrl) {
        const ok = await playResolvedTrackUrl(track, { fileUrl, downloadUuid: dl?.uuid || null, startTime, autoPlay });
        if (ok) {
          console.log("using library downloadedTracks fileUrl", { fileUrl, matchesPreferredQuality: matches });
          console.groupEnd();
          return true;
        }
      }
    } catch {}

    const cache = getCache();
    const cacheKey = `${trackId}:${String(quality || "").toLowerCase()}`;
    const cached = cache[cacheKey];
    if (cached?.fileUrl && isTrackedAsDownloaded) {
      try {
        console.log("cache hit", cached);
      } catch {}
      const ok = await playResolvedTrackUrl(track, { fileUrl: cached.fileUrl, downloadUuid: cached.uuid || null, startTime, autoPlay });
      try {
        console.groupEnd();
      } catch {}
      if (ok) return true;
    } else if (cached?.fileUrl) {
      delete cache[cacheKey];
      setCache(cache);
    }

    const bitrate = qualityKey === "flac" ? 9 : qualityKey === "mp3_320" ? 3 : 1;
    const playCtx = state.playContext && typeof state.playContext === "object" ? state.playContext : null;
    const ctxType = String(playCtx?.type || "").trim().toLowerCase();
    const ctxId = Number(playCtx?.id);
    const hasPlaylistCtx = ctxType === "playlist" && Number.isFinite(ctxId) && ctxId > 0;
    const hasAlbumCtx = ctxType === "album" && Number.isFinite(ctxId) && ctxId > 0;
    state.downloadUuid = hasPlaylistCtx
      ? `playlist_${ctxId}_track_${trackId}_${bitrate}`
      : hasAlbumCtx
        ? `album_${ctxId}_track_${trackId}_${bitrate}`
        : `dl_${trackId}_${bitrate}`;
    setNowPlayingUI({ ...track, artist: "Downloading…" });
    setPlayIcon(false);

    rememberDownloadMeta(track);
    const trackPayload = track?.raw && typeof track.raw === "object" ? track.raw : track;
    const albumPayload =
      trackPayload?.album && typeof trackPayload.album === "object"
        ? trackPayload.album
        : track?.album && typeof track.album === "object"
          ? track.album
          : null;
    const res = await window.dl.downloadTrack({ id: trackId, quality, uuid: state.downloadUuid, track: trackPayload, album: albumPayload });
    if (!res?.ok || !res?.fileUrl) {
      state.lastDownloadError = String(res?.message || res?.error || "download_failed");
      state.lastDownloadStack = typeof res?.stack === "string" ? res.stack : "";
      state.lastDownloadDebug = res?.debug && typeof res.debug === "object" ? res.debug : null;
      try {
        console.warn("downloadTrack failed", { trackId, quality, res, ms: Math.round(performance.now() - startedAt) });
        console.groupEnd();
      } catch {}
      return false;
    }
    state.downloadUuid = res.uuid || null;

    const nextCache = getCache();
    nextCache[cacheKey] = {
      fileUrl: res.fileUrl,
      downloadPath: res.downloadPath || null,
      uuid: res.uuid || null,
      at: Date.now(),
    };
    setCache(nextCache);

    try {
      lib.upsertDownloadedTrack?.({
        track: track.raw || track,
        fileUrl: res.fileUrl,
        downloadPath: res.downloadPath || "",
        quality,
        uuid: res.uuid || state.downloadUuid || null,
      });
    } catch {}

    // If the track was downloaded with a playlist/album context that isn't
    // currently saved (e.g. user deleted then re-played from the same page),
    // re-save the entity with metadata from the play context so the sidebar
    // shows a proper title/cover instead of a corrupt "Playlist #ID" fallback.
    try {
      if (hasPlaylistCtx && !lib.isPlaylistSaved?.(ctxId)) {
        lib.addSavedPlaylist?.({ id: ctxId, title: String(playCtx.title || ""), cover: String(playCtx.cover || "") });
      } else if (hasAlbumCtx && !lib.isAlbumSaved?.(ctxId)) {
        lib.addSavedAlbum?.({ id: ctxId, title: String(playCtx.title || ""), cover: String(playCtx.cover || "") });
      }
    } catch {}

    if (lib.isTrackSaved(trackId)) {
      lib.upsertTrackDownload({
        trackId,
        fileUrl: res.fileUrl,
        downloadPath: res.downloadPath || "",
        quality,
      });
    }

    try {
      console.log("downloadTrack ok", { uuid: res.uuid, downloadPath: res.downloadPath, fileUrl: res.fileUrl, ms: Math.round(performance.now() - startedAt) });
      console.groupEnd();
    } catch {}
    return await playResolvedTrackUrl(track, { fileUrl: res.fileUrl, downloadUuid: res.uuid || null, startTime, autoPlay });
  };

  return { rememberDownloadMeta, attemptDownloadAndPlay };
}
