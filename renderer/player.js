import { formatDuration, updateRangeFill, readJsonFromLocalStorage, writeJsonToLocalStorage } from "./utils.js";
import { getLocalLibrary } from "./localLibrary.js";

export function createPlayerController() {
  const audio = new Audio();
  audio.preload = "none";

  let isSeeking = false;
  let seekEndTimer = null;

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

  const AUDIO_QUALITY_KEY = "spotify.downloadQuality";
  const NORMALIZE_AUDIO_KEY = "spotify.normalizeAudio";

  const normalizeQuality = (q) => {
    const v = String(q || "").toLowerCase();
    if (v === "flac" || v === "mp3_320" || v === "mp3_128") return v;
    return "mp3_128";
  };

  const clampQualityForCapabilities = (q) => {
    const v = normalizeQuality(q);
    const caps = window.__dzCapabilities && typeof window.__dzCapabilities === "object" ? window.__dzCapabilities : null;
    const canHQ = Boolean(caps?.can_stream_hq);
    const canLossless = Boolean(caps?.can_stream_lossless);
    if (v === "flac" && !canLossless) return canHQ ? "mp3_320" : "mp3_128";
    if (v === "mp3_320" && !canHQ) return "mp3_128";
    return v;
  };

  const getQualitySetting = () => clampQualityForCapabilities(localStorage.getItem(AUDIO_QUALITY_KEY) || "mp3_128");
  const setQualitySetting = (q) => {
    const v = clampQualityForCapabilities(q);
    localStorage.setItem(AUDIO_QUALITY_KEY, v);
    return v;
  };

  const getNormalizeSetting = () => {
    const raw = localStorage.getItem(NORMALIZE_AUDIO_KEY);
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return false;
  };
  const setNormalizeSetting = (enabled) => {
    localStorage.setItem(NORMALIZE_AUDIO_KEY, enabled ? "true" : "false");
  };

  const DOWNLOAD_CACHE_KEY = "spotify.downloadCache.v2";
  const LAST_PLAYBACK_KEY = "spotify.lastPlayback.v1";
  const getCache = () => {
    try {
      const raw = localStorage.getItem(DOWNLOAD_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const setCache = (cache) => {
    try {
      localStorage.setItem(DOWNLOAD_CACHE_KEY, JSON.stringify(cache));
    } catch {}
  };

  const state = {
    queue: [],
    index: -1,
    track: null,
    isPlaying: false,
    liked: false,
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

  const syncPlayerMetaFit = () => {
    const root = el.root;
    const left = playerEls.left;
    const meta = playerEls.meta;
    if (!root || !left || !meta) return;

    const leftRect = left.getBoundingClientRect();
    const coverRect = el.cover?.getBoundingClientRect?.();
    const likeRect = el.likeBtn?.getBoundingClientRect?.();

    const gap = (() => {
      try {
        const cs = getComputedStyle(left);
        const g = parseFloat(cs.gap || cs.columnGap || "0");
        return Number.isFinite(g) && g >= 0 ? g : 12;
      } catch {
        return 12;
      }
    })();

    const paddingBuffer = 10; // keep a little breathing room between meta and the like button
    const maxW = (() => {
      if (coverRect && likeRect) {
        const usable = likeRect.left - coverRect.right - gap * 2 - paddingBuffer;
        return Math.max(120, Math.floor(usable));
      }
      const coverW = coverRect?.width || 56;
      const likeW = likeRect?.width || 34;
      return Math.max(120, Math.floor(leftRect.width - coverW - likeW - gap * 2 - paddingBuffer));
    })();
    meta.style.maxWidth = `${maxW}px`;

    const titleEl = el.title;
    const artistEl = el.artist;
    const needsFade =
      (titleEl && titleEl.scrollWidth > titleEl.clientWidth + 2) || (artistEl && artistEl.scrollWidth > artistEl.clientWidth + 2);
    meta.classList.toggle("is-fading", Boolean(needsFade));
  };

  try {
    if (typeof ResizeObserver === "function" && el.root) {
      const ro = new ResizeObserver(() => syncPlayerMetaFit());
      ro.observe(el.root);
    } else {
      window.addEventListener("resize", () => syncPlayerMetaFit());
    }
  } catch {}

  let audioCtx = null;
  let audioSource = null;
  let audioGain = null;
  let audioCompressor = null;
  let normalizeEnabled = getNormalizeSetting();

  const ensureAudioGraph = () => {
    if (audioCtx && audioSource && audioGain) return true;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (typeof Ctx !== "function") return false;
    try {
      audioCtx = new Ctx();
      audioSource = audioCtx.createMediaElementSource(audio);
      audioGain = audioCtx.createGain();
      audioGain.gain.value = 1;
      audioCompressor = audioCtx.createDynamicsCompressor();
      audioCompressor.threshold.value = -24;
      audioCompressor.knee.value = 18;
      audioCompressor.ratio.value = 4;
      audioCompressor.attack.value = 0.003;
      audioCompressor.release.value = 0.25;
      return true;
    } catch {
      audioCtx = null;
      audioSource = null;
      audioGain = null;
      audioCompressor = null;
      return false;
    }
  };

  const applyNormalizeRouting = async (enabled) => {
    normalizeEnabled = Boolean(enabled);
    setNormalizeSetting(normalizeEnabled);
    if (!ensureAudioGraph()) return;
    try {
      await audioCtx.resume();
    } catch {}
    try {
      audioSource.disconnect();
    } catch {}
    try {
      audioCompressor.disconnect();
    } catch {}
    try {
      audioGain.disconnect();
    } catch {}

    try {
      if (normalizeEnabled) audioSource.connect(audioCompressor);
      if (normalizeEnabled) audioCompressor.connect(audioGain);
      else audioSource.connect(audioGain);
      audioGain.connect(audioCtx.destination);
    } catch {}
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

  function resolveTrackId(track) {
    const t = track && typeof track === "object" ? track : null;
    if (!t) return null;
    const raw0 = t?.raw && typeof t.raw === "object" ? t.raw : t;
    const raw = raw0?.raw && typeof raw0.raw === "object" ? raw0.raw : raw0;
    const id = Number(t?.id ?? raw?.id ?? raw?.SNG_ID ?? raw?.trackId ?? raw?.data?.SNG_ID ?? raw?.data?.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  const snapshotTrack = (track) => {
    const t = track && typeof track === "object" ? track : null;
    if (!t) return null;
    const raw0 = t?.raw && typeof t.raw === "object" ? t.raw : t;
    const raw = raw0?.raw && typeof raw0.raw === "object" ? raw0.raw : raw0;
    const id = resolveTrackId(t);
    const title = String(t?.title || raw?.title || raw?.SNG_TITLE || "");
    const artistName = String(t?.artist || raw?.artist?.name || raw?.ART_NAME || "");
    const duration = Number(t?.duration || raw?.duration || raw?.DURATION || 0) || 0;
    const preview = String(t?.preview || raw?.preview || "");
    const cover = String(t?.cover || raw?.cover || raw?.album?.cover_medium || raw?.album?.cover || "");
    const artist = raw?.artist && typeof raw.artist === "object" ? raw.artist : { name: artistName };
    const album =
      raw?.album && typeof raw.album === "object"
        ? raw.album
        : cover
          ? { cover_small: cover, cover_medium: cover, cover }
          : undefined;
    return {
      id,
      title,
      duration,
      preview,
      artist,
      album,
      ...(cover ? { cover } : {}),
    };
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
    writeJsonToLocalStorage(LAST_PLAYBACK_KEY, {
      track,
      progress: floored,
      duration: Number(track.duration) || 0,
      updatedAt: now,
    });
  };

  const restorePlayback = () => {
    const saved = readJsonFromLocalStorage(LAST_PLAYBACK_KEY, null);
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

  const normalizeTrack = (t) => {
    if (!t || typeof t !== "object") return null;
    const id = Number(t?.id || t?.SNG_ID || t?.trackId || t?.data?.SNG_ID || t?.data?.id);
    const title = String(t?.title || t?.SNG_TITLE || t?.data?.SNG_TITLE || t?.data?.title || "");
    const artist = String(t?.artist?.name || t?.ART_NAME || t?.data?.ART_NAME || t?.data?.artist || "");
    const duration = Number(t?.duration || t?.DURATION || t?.data?.DURATION || t?.data?.duration || 0) || 0;
    const preview = String(t?.preview || t?.data?.preview || "");
    const md5 = String(t?.ALB_PICTURE || t?.data?.ALB_PICTURE || "");
    const md5Cover =
      md5 && /^[a-f0-9]{32}$/i.test(md5)
        ? `https://e-cdns-images.dzcdn.net/images/cover/${md5}/100x100-000000-80-0-0.jpg`
        : "";
    const album = t?.album && typeof t.album === "object" ? t.album : t?.data?.album && typeof t.data.album === "object" ? t.data.album : null;
    const cover = String(album?.cover_small || album?.cover_medium || album?.cover || t?.cover || t?.data?.cover || md5Cover || "") || "";
    return { id: Number.isFinite(id) ? id : null, title, artist, duration, preview, cover, raw: t };
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
      lib.addRecentTrack?.(libTrack);
    } catch {}
    return true;
  };

  const rememberDownloadMeta = (track) => {
    const id = resolveTrackId(track);
    if (!Number.isFinite(id) || id <= 0) return;
    const title = String(track?.title || "");
    const artist = String(track?.artist || "");
    const cover = String(track?.cover || "");
    const map = window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById : {};
    map[String(id)] = { title, artist, cover, at: Date.now() };
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

    // Prefer any already-known downloaded file for this track before downloading again,
    // but only if it matches the requested audio quality (when known).
    try {
      const rawDownload = track?.raw?.download && typeof track.raw.download === "object" ? track.raw.download : null;
      const rawFileUrl = rawDownload?.fileUrl ? String(rawDownload.fileUrl) : "";
      const rawQuality = rawDownload?.quality ? normalizeQuality(rawDownload.quality) : "";
      const matches = !rawQuality || rawQuality === quality;
      if (rawFileUrl && matches) {
        const ok = await playResolvedTrackUrl(track, {
          fileUrl: rawFileUrl,
          downloadUuid: track?.raw?.download?.uuid || null,
          startTime,
          autoPlay,
        });
        if (ok) {
          console.log("using embedded download fileUrl", { fileUrl: rawFileUrl });
          console.groupEnd();
          return true;
        }
      }
    } catch {}

    try {
      const preferred = normalizeQuality(quality);
      if (window.dl?.resolveTrack && preferred) {
        const resolved = await window.dl.resolveTrack({ id: trackId, quality: preferred });
        const fileUrl = resolved?.fileUrl ? String(resolved.fileUrl) : "";
        const gotQuality = resolved?.quality ? normalizeQuality(resolved.quality) : "";
        const match = gotQuality && preferred && gotQuality === preferred;
        if (resolved?.ok && resolved?.exists && fileUrl && match) {
          const ok = await playResolvedTrackUrl(track, { fileUrl, downloadUuid: resolved?.uuid || null, startTime, autoPlay });
          if (ok) {
            try {
              console.log("using downloads DB fileUrl", { fileUrl, quality: gotQuality || preferred });
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
      const dlQuality = dl?.quality ? normalizeQuality(dl.quality) : "";
      const matches = !dlQuality || dlQuality === quality;
      if (fileUrl) {
        const ok = matches ? await playResolvedTrackUrl(track, { fileUrl, downloadUuid: dl?.uuid || null, startTime, autoPlay }) : false;
        if (ok) {
          console.log("using library download fileUrl", { fileUrl });
          console.groupEnd();
          return true;
        }
      }
    } catch {}

    const cache = getCache();
    const cacheKey = `${trackId}:${String(quality || "").toLowerCase()}`;
    const cached = cache[cacheKey];
    if (cached?.fileUrl) {
      try {
        console.log("cache hit", cached);
      } catch {}
      const ok = await playResolvedTrackUrl(track, { fileUrl: cached.fileUrl, downloadUuid: cached.uuid || null, startTime, autoPlay });
      try {
        console.groupEnd();
      } catch {}
      if (ok) return true;
    }

    state.downloadUuid = `dl_${trackId}_${qualityKey === "flac" ? 9 : qualityKey === "mp3_320" ? 3 : 1}`;
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

    // Always record downloads (even if the user didn't "like" the track).
    try {
      lib.upsertDownloadedTrack?.({
        track: track.raw || track,
        fileUrl: res.fileUrl,
        downloadPath: res.downloadPath || "",
        quality,
        uuid: res.uuid || state.downloadUuid || null,
      });
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

  const setQueueAndPlay = async (queue, index) => {
    setDisabled(false);
    state.lastDownloadError = null;
    state.lastDownloadStack = "";
    state.lastDownloadDebug = null;
    state.queue = Array.isArray(queue) ? queue.slice() : [];
    await playIndex(index);
  };

  const enqueue = (tracks) => {
    const items = Array.isArray(tracks) ? tracks : [tracks];
    const cleaned = items
      .map((t) => (t && typeof t === "object" ? (t.raw && typeof t.raw === "object" ? t.raw : t) : null))
      .filter(Boolean);
    if (cleaned.length === 0) return;

    // If we're currently playing something but have no queue (e.g. played a single URL),
    // seed the queue with the current track so enqueued items make sense.
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

  const refreshLikeStatus = async () => {
    const trackId = resolveTrackId(state.track);
    if (!trackId) return;
    state.liked = lib.isTrackSaved(trackId);
    setLikeIcon(state.liked);
  };

  const toggleLike = async () => {
    const trackId = resolveTrackId(state.track);
    if (!trackId) return;

    const nextLiked = !state.liked;
    state.liked = nextLiked;
    setLikeIcon(nextLiked);
    try {
      if (nextLiked) {
        const raw0 = state.track?.raw && typeof state.track.raw === "object" ? state.track.raw : null;
        const raw1 = raw0?.raw && typeof raw0.raw === "object" ? raw0.raw : raw0;
        const rawId = Number(raw1?.id || raw1?.SNG_ID);
        const payload =
          Number.isFinite(rawId) && rawId > 0
            ? raw1
            : {
                id: trackId,
                title: String(state.track.title || ""),
                duration: Number(state.track.duration) || 0,
                artist: { name: String(state.track.artist || "") },
                ...(state.track.cover
                  ? { album: { cover_small: String(state.track.cover), cover_medium: String(state.track.cover), cover: String(state.track.cover) } }
                  : {}),
              };
        const ok = lib.addSavedTrack(payload);
        if (!ok) throw new Error("save_failed");
      } else {
        const ok = lib.removeSavedTrack(trackId);
        if (!ok) throw new Error("unsave_failed");
      }

      if (nextLiked && window.dl?.downloadTrack) {
        const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";
        rememberDownloadMeta(state.track);
        const uuid = `dl_${trackId}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
        try {
          lib.upsertDownloadedTrack?.({
            track: state.track.raw || state.track,
            fileUrl: "",
            downloadPath: "",
            quality,
            uuid,
          });
        } catch {}
        const trackPayload = state.track?.raw && typeof state.track.raw === "object" ? state.track.raw : state.track;
        const albumPayload =
          trackPayload?.album && typeof trackPayload.album === "object"
            ? trackPayload.album
            : state.track?.album && typeof state.track.album === "object"
              ? state.track.album
              : null;
        void window.dl.downloadTrack({ id: trackId, quality, uuid, track: trackPayload, album: albumPayload });
      }
    } catch {
      state.liked = !nextLiked;
      setLikeIcon(state.liked);
    }
  };

  if (el.playBtn) el.playBtn.addEventListener("click", () => void togglePlayPause());
  if (el.prevBtn) el.prevBtn.addEventListener("click", () => void playPrev());
  if (el.nextBtn) el.nextBtn.addEventListener("click", () => void playNext());
  if (el.likeBtn) el.likeBtn.addEventListener("click", () => void toggleLike());

  if (el.volume) {
    const setVol = () => {
      const v = Number(el.volume.value || 0);
      audio.volume = Math.max(0, Math.min(1, v / 100));
      updateRangeFill(el.volume);
    };
    el.volume.addEventListener("input", setVol);
    setVol();
  }

  if (el.seek) {
    const beginSeek = () => {
      isSeeking = true;
      if (seekEndTimer) {
        clearTimeout(seekEndTimer);
        seekEndTimer = null;
      }
    };
    const endSeekSoon = () => {
      if (seekEndTimer) clearTimeout(seekEndTimer);
      seekEndTimer = setTimeout(() => {
        isSeeking = false;
        seekEndTimer = null;
      }, 0);
    };

    try {
      el.seek.addEventListener("pointerdown", beginSeek);
      window.addEventListener("pointerup", endSeekSoon);
      window.addEventListener("pointercancel", endSeekSoon);
    } catch {}
    try {
      el.seek.addEventListener("mousedown", beginSeek);
      window.addEventListener("mouseup", endSeekSoon);
    } catch {}
    try {
      el.seek.addEventListener("touchstart", beginSeek, { passive: true });
      window.addEventListener("touchend", endSeekSoon, { passive: true });
      window.addEventListener("touchcancel", endSeekSoon, { passive: true });
    } catch {}
    try {
      el.seek.addEventListener("blur", endSeekSoon);
    } catch {}

    el.seek.addEventListener("input", () => {
      updateRangeFill(el.seek);
      const preview = Number(el.seek.value || 0);
      if (Number.isFinite(preview) && el.timeCur) el.timeCur.textContent = formatDuration(preview);
    });
    el.seek.addEventListener("change", () => {
      const v = Number(el.seek.value || 0);
      if (Number.isFinite(v)) {
        const max = Number(el.seek.max || 0);
        const clamped = Math.max(0, Number.isFinite(max) && max > 0 ? Math.min(v, max) : v);
        const hasSrc = hasAudioSrc();
        if (hasSrc) {
          try {
            audio.currentTime = clamped;
          } catch {}
          if (el.timeCur) el.timeCur.textContent = formatDuration(clamped);
          persistPlayback(true, clamped);
        } else {
          state.resumeFrom = Math.max(0, Math.floor(clamped));
          if (el.timeCur) el.timeCur.textContent = formatDuration(state.resumeFrom);
          persistPlayback(true, state.resumeFrom);
        }
      }
      isSeeking = false;
      if (seekEndTimer) {
        clearTimeout(seekEndTimer);
        seekEndTimer = null;
      }
    });
  }

  audio.addEventListener("timeupdate", () => {
    if (!state.track) return;
    const cur = audio.currentTime || 0;
    if (!isSeeking) {
      if (el.timeCur) el.timeCur.textContent = formatDuration(cur);
      if (el.seek) {
        el.seek.value = String(Math.floor(cur));
        updateRangeFill(el.seek);
      }
    }
    persistPlayback();
  });

  audio.addEventListener("loadedmetadata", () => {
    const total = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (el.timeTotal) el.timeTotal.textContent = formatDuration(total || (state.track?.duration || 0));
    if (el.seek) {
      el.seek.max = String(Math.max(1, Math.floor(total || state.track?.duration || 1)));
      updateRangeFill(el.seek);
    }
  });

  audio.addEventListener("ended", () => void playNext());
  audio.addEventListener("pause", () => {
    state.isPlaying = false;
    setPlayIcon(false);
    emitState();
    persistPlayback(true);
  });
  audio.addEventListener("play", () => {
    state.isPlaying = true;
    setPlayIcon(true);
    emitState();
  });

  if (normalizeEnabled) {
    // Apply routing lazily; if the browser requires a gesture, it will resume on the first click/toggle.
    void applyNormalizeRouting(true);
  }

  const createAudioMenu = () => {
    if (!el.root || !el.audioSettingsBtn) return null;

    const wrap = document.createElement("div");
    wrap.className = "player-audio-popover";
    wrap.hidden = true;

    const panel = document.createElement("div");
    panel.className = "player-audio-popover__panel";

    const title = document.createElement("div");
    title.className = "player-audio-popover__title";
    title.textContent = "Audio Quality";
    panel.appendChild(title);

    const options = [
      { value: "mp3_128", label: "Normal", sub: "MP3 • 128 kbps" },
      { value: "mp3_320", label: "High", sub: "MP3 • 320 kbps" },
      { value: "flac", label: "Lossless", sub: "FLAC" },
    ];

    const optionButtons = [];
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "player-audio-option";
      btn.dataset.quality = opt.value;
      btn.innerHTML =
        `<span class="player-audio-option__main">` +
        `<span class="player-audio-option__label">${opt.label}</span>` +
        `<span class="player-audio-option__sub">${opt.sub}</span>` +
        `</span>` +
        `<span class="player-audio-option__right">` +
        `<span class="player-audio-option__lock"><i class="ri-lock-2-line icon" aria-hidden="true"></i></span>` +
        `<span class="player-audio-option__check"><i class="ri-check-line icon" aria-hidden="true"></i></span>` +
        `</span>`;
      optionButtons.push(btn);
      panel.appendChild(btn);
    }

    const divider = document.createElement("div");
    divider.className = "player-audio-divider";
    panel.appendChild(divider);

    const toggleRow = document.createElement("div");
    toggleRow.className = "player-audio-toggle";
    toggleRow.innerHTML =
      `<div>` +
      `<div class="player-audio-toggle__label">Normalize audio</div>` +
      `<div class="player-audio-toggle__desc">Adjusts sound to maintain the same volume level</div>` +
      `</div>`;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle-switch";
    toggle.setAttribute("aria-label", "Normalize audio");
    toggle.dataset.on = normalizeEnabled ? "true" : "false";
    toggleRow.appendChild(toggle);
    panel.appendChild(toggleRow);

    wrap.appendChild(panel);
    document.body.appendChild(wrap);

    const applyEntitlements = (caps) => {
      const canHQ = Boolean(caps?.can_stream_hq);
      const canLossless = Boolean(caps?.can_stream_lossless);
      for (const btn of optionButtons) {
        const q = String(btn.dataset.quality || "");
        const disabled = (q === "mp3_320" && !canHQ) || (q === "flac" && !canLossless);
        btn.disabled = disabled;
        btn.classList.toggle("is-disabled", disabled);
      }

      const normalized = getQualitySetting();
      const raw = localStorage.getItem(AUDIO_QUALITY_KEY) || "";
      if (raw && normalizeQuality(raw) !== normalized) {
        localStorage.setItem(AUDIO_QUALITY_KEY, normalized);
      }
    };

    const loadEntitlements = async () => {
      if (!window.dz?.getCapabilities) {
        window.__dzCapabilities = { can_stream_hq: false, can_stream_lossless: false };
        return window.__dzCapabilities;
      }
      try {
        const res = await window.dz.getCapabilities();
        const caps = res?.ok && res?.capabilities && typeof res.capabilities === "object" ? res.capabilities : null;
        window.__dzCapabilities = {
          can_stream_hq: Boolean(caps?.can_stream_hq),
          can_stream_lossless: Boolean(caps?.can_stream_lossless),
        };
      } catch {
        window.__dzCapabilities = { can_stream_hq: false, can_stream_lossless: false };
      }
      return window.__dzCapabilities;
    };

    const sync = () => {
      const caps = window.__dzCapabilities && typeof window.__dzCapabilities === "object" ? window.__dzCapabilities : null;
      applyEntitlements(caps);
      const q = getQualitySetting();
      for (const btn of optionButtons) btn.classList.toggle("is-active", btn.dataset.quality === q);
      toggle.dataset.on = normalizeEnabled ? "true" : "false";
      toggle.setAttribute("aria-pressed", normalizeEnabled ? "true" : "false");
    };

    const position = () => {
      const rect = el.audioSettingsBtn.getBoundingClientRect();
      wrap.style.left = `${Math.round(rect.right)}px`;
      wrap.style.top = `${Math.round(rect.top)}px`;
    };

    const close = () => {
      wrap.hidden = true;
    };
    const open = async () => {
      wrap.hidden = false;
      position();
      const caps = await loadEntitlements();
      applyEntitlements(caps);
      sync();
      if (audioCtx) {
        try {
          await audioCtx.resume();
        } catch {}
      }
    };
    const toggleOpen = () => {
      if (wrap.hidden) void open();
      else close();
    };

    el.audioSettingsBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleOpen();
    });

    panel.addEventListener("click", (event) => {
      const btn = event.target?.closest?.(".player-audio-option");
      if (btn) {
        event.preventDefault();
        if (btn.disabled || btn.classList.contains("is-disabled")) return;
        setQualitySetting(btn.dataset.quality);
        sync();

        // Keep current track position while switching quality.
        void switchQualityForCurrentTrack();
        return;
      }
    });

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      normalizeEnabled = !normalizeEnabled;
      void applyNormalizeRouting(normalizeEnabled);
      sync();
    });

    document.addEventListener("mousedown", (event) => {
      if (wrap.hidden) return;
      if (event.target === el.audioSettingsBtn || el.audioSettingsBtn.contains(event.target)) return;
      if (wrap.contains(event.target)) return;
      close();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (wrap.hidden) return;
      close();
    });

    window.addEventListener("resize", () => {
      if (wrap.hidden) return;
      position();
    });

    sync();
    return { open, close, sync };
  };

  // Load entitlements shortly after boot so other download triggers don't try to use locked qualities.
  setTimeout(() => {
    if (!window.dz?.getCapabilities) return;
    void window.dz
      .getCapabilities()
      .then((res) => {
        const caps = res?.ok && res?.capabilities && typeof res.capabilities === "object" ? res.capabilities : null;
        window.__dzCapabilities = {
          can_stream_hq: Boolean(caps?.can_stream_hq),
          can_stream_lossless: Boolean(caps?.can_stream_lossless),
        };
        localStorage.setItem(AUDIO_QUALITY_KEY, getQualitySetting());
      })
      .catch(() => {
        window.__dzCapabilities = { can_stream_hq: false, can_stream_lossless: false };
        localStorage.setItem(AUDIO_QUALITY_KEY, getQualitySetting());
      });
  }, 1200);

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
    refreshLikeStatus,
    attemptDownloadAndPlay,
    getState: () => ({ ...state }),
  };
}
