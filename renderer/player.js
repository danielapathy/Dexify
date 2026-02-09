import { formatDuration, updateRangeFill, readJsonFromLocalStorage, writeJsonToLocalStorage } from "./utils.js";
import { getLocalLibrary } from "./localLibrary.js";
import {
  clampDownloadQualityForCapabilities,
  getDownloadQualityRaw,
  getNormalizeAudioSetting,
  normalizeDownloadQuality,
  setDownloadQualityRaw,
  setNormalizeAudioSetting,
} from "./settings.js";
import { createPlayerAudioMenu } from "./player/audioMenu.js";
import { createPlayerAudioGraph } from "./player/audioGraph.js";
import { bootstrapPlayerCapabilities } from "./player/capabilitiesBootstrap.js";
import { createDownloadPlayback } from "./player/downloadPlayback.js";
import { wirePlayerEventBindings } from "./player/eventBindings.js";
import { createPlayerLikeControls } from "./player/likeControls.js";
import { createPlayerMetaFit } from "./player/metaFit.js";
import { createPlaybackSession } from "./player/playbackSession.js";
import { createPlayerTransportControls } from "./player/transportControls.js";
import { normalizeTrack, resolveTrackId, snapshotTrack } from "./player/track.js";

export function createPlayerController() {
  const audio = new Audio();
  audio.preload = "none";

  const clampQualityForCapabilities = (q) => {
    const caps = window.__dzCapabilities && typeof window.__dzCapabilities === "object" ? window.__dzCapabilities : null;
    return clampDownloadQualityForCapabilities(q, caps);
  };

  const getQualitySetting = () => clampQualityForCapabilities(getDownloadQualityRaw());
  const setQualitySetting = (q) => {
    const v = clampQualityForCapabilities(q);
    setDownloadQualityRaw(v);
    return v;
  };

  const getNormalizeSetting = () => getNormalizeAudioSetting({ fallback: false });
  const setNormalizeSetting = (enabled) => setNormalizeAudioSetting(Boolean(enabled));

  const DOWNLOAD_CACHE_KEY = "spotify.downloadCache.v2";
  const LAST_PLAYBACK_KEY = "spotify.lastPlayback.v1";
  const getCache = () => {
    const parsed = readJsonFromLocalStorage(DOWNLOAD_CACHE_KEY, null);
    return parsed && typeof parsed === "object" ? parsed : {};
  };
  const setCache = (cache) => {
    writeJsonToLocalStorage(DOWNLOAD_CACHE_KEY, cache);
  };

  const state = {
    queue: [],
    index: -1,
    track: null,
    isPlaying: false,
    liked: false,
    playContext: null,
    downloadUuid: null,
    lastDownloadError: null,
    lastDownloadStack: "",
    lastDownloadDebug: null,
    isDisabled: false,
    disabledReason: null,
    resumeFrom: 0,
  };

  const lib = getLocalLibrary();

  const emitState = () => {
    const trackId = resolveTrackId(state.track);
    window.dispatchEvent(
      new CustomEvent("player:change", {
        detail: {
          trackId: Number.isFinite(trackId) ? trackId : null,
          isPlaying: Boolean(state.isPlaying),
          title: String(state.track?.title || ""),
          artist: String(state.track?.artist || ""),
        },
      }),
    );
  };

  const el = {
    root: document.querySelector("footer.player"),
    cover: document.getElementById("playerCover"),
    title: document.getElementById("playerTitle"),
    artist: document.getElementById("playerArtist"),
    likeBtn: document.getElementById("playerLikeBtn"),
    playBtn: document.getElementById("playerPlayBtn"),
    prevBtn: document.getElementById("playerPrevBtn"),
    nextBtn: document.getElementById("playerNextBtn"),
    timeCur: document.getElementById("playerTimeCurrent"),
    timeTotal: document.getElementById("playerTimeTotal"),
    seek: document.getElementById("playerSeek"),
    volume: document.getElementById("playerVolume"),
    audioSettingsBtn: document.getElementById("playerAudioSettingsBtn"),
  };

  // Player state can disable most controls (e.g. download failures), but liking should always be available.
  try {
    el.likeBtn?.removeAttribute?.("disabled");
    if (el.likeBtn) el.likeBtn.disabled = false;
  } catch {}

  const playerEls = {
    left: el.root?.querySelector?.(".player__left") || null,
    center: el.root?.querySelector?.(".player__center") || null,
    right: el.root?.querySelector?.(".player__right") || null,
    meta: el.root?.querySelector?.(".player__meta") || null,
  };

  const metaFit = createPlayerMetaFit({
    rootEl: el.root,
    leftEl: playerEls.left,
    metaEl: playerEls.meta,
    coverEl: el.cover,
    likeBtn: el.likeBtn,
    titleEl: el.title,
    artistEl: el.artist,
  });
  const syncPlayerMetaFit = metaFit.sync;
  metaFit.wire?.();

  const audioGraph = createPlayerAudioGraph({ audio });
  let normalizeEnabled = getNormalizeSetting();

  const applyNormalizeRouting = async (enabled) => {
    normalizeEnabled = Boolean(enabled);
    setNormalizeSetting(normalizeEnabled);
    return audioGraph.applyNormalizeRouting(normalizeEnabled);
  };

  const setDisabled = (disabled, reason = null) => {
    state.isDisabled = Boolean(disabled);
    state.disabledReason = disabled ? String(reason || "Playback disabled") : null;
    if (el.root) el.root.classList.toggle("is-disabled", state.isDisabled);

    if (el.root) {
      const interactive = Array.from(el.root.querySelectorAll("button, input"));
      for (const node of interactive) {
        try {
          // Allow audio settings to be opened even when playback is disabled.
          if (node?.id === "playerAudioSettingsBtn") continue;
          // Always allow liking/unliking (and ensure it never gets stuck disabled).
          if (node?.id === "playerLikeBtn") {
            node.removeAttribute("disabled");
            try {
              node.disabled = false;
            } catch {}
            continue;
          }
          if (node?.closest?.(".player-audio-popover")) continue;
          if (state.isDisabled) node.setAttribute("disabled", "disabled");
          else node.removeAttribute("disabled");
        } catch {}
      }
    }
  };

  const setPlayIcon = (playing) => {
    const icon = el.playBtn?.querySelector?.('[data-icon="playpause"]');
    if (!icon) return;
    el.playBtn.dataset.play = playing ? "playing" : "paused";
    icon.classList.toggle("ri-play-fill", !playing);
    icon.classList.toggle("ri-pause-fill", playing);
  };

  const setLikeIcon = (liked) => {
    const icon = el.likeBtn?.querySelector?.("i");
    if (!icon) return;
    icon.classList.toggle("ri-heart-fill", liked);
    icon.classList.toggle("ri-heart-line", !liked);
  };

  const { hasAudioSrc, persistPlayback, restorePlayback, setNowPlayingUI, seekAfterLoad, playResolvedTrackUrl } =
    createPlaybackSession({
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
      lastPlaybackKey: LAST_PLAYBACK_KEY,
      emitState,
      setPlayIcon,
      setLikeIcon,
      syncPlayerMetaFit,
    });

  const { rememberDownloadMeta, attemptDownloadAndPlay } = createDownloadPlayback({
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
  });

  // Clear download cache entries when tracks are removed from library.
  window.addEventListener("local-library:trackRemoved", (e) => {
    const trackId = Number(e.detail?.trackId);
    if (!Number.isFinite(trackId) || trackId <= 0) return;
    const cache = getCache();
    let changed = false;
    for (const key of Object.keys(cache)) {
      if (key.startsWith(`${trackId}:`)) {
        delete cache[key];
        changed = true;
      }
    }
    if (changed) setCache(cache);
  });

  const switchQualityForCurrentTrack = async () => {
    const cur = state.track;
    const trackId = resolveTrackId(cur);
    if (!trackId) return;

    const prevSrc = String(audio.getAttribute("src") || "");
    const prevTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const wasPlaying = Boolean(state.isPlaying);

    // Try switching to the new quality, resuming at the same position.
    const ok = await attemptDownloadAndPlay(cur, { startTime: prevTime, autoPlay: wasPlaying });
    if (ok) return;

    // If switching fails, keep the current audio going (don't strand the user).
    if (prevSrc) {
      audio.src = prevSrc;
      audio.currentTime = 0;
      setNowPlayingUI(cur);
      seekAfterLoad(prevTime);
      if (wasPlaying) {
        try {
          await audio.play();
          state.isPlaying = true;
          setPlayIcon(true);
        } catch {
          state.isPlaying = false;
          setPlayIcon(false);
        }
      } else {
        try {
          audio.pause();
        } catch {}
        state.isPlaying = false;
        setPlayIcon(false);
      }
      emitState();
    }
  };

  const { playIndex, setQueueAndPlay, enqueue, playUrl, togglePlayPause, playPrev, playNext } =
    createPlayerTransportControls({
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
    });

  const { refreshLikeStatus, toggleLike } = createPlayerLikeControls({
    state,
    lib,
    resolveTrackId,
    setLikeIcon,
    getDownloadQualityRaw,
    rememberDownloadMeta,
  });

  wirePlayerEventBindings({
    el,
    audio,
    state,
    formatDuration,
    updateRangeFill,
    hasAudioSrc,
    persistPlayback,
    setPlayIcon,
    emitState,
    togglePlayPause,
    playPrev,
    playNext,
    toggleLike,
  });

  if (normalizeEnabled) {
    // Apply routing lazily; if the browser requires a gesture, it will resume on the first click/toggle.
    void applyNormalizeRouting(true);
  }

  const createAudioMenu = () =>
    createPlayerAudioMenu({
      rootEl: el.root,
      audioSettingsBtn: el.audioSettingsBtn,
      getQualitySetting,
      setQualitySetting,
      switchQualityForCurrentTrack,
      applyNormalizeRouting,
      getNormalizeEnabled: () => normalizeEnabled,
      setNormalizeEnabled: (v) => {
        normalizeEnabled = Boolean(v);
      },
      getAudioCtx: () => audioGraph.getAudioCtx(),
    });

  bootstrapPlayerCapabilities({ getQualitySetting });

  restorePlayback();

  window.addEventListener("beforeunload", () => {
    persistPlayback(true, state.resumeFrom);
  });

  createAudioMenu();

  return {
    setQueueAndPlay,
    playIndex,
    enqueue,
    playUrl,
    togglePlayPause,
    refreshLikeStatus,
    attemptDownloadAndPlay,
    getState: () => ({ ...state }),
  };
}
