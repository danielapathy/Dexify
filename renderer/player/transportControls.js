export function createPlayerTransportControls({
  state,
  audio,
  lib,
  normalizeTrack,
  resolveTrackId,
  setDisabled,
  setLikeIcon,
  emitState,
  persistPlayback,
  attemptDownloadAndPlay,
  setPlayIcon,
  setNowPlayingUI,
  seekAfterLoad,
  hasAudioSrc,
}) {
  const normalizePlayContext = (ctx) => {
    const c = ctx && typeof ctx === "object" ? ctx : null;
    if (!c) return null;
    const type = String(c.type || c.kind || "").trim().toLowerCase();
    const id = Number(c.id);
    if (!type || !Number.isFinite(id) || id <= 0) return null;
    const title = String(c.title || "").trim();
    const cover = String(c.cover || "").trim();
    return { type, id, title, cover };
  };

  const playIndex = async (nextIndex) => {
    const idx = Number(nextIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= state.queue.length) return;

    setDisabled(false);

    const track = normalizeTrack(state.queue[idx]);
    state.index = idx;
    state.track = track;
    state.resumeFrom = 0;
    const trackId = resolveTrackId(track);
    state.liked = trackId ? lib.isTrackSaved(trackId) : false;
    state.downloadUuid = null;
    setLikeIcon(state.liked);
    emitState();
    persistPlayback(true);

    const canDownload = Boolean(trackId) && Boolean(window.dl?.downloadTrack);
    if (canDownload) {
      const downloaded = await attemptDownloadAndPlay(track, { startTime: 0, autoPlay: true });
      if (downloaded) return;

      const reason = state.lastDownloadError || "Download failed";
      try {
        audio.pause();
      } catch {}
      try {
        audio.src = "";
      } catch {}
      state.isPlaying = false;
      setPlayIcon(false);
      setDisabled(true, reason);
      setNowPlayingUI({ ...track, artist: `Download failed — ${reason}`, duration: track.duration || 0 });
      emitState();

      try {
        const subtitle =
          /desired bitrate/i.test(String(reason || "")) || /bitrate/i.test(String(reason || ""))
            ? "Try lowering download quality in Settings → Downloads → Quality."
            : "";
        window.__modal?.showError?.({
          title: "Download failed",
          subtitle,
          message: reason,
          stack: state.lastDownloadStack,
          debug: state.lastDownloadDebug,
          trackTitle: track?.title || "",
          trackArtist: track?.artist || "",
          coverUrl: track?.cover || "",
        });
      } catch {}
      return;
    }

    const isElectron = document.documentElement.classList.contains("is-electron");
    if (!isElectron && track?.preview) {
      audio.src = track.preview;
      audio.currentTime = 0;
      setNowPlayingUI(track);
      persistPlayback(true);
      try {
        await audio.play();
        state.isPlaying = true;
        setPlayIcon(true);
      } catch {
        state.isPlaying = false;
        setPlayIcon(false);
      }
      emitState();
      return;
    }

    state.isPlaying = false;
    setPlayIcon(false);
    emitState();
  };

  const setQueueAndPlay = async (queue, index, { context } = {}) => {
    setDisabled(false);
    state.lastDownloadError = null;
    state.lastDownloadStack = "";
    state.lastDownloadDebug = null;
    state.queue = Array.isArray(queue) ? queue.slice() : [];
    state.playContext = normalizePlayContext(context);
    await playIndex(index);
  };

  const enqueue = (tracks) => {
    const items = Array.isArray(tracks) ? tracks : [tracks];
    const cleaned = items
      .map((t) => (t && typeof t === "object" ? (t.raw && typeof t.raw === "object" ? t.raw : t) : null))
      .filter(Boolean);
    if (cleaned.length === 0) return;

    if (state.track && (!Array.isArray(state.queue) || state.queue.length === 0)) {
      state.queue = [state.track.raw && typeof state.track.raw === "object" ? state.track.raw : state.track];
      state.index = 0;
    }

    state.queue = Array.isArray(state.queue) ? state.queue : [];
    state.queue.push(...cleaned);
    emitState();
  };

  const playUrl = async ({ url, title, artist, cover, duration, downloadUuid }) => {
    const src = String(url || "");
    if (!src) return;

    setDisabled(false);
    state.lastDownloadError = null;
    state.lastDownloadStack = "";
    state.lastDownloadDebug = null;

    state.queue = [];
    state.index = 0;
    state.playContext = null;
    state.track = {
      id: null,
      title: String(title || ""),
      artist: String(artist || ""),
      duration: Number(duration) || 0,
      preview: src,
      cover: String(cover || ""),
      raw: null,
    };
    state.downloadUuid = downloadUuid || null;
    state.resumeFrom = 0;
    state.liked = false;
    setLikeIcon(false);
    emitState();

    audio.src = src;
    audio.currentTime = 0;
    setNowPlayingUI(state.track);
    persistPlayback(true);
    try {
      await audio.play();
      state.isPlaying = true;
      setPlayIcon(true);
    } catch {
      state.isPlaying = false;
      setPlayIcon(false);
    }
    emitState();
  };

  const togglePlayPause = async () => {
    if (state.isDisabled) return;
    if (!state.track) return;
    if (audio.paused) {
      const hasSrc = hasAudioSrc();
      if (!hasSrc) {
        const startTime = Number.isFinite(state.resumeFrom) ? state.resumeFrom : 0;
        if (window.dl?.downloadTrack) {
          const ok = await attemptDownloadAndPlay(state.track, { startTime, autoPlay: true });
          if (ok) return;
          const reason = String(state.lastDownloadError || "Unable to start playback");
          try {
            const subtitle =
              /desired bitrate/i.test(reason) || /bitrate/i.test(reason)
                ? "Try lowering download quality in Settings → Downloads → Quality."
                : "";
            window.__modal?.showError?.({
              title: "Download failed",
              subtitle,
              message: reason,
              stack: state.lastDownloadStack,
              debug: state.lastDownloadDebug,
              trackTitle: String(state.track?.title || ""),
              trackArtist: String(state.track?.artist || ""),
              coverUrl: String(state.track?.cover || ""),
            });
          } catch {}
          state.isPlaying = false;
          setPlayIcon(false);
          emitState();
          return;
        }
        if (state.track?.preview) {
          audio.src = state.track.preview;
          audio.currentTime = 0;
          setNowPlayingUI(state.track);
          seekAfterLoad(startTime);
        } else {
          return;
        }
      }
      try {
        await audio.play();
        state.isPlaying = true;
        setPlayIcon(true);
      } catch {
        state.isPlaying = false;
        setPlayIcon(false);
      }
      emitState();
      return;
    }
    audio.pause();
    state.isPlaying = false;
    setPlayIcon(false);
    emitState();
  };

  const playPrev = async () => {
    if (state.isDisabled) return;
    if (state.queue.length === 0) return;
    const next = Math.max(0, state.index - 1);
    await playIndex(next);
  };

  const playNext = async () => {
    if (state.isDisabled) return;
    if (state.queue.length === 0) return;
    const next = Math.min(state.queue.length - 1, state.index + 1);
    await playIndex(next);
  };

  return {
    playIndex,
    setQueueAndPlay,
    enqueue,
    playUrl,
    togglePlayPause,
    playPrev,
    playNext,
  };
}
