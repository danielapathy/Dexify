export function createPlaybackSession({
  audio,
  state,
  el,
  lib,
  formatDuration,
  updateRangeFill,
  snapshotTrack,
  normalizeTrack,
  resolveTrackId,
  readJsonFromLocalStorage,
  writeJsonToLocalStorage,
  lastPlaybackKey,
  emitState,
  setPlayIcon,
  setLikeIcon,
  syncPlayerMetaFit,
}) {
  const hasAudioSrc = () => {
    try {
      const attr = audio.getAttribute("src");
      if (attr && String(attr).trim()) return true;
      const cur = String(audio.currentSrc || "");
      if (!cur) return false;
      const href = String(window.location?.href || "");
      if (href && cur === href) return false;
      return true;
    } catch {
      return false;
    }
  };

  let lastPlaybackSaveAt = 0;
  let lastPlaybackSeconds = -1;
  const persistPlayback = (force = false, progressOverride = null) => {
    if (!state.track) return;
    const track = snapshotTrack(state.track);
    if (!track) return;
    const now = Date.now();
    const override = Number(progressOverride);
    const canOverride = Number.isFinite(override) && override >= 0;
    const currentFromAudio = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
    const hasSrc = hasAudioSrc();
    const current = canOverride ? override : !hasSrc && state.resumeFrom > 0 ? state.resumeFrom : currentFromAudio;
    const floored = Math.floor(current);
    state.resumeFrom = floored;
    if (!force) {
      if (floored === lastPlaybackSeconds && now - lastPlaybackSaveAt < 1500) return;
    }
    lastPlaybackSeconds = floored;
    lastPlaybackSaveAt = now;
    writeJsonToLocalStorage(lastPlaybackKey, {
      track,
      progress: floored,
      duration: Number(track.duration) || 0,
      updatedAt: now,
    });
  };

  const setNowPlayingUI = (track) => {
    if (!track) return;
    if (el.title) el.title.textContent = track.title || "Unknown title";
    if (el.artist) el.artist.textContent = track.artist || "Unknown artist";
    if (el.cover && track.cover) el.cover.src = track.cover;
    if (el.timeTotal) el.timeTotal.textContent = formatDuration(track.duration || 0);
    if (el.timeCur) el.timeCur.textContent = formatDuration(0);
    if (el.seek) {
      el.seek.min = "0";
      el.seek.max = String(Math.max(1, Math.floor(track.duration || 1)));
      el.seek.value = "0";
      updateRangeFill(el.seek);
    }
    requestAnimationFrame(() => syncPlayerMetaFit());
  };

  const restorePlayback = () => {
    const saved = readJsonFromLocalStorage(lastPlaybackKey, null);
    if (!saved || typeof saved !== "object") return;
    const track = saved.track && typeof saved.track === "object" ? normalizeTrack(saved.track) : null;
    if (!track) return;
    state.track = track;
    state.queue = [];
    state.index = -1;
    state.isPlaying = false;
    state.downloadUuid = null;
    state.lastDownloadError = null;
    state.lastDownloadStack = "";
    state.lastDownloadDebug = null;
    const trackId = resolveTrackId(track);
    state.liked = trackId ? lib.isTrackSaved(trackId) : false;
    setLikeIcon(state.liked);
    setPlayIcon(false);
    setNowPlayingUI(track);

    const progress = Number(saved.progress) || 0;
    state.resumeFrom = progress;
    const total = Number(saved.duration) || Number(track.duration) || 0;
    if (el.timeTotal && total) el.timeTotal.textContent = formatDuration(total);
    if (el.timeCur) el.timeCur.textContent = formatDuration(progress);
    if (el.seek) {
      const max = Number(el.seek.max || Math.max(1, Math.floor(total || 1)));
      el.seek.max = String(Math.max(1, max));
      el.seek.value = String(Math.max(0, Math.min(Math.floor(progress), max)));
      updateRangeFill(el.seek);
    }
  };

  const seekAfterLoad = (seconds) => {
    const t = Number(seconds);
    if (!Number.isFinite(t) || t <= 0) return;
    const apply = () => {
      try {
        const max = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.25) : null;
        const next = max === null ? t : Math.min(t, max);
        audio.currentTime = Math.max(0, next);
      } catch {}
    };
    if (audio.readyState >= 1) {
      apply();
      return;
    }
    const handler = () => {
      audio.removeEventListener("loadedmetadata", handler);
      apply();
    };
    audio.addEventListener("loadedmetadata", handler);
  };

  const playResolvedTrackUrl = async (track, { fileUrl, downloadUuid, startTime = 0, autoPlay = true } = {}) => {
    const src = String(fileUrl || "");
    if (!src) return false;
    state.downloadUuid = downloadUuid || null;

    audio.src = src;
    audio.currentTime = 0;
    setNowPlayingUI(track);
    persistPlayback(true, startTime);
    if (Number.isFinite(startTime) && startTime > 0) {
      const floored = Math.floor(startTime);
      if (el.timeCur) el.timeCur.textContent = formatDuration(floored);
      if (el.seek) {
        const currentMax = Number(el.seek.max || 0);
        const nextMax = Math.max(Number.isFinite(currentMax) ? currentMax : 0, floored + 1);
        if (nextMax > 0) el.seek.max = String(nextMax);
        el.seek.value = String(Math.max(0, floored));
        updateRangeFill(el.seek);
      }
    }
    seekAfterLoad(startTime);
    if (!autoPlay) {
      state.isPlaying = false;
      setPlayIcon(false);
      emitState();
      return true;
    }
    try {
      await audio.play();
      state.isPlaying = true;
      setPlayIcon(true);
    } catch {
      state.isPlaying = false;
      setPlayIcon(false);
      try {
        audio.pause();
      } catch {}
      try {
        audio.src = "";
      } catch {}
      emitState();
      return false;
    }
    emitState();
    try {
      const raw = track?.raw && typeof track.raw === "object" ? track.raw : null;
      const cover = String(track?.cover || "").trim();
      const libTrack = raw ? { ...raw } : { ...(track || {}) };
      if (cover) {
        libTrack.cover = String(libTrack.cover || cover);
        if (libTrack.album && typeof libTrack.album === "object") {
          libTrack.album = { ...libTrack.album };
          libTrack.album.cover_small = String(libTrack.album.cover_small || cover);
          libTrack.album.cover_medium = String(libTrack.album.cover_medium || cover);
          libTrack.album.cover = String(libTrack.album.cover || cover);
        } else {
          libTrack.album = { cover_small: cover, cover_medium: cover, cover };
        }
      }
      const hydrated = (() => {
        const trackId = resolveTrackId(track);
        if (!trackId || !lib?.load) return libTrack;
        const st = lib.load() || {};
        const saved = st?.savedTracks && typeof st.savedTracks === "object" ? st.savedTracks[String(trackId)] : null;
        const dl =
          st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks[String(trackId)] : null;
        const row = saved && typeof saved === "object" ? saved : dl && typeof dl === "object" ? dl : null;
        if (!row) return libTrack;

        const albumIdFromRow = Number(row?.albumId || row?.trackJson?.album?.id || 0);
        const artistIdFromRow = Number(row?.artistId || row?.trackJson?.artist?.id || 0);
        const albumTitleFromRow = String(row?.albumTitle || row?.trackJson?.album?.title || "").trim();
        const artistNameFromRow = String(row?.artist || row?.trackJson?.artist?.name || "").trim();
        const coverFromRow = String(
          row?.albumCover ||
            row?.trackJson?.album?.cover_medium ||
            row?.trackJson?.album?.cover_small ||
            row?.trackJson?.album?.cover ||
            "",
        ).trim();

        const next = { ...libTrack };
        const albumIdFromTrack = Number(next?.album?.id || next?.ALB_ID || next?.albumId || next?.album_id || 0);
        const artistIdFromTrack = Number(next?.artist?.id || next?.ART_ID || next?.artistId || next?.artist_id || 0);

        const albumId =
          Number.isFinite(albumIdFromTrack) && albumIdFromTrack > 0
            ? albumIdFromTrack
            : Number.isFinite(albumIdFromRow) && albumIdFromRow > 0
              ? albumIdFromRow
              : null;
        const artistId =
          Number.isFinite(artistIdFromTrack) && artistIdFromTrack > 0
            ? artistIdFromTrack
            : Number.isFinite(artistIdFromRow) && artistIdFromRow > 0
              ? artistIdFromRow
              : null;

        if (artistId || artistNameFromRow) {
          const existing = next.artist && typeof next.artist === "object" ? next.artist : {};
          next.artist = { ...existing };
          if (artistId && !next.artist.id) next.artist.id = artistId;
          if (artistNameFromRow && !next.artist.name) next.artist.name = artistNameFromRow;
        }

        const bestCover = String(next?.cover || next?.album?.cover_medium || coverFromRow || cover || "").trim();
        const existingAlbum = next.album && typeof next.album === "object" ? next.album : {};
        next.album = { ...existingAlbum };
        if (albumId && !next.album.id) next.album.id = albumId;
        if (albumTitleFromRow && !next.album.title) next.album.title = albumTitleFromRow;
        if (bestCover) {
          next.cover = String(next.cover || bestCover);
          next.album.cover_small = String(next.album.cover_small || bestCover);
          next.album.cover_medium = String(next.album.cover_medium || bestCover);
          next.album.cover = String(next.album.cover || bestCover);
        }

        if (albumId && !next.ALB_ID) next.ALB_ID = albumId;
        if (artistId && !next.ART_ID) next.ART_ID = artistId;
        if (albumId && !next.albumId) next.albumId = albumId;
        if (artistId && !next.artistId) next.artistId = artistId;

        return next;
      })();

      lib.addRecentTrack?.(hydrated, { context: state.playContext });
    } catch {}
    return true;
  };

  return {
    hasAudioSrc,
    persistPlayback,
    restorePlayback,
    setNowPlayingUI,
    seekAfterLoad,
    playResolvedTrackUrl,
  };
}
