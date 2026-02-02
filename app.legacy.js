function updateRangeFill(range) {
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  const value = Number(range.value || 0);
  const pct = ((value - min) / (max - min)) * 100;
  range.style.setProperty("--pct", `${pct}%`);
}

function wirePlatformClasses() {
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";

  const isElectron = /\bElectron\/\d+/i.test(ua);
  const isMac = /Mac/i.test(platform) || /Macintosh/i.test(ua);

  const root = document.documentElement;
  root.classList.toggle("is-electron", isElectron);
  root.classList.toggle("is-mac", isMac);
}

function wireRanges() {
  const ranges = document.querySelectorAll(".range");
  for (const range of ranges) {
    updateRangeFill(range);
    range.addEventListener("input", () => updateRangeFill(range));
  }
}

function wireChips() {
  const chips = Array.from(document.querySelectorAll(".chip"));
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      for (const c of chips) {
        c.classList.toggle("is-active", c === chip);
        c.setAttribute("aria-selected", c === chip ? "true" : "false");
      }
    });
  }
}

function wirePlayToggle() {
  const playBtn = document.querySelector(".play-btn");
  if (!playBtn) return;

  const icon = playBtn.querySelector('[data-icon="playpause"]');
  if (!icon) return;

  playBtn.addEventListener("click", () => {
    const isPaused = playBtn.dataset.play !== "playing";
    const nextState = isPaused ? "playing" : "paused";
    playBtn.dataset.play = nextState;

    icon.classList.toggle("ri-play-fill", nextState === "paused");
    icon.classList.toggle("ri-pause-fill", nextState === "playing");
  });
}

function createPlayerController() {
  const audio = new Audio();
  audio.preload = "none";

  const DOWNLOAD_CACHE_KEY = "spotify.downloadCache.v1";
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
  };

  const lib = window.__localLibrary || (window.__localLibrary = createLocalLibrary());

  const emitState = () => {
    const trackId = state.track?.id ?? null;
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

  const normalizeTrack = (t) => {
    if (!t || typeof t !== "object") return null;
    const id = Number(t?.id || t?.SNG_ID);
    const title = String(t?.title || t?.SNG_TITLE || "");
    const artist = String(t?.artist?.name || t?.ART_NAME || "");
    const duration = Number(t?.duration || t?.DURATION || 0) || 0;
    const preview = String(t?.preview || "");
    const md5 = String(t?.ALB_PICTURE || "");
    const md5Cover =
      md5 && /^[a-f0-9]{32}$/i.test(md5)
        ? `https://e-cdns-images.dzcdn.net/images/cover/${md5}/100x100-000000-80-0-0.jpg`
        : "";
    const cover = String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || md5Cover || "") || "";
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
  };

  const playResolvedTrackUrl = async (track, { fileUrl, downloadUuid }) => {
    const src = String(fileUrl || "");
    if (!src) return false;
    state.downloadUuid = downloadUuid || null;

    audio.src = src;
    audio.currentTime = 0;
    setNowPlayingUI(track);
    try {
      await audio.play();
      state.isPlaying = true;
      setPlayIcon(true);
    } catch {
      state.isPlaying = false;
      setPlayIcon(false);
    }
    emitState();
    return true;
  };

  const attemptDownloadAndPlay = async (track) => {
    if (!track?.id || !window.dl?.downloadTrack) return false;
    const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";

    // Cache hit
    const cache = getCache();
    const cached = cache[String(track.id)];
    if (cached?.fileUrl) {
      return await playResolvedTrackUrl(track, { fileUrl: cached.fileUrl, downloadUuid: cached.uuid || null });
    }

    // Download
    state.downloadUuid = `track_${track.id}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
    setNowPlayingUI({ ...track, artist: "Downloading…" });
    setPlayIcon(false);

    const res = await window.dl.downloadTrack({ id: track.id, quality });
    if (!res?.ok || !res?.fileUrl) return false;
    state.downloadUuid = res.uuid || null;

    const nextCache = getCache();
    nextCache[String(track.id)] = { fileUrl: res.fileUrl, downloadPath: res.downloadPath || null, uuid: res.uuid || null, at: Date.now() };
    setCache(nextCache);

    if (lib.isTrackSaved(track.id)) {
      lib.upsertTrackDownload({
        trackId: track.id,
        fileUrl: res.fileUrl,
        downloadPath: res.downloadPath || "",
        quality,
      });
    }

    return await playResolvedTrackUrl(track, { fileUrl: res.fileUrl, downloadUuid: res.uuid || null });
  };

  const playIndex = async (nextIndex) => {
    const idx = Number(nextIndex);
    if (!Number.isFinite(idx) || idx < 0 || idx >= state.queue.length) return;

    const track = normalizeTrack(state.queue[idx]);
    state.index = idx;
    state.track = track;
    state.liked = lib.isTrackSaved(track?.id);
    state.downloadUuid = null;
    setLikeIcon(state.liked);
    emitState();

    // Spec: Play should download locally then play. If that fails, fall back to preview.
    const downloaded = await attemptDownloadAndPlay(track);
    if (downloaded) return;

    if (track?.preview) {
      audio.src = track.preview;
      audio.currentTime = 0;
      setNowPlayingUI(track);
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
    state.queue = Array.isArray(queue) ? queue.slice() : [];
    await playIndex(index);
  };

  const playUrl = async ({ url, title, artist, cover, duration, downloadUuid }) => {
    const src = String(url || "");
    if (!src) return;

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
    state.liked = false;
    setLikeIcon(false);
    emitState();

    audio.src = src;
    audio.currentTime = 0;
    setNowPlayingUI(state.track);
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
    if (!state.track) return;
    if (audio.paused) {
      try {
        await audio.play();
        state.isPlaying = true;
        setPlayIcon(true);
      } catch {
        state.isPlaying = false;
        setPlayIcon(false);
      }
      return;
    }
    audio.pause();
    state.isPlaying = false;
    setPlayIcon(false);
  };

  const playPrev = async () => {
    if (state.queue.length === 0) return;
    const next = Math.max(0, state.index - 1);
    await playIndex(next);
  };

  const playNext = async () => {
    if (state.queue.length === 0) return;
    const next = Math.min(state.queue.length - 1, state.index + 1);
    await playIndex(next);
  };

  const refreshLikeStatus = async () => {
    if (!state.track?.id) return;
    // Local-only saved state.
    state.liked = lib.isTrackSaved(state.track.id);
    setLikeIcon(state.liked);
  };

  const toggleLike = async () => {
    if (!state.track?.id) return;

    const nextLiked = !state.liked;
    state.liked = nextLiked;
    setLikeIcon(nextLiked);
    try {
      if (nextLiked) lib.addSavedTrack(state.track.raw || state.track);
      else lib.removeSavedTrack(state.track.id);

      // Spec: liking a song should download it too (but not auto-play).
      if (nextLiked && window.dl?.downloadTrack) {
        const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";
        void window.dl.downloadTrack({ id: state.track.id, quality });
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
    el.seek.addEventListener("input", () => updateRangeFill(el.seek));
    el.seek.addEventListener("change", () => {
      const v = Number(el.seek.value || 0);
      if (Number.isFinite(v)) audio.currentTime = v;
    });
  }

  audio.addEventListener("timeupdate", () => {
    if (!state.track) return;
    const cur = audio.currentTime || 0;
    if (el.timeCur) el.timeCur.textContent = formatDuration(cur);
    if (el.seek) {
      el.seek.value = String(Math.floor(cur));
      updateRangeFill(el.seek);
    }
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
  });
  audio.addEventListener("play", () => {
    state.isPlaying = true;
    setPlayIcon(true);
    emitState();
  });

  return {
    setQueueAndPlay,
    playIndex,
    playUrl,
    refreshLikeStatus,
    attemptDownloadAndPlay,
    getState: () => ({ ...state }),
  };
}

function wireQuickCards() {
  const cards = Array.from(document.querySelectorAll(".quick-card"));
  for (const card of cards) {
    card.addEventListener("click", (event) => {
      event.preventDefault();
      for (const c of cards) c.classList.toggle("is-playing", c === card);
    });
  }
}

function wireLibrarySelection() {
  const items = Array.from(document.querySelectorAll(".library-item"));
  for (const item of items) {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      for (const i of items) i.classList.toggle("is-active", i === item);
    });
  }
}

function wireLibraryFilters() {
  const filterButtons = Array.from(document.querySelectorAll(".library__filters .pill[data-filter]"));
  if (filterButtons.length === 0) return;

  const list = document.getElementById("libraryList") || document.querySelector(".library__list");
  if (!list) return;

  const applyFilter = (filter) => {
    for (const button of filterButtons) {
      const isActive = button.dataset.filter === filter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }

    const items = Array.from(list.querySelectorAll(".library-item[data-category]"));
    let firstVisible = null;
    for (const item of items) {
      const shouldShow = item.dataset.category === filter;
      item.hidden = !shouldShow;
      if (shouldShow && !firstVisible) firstVisible = item;
    }

    if (firstVisible) {
      for (const item of items) item.classList.toggle("is-active", item === firstVisible);
    }
  };

  for (const button of filterButtons) {
    button.addEventListener("click", () => applyFilter(button.dataset.filter));
  }

  const initial = filterButtons.find((b) => b.classList.contains("is-active"))?.dataset.filter ?? filterButtons[0].dataset.filter;
  applyFilter(initial);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wireSidebarResize() {
  const content = document.querySelector(".content");
  const splitter = document.querySelector(".splitter");
  if (!content || !splitter) return;

  const WIDTH_KEY = "spotify.sidebarWidth";
  const MIN_SIDEBAR = 300;
  const MIN_MAIN = 520;

  const applyWidth = (width) => {
    const nextWidth = Math.round(width);
    content.style.setProperty("--sidebar-width", `${nextWidth}px`);
    localStorage.setItem(WIDTH_KEY, String(nextWidth));
  };

  const saved = Number(localStorage.getItem(WIDTH_KEY));
  if (Number.isFinite(saved) && saved >= MIN_SIDEBAR) applyWidth(saved);

  const computeMaxWidth = () => {
    const rect = content.getBoundingClientRect();
    const styles = getComputedStyle(content);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const paddingRight = parseFloat(styles.paddingRight) || 0;
    const paneGap = splitter.getBoundingClientRect().width || 0;
    const available = rect.width - paddingLeft - paddingRight - paneGap;
    return Math.max(MIN_SIDEBAR, available - MIN_MAIN);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;

    splitter.setPointerCapture(event.pointerId);
    splitter.classList.add("is-dragging");
    document.documentElement.classList.add("is-resizing");

    const contentRect = content.getBoundingClientRect();
    const styles = getComputedStyle(content);
    const paddingLeft = parseFloat(styles.paddingLeft) || 0;
    const gridLeft = contentRect.left + paddingLeft;

    const startX = event.clientX;
    const splitterRect = splitter.getBoundingClientRect();
    const startWidth = splitterRect.left - gridLeft;
    const maxWidth = computeMaxWidth();

    const onPointerMove = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      const nextWidth = clamp(startWidth + dx, MIN_SIDEBAR, maxWidth);
      content.style.setProperty("--sidebar-width", `${Math.round(nextWidth)}px`);
    };

    const onPointerUp = () => {
      splitter.classList.remove("is-dragging");
      document.documentElement.classList.remove("is-resizing");

      const styles2 = getComputedStyle(content);
      const currentWidth = parseFloat(styles2.getPropertyValue("--sidebar-width")) || startWidth;
      applyWidth(currentWidth);

      splitter.removeEventListener("pointermove", onPointerMove);
      splitter.removeEventListener("pointerup", onPointerUp);
      splitter.removeEventListener("pointercancel", onPointerUp);
    };

    splitter.addEventListener("pointermove", onPointerMove);
    splitter.addEventListener("pointerup", onPointerUp);
    splitter.addEventListener("pointercancel", onPointerUp);
  };

  splitter.addEventListener("pointerdown", onPointerDown);

  splitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();

    const styles = getComputedStyle(content);
    const currentWidth = parseFloat(styles.getPropertyValue("--sidebar-width")) || MIN_SIDEBAR;
    const delta = event.shiftKey ? 48 : 16;
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const nextWidth = clamp(currentWidth + direction * delta, MIN_SIDEBAR, computeMaxWidth());
    applyWidth(nextWidth);
  });
}

function wireSidebarCollapse() {
  const content = document.querySelector(".content");
  const button = document.querySelector(".library__collapse");
  if (!content || !button) return;

  const COLLAPSE_KEY = "spotify.sidebarCollapsed";
  const WIDTH_KEY = "spotify.sidebarWidthBeforeCollapse";

  const isCollapsed = () => content.classList.contains("is-sidebar-collapsed");

  const applyCollapsed = (shouldCollapse) => {
    if (shouldCollapse) {
      // Save current width before collapsing
      const styles = getComputedStyle(content);
      const currentWidth = parseFloat(styles.getPropertyValue("--sidebar-width")) || 330;
      localStorage.setItem(WIDTH_KEY, String(currentWidth));
      
      // Add collapsed class (CSS handles the grid change)
      content.classList.add("is-sidebar-collapsed");
      button.setAttribute("aria-pressed", "true");
      button.setAttribute("aria-label", "Expand sidebar");
    } else {
      // Remove collapsed class
      content.classList.remove("is-sidebar-collapsed");
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", "Collapse sidebar");
      
      // Restore saved width
      const savedWidth = parseFloat(localStorage.getItem(WIDTH_KEY));
      const nextWidth = Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : 330;
      content.style.setProperty("--sidebar-width", `${Math.round(nextWidth)}px`);
    }
  };

  // Check saved state on load
  const savedCollapsed = localStorage.getItem(COLLAPSE_KEY);
  if (savedCollapsed === "true") {
    applyCollapsed(true);
  }

  // Handle button clicks
  button.addEventListener("click", () => {
    const nextState = !isCollapsed();
    applyCollapsed(nextState);
    localStorage.setItem(COLLAPSE_KEY, nextState ? "true" : "false");
  });
}

function wireAccountMenu() {
  const root = document.querySelector("[data-account]");
  const button = document.getElementById("accountBtn");
  const menu = document.getElementById("accountMenu");
  const avatar = document.getElementById("accountAvatar");
  const menuAvatar = document.getElementById("accountMenuAvatar");
  const nameEl = document.getElementById("accountName");
  const statusEl = document.getElementById("accountStatus");
  const connectBtn = menu?.querySelector('[data-action="auth-login"]');
  const settingsBtn = menu?.querySelector('[data-action="open-settings"]');
  const disconnectBtn = menu?.querySelector('[data-action="auth-logout"]');

  if (!root || !button || !menu || !avatar || !menuAvatar || !nameEl || !statusEl || !connectBtn || !disconnectBtn) return;

  const defaultAvatarUrl = avatar.getAttribute("src") || "";

  const getNameParts = (value) =>
    String(value || "")
      .trim()
      .split(/\s+/g)
      .filter(Boolean);

  const getInitials = (fullName) => {
    const parts = getNameParts(fullName);
    if (parts.length === 0) return "??";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const hashToHue = (value) => {
    const s = String(value || "");
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
      hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  };

  const buildInitialsAvatarDataUrl = (fullName) => {
    const initials = getInitials(fullName);
    const hue = hashToHue(fullName);
    const bg = `hsl(${hue} 55% 42%)`;
    const fg = "rgba(255,255,255,0.92)";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88">
      <rect width="88" height="88" rx="44" fill="${bg}"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        font-family="system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"
        font-size="30" font-weight="700" fill="${fg}" letter-spacing="1">${initials}</text>
    </svg>`;

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  };

  const setOpen = (open) => {
    menu.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) menu.focus?.();
  };

  const isOpen = () => !menu.hidden;

  const close = () => setOpen(false);

  const setBusy = (busy) => {
    connectBtn.disabled = busy;
    disconnectBtn.disabled = busy;
  };

  const setProfile = (payload) => {
    const hasARL = Boolean(payload?.hasARL);
    const user = payload?.user && typeof payload.user === "object" ? payload.user : null;

    connectBtn.hidden = hasARL;
    disconnectBtn.hidden = !hasARL;

    if (!hasARL) {
      nameEl.textContent = "Guest";
      statusEl.textContent = window.auth ? "Not logged in" : "Login available in Electron only";
      avatar.src = defaultAvatarUrl;
      menuAvatar.src = defaultAvatarUrl;
      return;
    }

    const displayName = String(user?.name || "Deezer user");
    nameEl.textContent = displayName;
    statusEl.textContent = "Logged in";

    const src = String(user?.avatarUrl || "") || buildInitialsAvatarDataUrl(displayName);
    avatar.src = src;
    menuAvatar.src = src;
  };

  const setError = (message) => {
    statusEl.textContent = String(message || "Login failed");
  };

  button.addEventListener("click", () => setOpen(!isOpen()));

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (root.contains(event.target)) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") close();
  });

  connectBtn.addEventListener("click", async () => {
    if (!window.auth) {
      setError("available in Electron only");
      return;
    }

    setBusy(true);
    setError("connecting…");
    try {
      const result = await window.auth.login();
      if (!result?.ok) {
        setError(result?.message || result?.error || "login failed");
        return;
      }
      setProfile({ hasARL: Boolean(result?.hasARL) });
      close();
    } finally {
      setBusy(false);
    }
  });

  settingsBtn?.addEventListener?.("click", () => {
    window.__spotifyNav?.navigate?.({ name: "settings" });
    close();
  });

  disconnectBtn.addEventListener("click", async () => {
    if (!window.auth) return;

    setBusy(true);
    try {
      await window.auth.logout();
      setProfile({ hasARL: false });
      close();
    } finally {
      setBusy(false);
    }
  });

  if (!window.auth) {
    connectBtn.disabled = true;
    setProfile({ hasARL: false });
    return;
  }

  window.auth.onSessionChanged?.((payload) => setProfile(payload));

  setBusy(true);
  window.auth
    .getSession()
    .then((payload) => setProfile(payload))
    .catch(() => setProfile({ hasARL: false }))
    .finally(() => setBusy(false));
}

function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, waitMs);
  };
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

async function extractAverageColorFromImageUrl(url) {
  const src = String(url || "").trim();
  if (!src) return null;

  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.loading = "eager";

  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve(true);
    img.onerror = () => reject(new Error("image load failed"));
  });

  img.src = src;
  await loaded;

  const w = Math.max(1, Math.min(48, img.naturalWidth || 0));
  const h = Math.max(1, Math.min(48, img.naturalHeight || 0));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 40) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }

  if (count <= 0) return null;
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

function readJsonFromLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJsonToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function createLocalLibrary() {
  const KEY = "spotify.localLibrary.v1";

  const defaultState = () => ({
    savedTracks: {},
    savedAlbums: {},
    playlists: {},
  });

  const load = () => {
    const parsed = readJsonFromLocalStorage(KEY, null);
    if (!parsed || typeof parsed !== "object") return defaultState();
    return {
      ...defaultState(),
      ...parsed,
      savedTracks: parsed.savedTracks && typeof parsed.savedTracks === "object" ? parsed.savedTracks : {},
      savedAlbums: parsed.savedAlbums && typeof parsed.savedAlbums === "object" ? parsed.savedAlbums : {},
      playlists: parsed.playlists && typeof parsed.playlists === "object" ? parsed.playlists : {},
    };
  };

  const save = (next) => writeJsonToLocalStorage(KEY, next);

  const addSavedTrack = (track) => {
    const t = track && typeof track === "object" ? track : null;
    const id = Number(t?.id || t?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    next.savedTracks[String(id)] = {
      id,
      title: String(t?.title || t?.SNG_TITLE || ""),
      artist: String(t?.artist?.name || t?.ART_NAME || ""),
      duration: Number(t?.duration || t?.DURATION || 0) || 0,
      explicit: Boolean(t?.explicit_lyrics || t?.EXPLICIT_LYRICS),
      albumId: t?.album?.id ? Number(t.album.id) : t?.ALB_ID ? Number(t.ALB_ID) : null,
      albumTitle: String(t?.album?.title || t?.ALB_TITLE || ""),
      albumCover:
        String(t?.album?.cover_medium || t?.album?.cover || "") ||
        (String(t?.ALB_PICTURE || "").match(/^[a-f0-9]{32}$/i)
          ? `https://e-cdns-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/250x250-000000-80-0-0.jpg`
          : ""),
      addedAt: now,
    };
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const removeSavedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.savedTracks[String(id)];
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const isTrackSaved = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const s = load();
    return Boolean(s.savedTracks[String(id)]);
  };

  const listSavedTracks = () => {
    const s = load();
    const items = Object.values(s.savedTracks || {});
    items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return items;
  };

  const upsertTrackDownload = ({ trackId, fileUrl, downloadPath, quality }) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    const existing = next.savedTracks[String(id)];
    if (!existing) return false;
    existing.download = {
      fileUrl: String(fileUrl || ""),
      downloadPath: String(downloadPath || ""),
      quality: String(quality || ""),
      at: Date.now(),
    };
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  return {
    load,
    addSavedTrack,
    removeSavedTrack,
    isTrackSaved,
    listSavedTracks,
    upsertTrackDownload,
  };
}

function wireNavigation() {
  const backBtn = document.querySelector('[data-nav="back"]');
  const forwardBtn = document.querySelector('[data-nav="forward"]');
  const homeBtn = document.querySelector('[data-nav="home"]');
  const searchInput = document.getElementById("topSearchInput");

  const homeView = document.getElementById("mainViewHome");
  const searchView = document.getElementById("mainViewSearch");
  const entityWrap = document.getElementById("mainViewEntity");
  const settingsView = document.getElementById("mainViewSettings");

  const queryLabel = document.getElementById("searchQueryLabel");
  const searchResults = document.getElementById("searchResults");
  const entityView = document.getElementById("entityView");
  const searchFilterButtons = Array.from(document.querySelectorAll("[data-search-filter]"));

  if (
    !backBtn ||
    !forwardBtn ||
    !homeBtn ||
    !searchInput ||
    !homeView ||
    !searchView ||
    !entityWrap ||
    !settingsView ||
    !queryLabel ||
    !searchResults ||
    !entityView
  ) {
    return;
  }

  const showView = (name) => {
    homeView.hidden = name !== "home";
    searchView.hidden = name !== "search";
    entityWrap.hidden = name !== "entity";
    settingsView.hidden = name !== "settings";
  };

  const history = [{ name: "home" }];
  let historyIndex = 0;
  let settingsWired = false;

  const setNavButtons = () => {
    backBtn.disabled = historyIndex <= 0;
    forwardBtn.disabled = historyIndex >= history.length - 1;
  };

  const setSearchFilterActive = (filter) => {
    for (const btn of searchFilterButtons) {
      const isActive = btn.dataset.searchFilter === filter;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  };

  const renderSearchSkeleton = (label) => {
    searchResults.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = label;
    searchResults.appendChild(empty);
  };

  const renderTracksList = (title, items) => {
    const tracks = Array.isArray(items) ? items : [];
    if (tracks.length === 0) return;

    const section = document.createElement("section");
    section.className = "search-tracks";

    const h2 = document.createElement("h2");
    h2.className = "search-tracks__title";
    h2.textContent = title;
    section.appendChild(h2);

    const list = document.createElement("div");
    list.className = "search-tracklist";

    window.__lastSearchTracks = tracks;

    let idx = 0;
    for (const t of tracks) {
      const trackId = Number(t?.id || t?.SNG_ID);
      const row = document.createElement("div");
      row.className = "search-track";
      row.dataset.trackIndex = String(idx++);
      if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);

      const cover = document.createElement("div");
      cover.className = "search-track__cover";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      const md5 = String(t?.ALB_PICTURE || "");
      const md5Cover =
        md5 && /^[a-f0-9]{32}$/i.test(md5)
          ? `https://e-cdns-images.dzcdn.net/images/cover/${md5}/80x80-000000-80-0-0.jpg`
          : "";
      const src = String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || md5Cover || "");
      if (src) img.src = src;
      cover.appendChild(img);

      const main = document.createElement("div");
      main.className = "search-track__main";
      const tt = document.createElement("div");
      tt.className = "search-track__title";
      tt.textContent = String(t?.title || t?.SNG_TITLE || "");

      const sub = document.createElement("div");
      sub.className = "search-track__subtitle";

      const explicit = Boolean(t?.explicit_lyrics || t?.EXPLICIT_LYRICS);
      if (explicit) {
        const badge = document.createElement("span");
        badge.className = "badge-explicit";
        badge.textContent = "E";
        sub.appendChild(badge);
      }

      const artist = document.createElement("span");
      artist.textContent = String(t?.artist?.name || t?.ART_NAME || "");
      sub.appendChild(artist);

      main.appendChild(tt);
      main.appendChild(sub);

      const dur = document.createElement("div");
      dur.className = "search-track__duration";
      dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

      row.appendChild(cover);
      row.appendChild(main);
      row.appendChild(dur);
      list.appendChild(row);
    }

    section.appendChild(list);
    searchResults.appendChild(section);
  };

  const renderSection = (title, items, { kind }) => {
    if (!Array.isArray(items) || items.length === 0) return;

    const section = document.createElement("section");
    section.className = "made-for";

    const header = document.createElement("div");
    header.className = "made-for__header";

    const titles = document.createElement("div");
    titles.className = "made-for__titles";

    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = title;
    titles.appendChild(h2);
    header.appendChild(titles);
    section.appendChild(header);

    const carousel = document.createElement("div");
    carousel.className = "carousel";
    carousel.setAttribute("role", "list");

    for (const item of items) {
      const a = document.createElement("a");
      a.className = "big-card";
      a.href = "#";
      a.setAttribute("role", "listitem");
      a.dataset.kind = kind;

      const cover = document.createElement("div");
      cover.className = `big-card__cover${kind === "artist" ? " big-card__cover--circle" : ""}`;

      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      if (item?.image) img.src = item.image;
      cover.appendChild(img);

      const play = document.createElement("span");
      play.className = "hover-play hover-play--cover";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
      cover.appendChild(play);

      const t = document.createElement("div");
      t.className = "big-card__title";
      t.textContent = String(item?.title || "");

      const subtitle = document.createElement("div");
      subtitle.className = "big-card__subtitle";
      subtitle.textContent = String(item?.subtitle || "");

      a.appendChild(cover);
      a.appendChild(t);
      a.appendChild(subtitle);

      if (item?.entityType && item?.id) {
        a.dataset.entityType = String(item.entityType);
        a.dataset.entityId = String(item.id);
      } else {
        a.setAttribute("aria-disabled", "true");
      }

      carousel.appendChild(a);
    }

    section.appendChild(carousel);
    searchResults.appendChild(section);
  };

  const normalizeSearchItem = (kind, item) => {
    if (!item || typeof item !== "object") return null;

    if (kind === "track") {
      const albumId = item?.album?.id;
      return {
        title: item?.title,
        subtitle: item?.artist?.name || "",
        image: item?.album?.cover_medium || item?.album?.cover || "",
        entityType: albumId ? "album" : null,
        id: albumId ? String(albumId) : null,
      };
    }

    if (kind === "album") {
      return {
        title: item?.title,
        subtitle: item?.artist?.name || "",
        image: item?.cover_medium || item?.cover || "",
        entityType: "album",
        id: String(item?.id || ""),
      };
    }

    if (kind === "artist") {
      return {
        title: item?.name,
        subtitle: "Artist",
        image: item?.picture_medium || item?.picture || "",
        entityType: "artist",
        id: String(item?.id || ""),
      };
    }

    if (kind === "playlist") {
      return {
        title: item?.title,
        subtitle: "Playlist",
        image: item?.picture_medium || item?.picture || "",
        entityType: "playlist",
        id: String(item?.id || ""),
      };
    }

    return null;
  };

  let searchReq = 0;
  const renderSearch = async ({ q, filter }) => {
    const query = String(q || "").trim();
    if (!query) {
      showView("home");
      return;
    }

    showView("search");
    queryLabel.textContent = `Results for “${query}”`;
    setSearchFilterActive(filter);

    if (!window.dz || typeof window.dz.search !== "function") {
      renderSearchSkeleton("Search is available in Electron only (missing window.dz).");
      return;
    }

    const thisReq = ++searchReq;
    renderSearchSkeleton("Searching…");

    try {
      searchResults.innerHTML = "";

      const load = async (kind, limit) => {
        const res = await window.dz.search({ term: query, type: kind, start: 0, nb: limit });
        if (!res?.ok) return { kind, items: [], error: res?.error || res?.message || "failed" };
        const data = Array.isArray(res?.results?.data) ? res.results.data : [];
        return { kind, items: data, error: "" };
      };

      const kind = String(filter || "all");
      if (kind === "all") {
        const [tracks, albums, artists, playlists] = await Promise.all([
          load("track", 10),
          load("album", 10),
          load("artist", 10),
          load("playlist", 10),
        ]);

        if (thisReq !== searchReq) return;

        // Songs are a list view; everything else stays as a carousel section.
        const sections = [
          { title: "Albums", kind: "album", items: albums.items },
          { title: "Artists", kind: "artist", items: artists.items },
          { title: "Playlists", kind: "playlist", items: playlists.items },
        ];

        let any = false;
        const trackItems = Array.isArray(tracks.items) ? tracks.items : [];
        if (trackItems.length > 0) {
          any = true;
          renderTracksList("Songs", trackItems);
        }

        for (const sec of sections) {
          const normalized = sec.items.map((x) => normalizeSearchItem(sec.kind, x)).filter(Boolean);
          if (normalized.length === 0) continue;
          any = true;
          renderSection(sec.title, normalized, { kind: sec.kind });
        }

        if (!any) {
          renderSearchSkeleton("No results found.");
        }
        return;
      }

      const result = await load(kind, 50);
      if (thisReq !== searchReq) return;

      if (kind === "track") {
        const trackItems = Array.isArray(result.items) ? result.items : [];
        if (trackItems.length === 0) {
          renderSearchSkeleton("No results found.");
          return;
        }
        renderTracksList("Songs", trackItems);
      } else {
        const normalized = result.items.map((x) => normalizeSearchItem(kind, x)).filter(Boolean);
        if (normalized.length === 0) {
          renderSearchSkeleton("No results found.");
          return;
        }
        renderSection(`${kind[0].toUpperCase()}${kind.slice(1)}s`, normalized, { kind });
      }
    } catch (e) {
      if (thisReq !== searchReq) return;
      renderSearchSkeleton(String(e?.message || e || "Search failed"));
    }
  };

  let entityReq = 0;
  const renderEntity = async ({ entityType, id }) => {
    const type = String(entityType || "").trim();
    const entityId = String(id || "").trim();
    if (!type || !entityId) return;

    showView("entity");

    if (!window.dz || typeof window.dz.getTracklist !== "function") {
      entityView.innerHTML = '<div class="search-empty">Entity views are available in Electron only (missing window.dz).</div>';
      return;
    }

    const thisReq = ++entityReq;
    entityView.innerHTML = '<div class="search-empty">Loading…</div>';

    try {
      const res = await window.dz.getTracklist({ type, id: entityId });
      if (thisReq !== entityReq) return;
      if (!res?.ok || !res?.data) {
        entityView.innerHTML = `<div class="search-empty">Failed to load (${String(res?.error || "unknown")}).</div>`;
        return;
      }

      const data = res.data;
      const cover =
        type === "artist" ? data?.picture_medium || data?.picture || "" : data?.cover_medium || data?.cover || data?.picture_medium || "";

      const title = type === "artist" ? data?.name || "Artist" : data?.title || "Untitled";
      const subtitle =
        type === "album"
          ? `${data?.artist?.name || ""}`.trim()
          : type === "playlist"
            ? `Playlist`
            : `Artist`;

      const tracks =
        type === "artist"
          ? Array.isArray(data?.topTracks) ? data.topTracks : []
          : Array.isArray(data?.tracks) ? data.tracks : [];
      window.__lastEntityTracks = tracks;

      entityView.innerHTML = "";
      entityView.style.removeProperty("--entity-accent");

      const header = document.createElement("div");
      header.className = "entity-header";

      const coverEl = document.createElement("div");
      coverEl.className = "entity-cover";
      const img = document.createElement("img");
      img.alt = "";
      if (cover) img.src = cover;
      coverEl.appendChild(img);

      const meta = document.createElement("div");
      meta.className = "entity-meta";
      const h1 = document.createElement("div");
      h1.className = "entity-title";
      h1.textContent = String(title);
      const sub = document.createElement("div");
      sub.className = "entity-subtitle";
      sub.textContent = subtitle;
      meta.appendChild(h1);
      meta.appendChild(sub);

      if (type === "album" || type === "playlist") {
        const actions = document.createElement("div");
        actions.className = "entity-actions";

        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "pill is-active";
        playBtn.textContent = "Play (download)";
        playBtn.addEventListener("click", async () => {
          if (!window.__player) return;
          const q = Array.isArray(tracks) ? tracks : [];
          if (q.length === 0) return;
          await window.__player.setQueueAndPlay(q, 0);
        });

        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "pill";
        dlBtn.textContent = "Download";
        dlBtn.addEventListener("click", async () => {
          if (!window.dl?.downloadUrl) return;
          const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";
          void window.dl.downloadUrl({ url: `https://www.deezer.com/${type}/${entityId}`, quality });
        });

        actions.appendChild(playBtn);
        actions.appendChild(dlBtn);
        meta.appendChild(actions);
      }

      header.appendChild(coverEl);
      header.appendChild(meta);
      entityView.appendChild(header);

      if (cover) {
        extractAverageColorFromImageUrl(cover)
          .then((rgb) => {
            if (!rgb) return;
            entityView.style.setProperty("--entity-accent", `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.72)`);
          })
          .catch(() => {});
      }

      const list = document.createElement("div");
      list.className = "entity-tracks";

      const rows = tracks.slice(0, 200);
      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "No tracks to display.";
        entityView.appendChild(empty);
        return;
      }

      let index = 1;
      for (const t of rows) {
        const row = document.createElement("div");
        row.className = "entity-track";
        row.dataset.trackIndex = String(index - 1);
        const trackId = Number(t?.id || t?.SNG_ID);
        if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);

        const idx = document.createElement("div");
        idx.className = "entity-track__index";
        const num = document.createElement("span");
        num.className = "entity-track__num";
        num.textContent = String(index++);

        const play = document.createElement("span");
        play.className = "entity-track__hoverPlay";
        play.setAttribute("aria-hidden", "true");
        play.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';

        const viz = document.createElement("span");
        viz.className = "entity-track__viz";
        viz.setAttribute("aria-hidden", "true");
        viz.innerHTML = '<span class="playing-viz"><span></span><span></span><span></span></span>';

        idx.appendChild(num);
        idx.appendChild(play);
        idx.appendChild(viz);

        const main = document.createElement("div");
        main.className = "entity-track__main";
        const tt = document.createElement("div");
        tt.className = "entity-track__title";
        tt.textContent = String(t?.title || t?.SNG_TITLE || "");
        const ta = document.createElement("div");
        ta.className = "entity-track__artist";
        ta.textContent = String(t?.artist?.name || t?.ART_NAME || "");
        main.appendChild(tt);
        main.appendChild(ta);

        const dur = document.createElement("div");
        dur.className = "entity-track__duration";
        dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

        row.appendChild(idx);
        row.appendChild(main);
        row.appendChild(dur);
        list.appendChild(row);
      }

      entityView.appendChild(list);
    } catch (e) {
      if (thisReq !== entityReq) return;
      entityView.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
    }
  };

  const renderRoute = async (route) => {
    const name = route?.name;
    if (name === "home") {
      showView("home");
      window.__deezerSectionsRefresh?.();
      setNavButtons();
      return;
    }

    if (name === "search") {
      await renderSearch({ q: route.q, filter: route.filter || "all" });
      setNavButtons();
      return;
    }

    if (name === "entity") {
      await renderEntity({ entityType: route.entityType, id: route.id });
      setNavButtons();
      return;
    }

    if (name === "liked") {
      showView("entity");
      entityView.innerHTML = '<div class="search-empty">Loading Liked Songs…</div>';
      try {
        const lib = window.__localLibrary || (window.__localLibrary = createLocalLibrary());
        const saved = lib.listSavedTracks();
        const tracks = saved.map((t) => ({
          id: Number(t?.id) || null,
          title: String(t?.title || ""),
          duration: Number(t?.duration) || 0,
          artist: { name: String(t?.artist || "") },
          album: {
            cover_small: String(t?.albumCover || ""),
            cover_medium: String(t?.albumCover || ""),
            title: String(t?.albumTitle || ""),
            id: Number(t?.albumId) || null,
          },
        }));
        window.__lastLikedTracks = tracks;
        entityView.innerHTML = "";
        entityView.style.setProperty("--entity-accent", "rgba(75, 48, 255, 0.78)");

        const header = document.createElement("div");
        header.className = "entity-header";

        const coverEl = document.createElement("div");
        coverEl.className = "entity-cover";
        coverEl.style.background =
          "linear-gradient(135deg, rgba(75, 48, 255, 1) 0%, rgba(180, 170, 255, 1) 60%, rgba(235, 235, 235, 0.95) 100%)";
        coverEl.innerHTML =
          '<div style="height:100%;display:grid;place-items:center;"><i class="ri-heart-fill" style="font-size:46px;color:rgba(255,255,255,0.94)"></i></div>';

        const meta = document.createElement("div");
        meta.className = "entity-meta";
        const h1 = document.createElement("div");
        h1.className = "entity-title";
        h1.textContent = "Liked Songs";
        const sub = document.createElement("div");
        sub.className = "entity-subtitle";
        sub.textContent = `${tracks.length} songs`;
        meta.appendChild(h1);
        meta.appendChild(sub);

        header.appendChild(coverEl);
        header.appendChild(meta);
        entityView.appendChild(header);

        if (tracks.length === 0) {
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = "No saved songs yet. Like a track to download it and add it here.";
          entityView.appendChild(empty);
          setNavButtons();
          return;
        }

        const list = document.createElement("div");
        list.className = "entity-tracks";
        let i = 0;
        for (const t of tracks) {
          const row = document.createElement("div");
          row.className = "entity-track";
          row.dataset.trackIndex = String(i);
          const trackId = Number(t?.id || t?.SNG_ID);
          if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);

          const idx = document.createElement("div");
          idx.className = "entity-track__index";
          const num = document.createElement("span");
          num.className = "entity-track__num";
          num.textContent = String(i + 1);

          const play = document.createElement("span");
          play.className = "entity-track__hoverPlay";
          play.setAttribute("aria-hidden", "true");
          play.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';

          const viz = document.createElement("span");
          viz.className = "entity-track__viz";
          viz.setAttribute("aria-hidden", "true");
          viz.innerHTML = '<span class="playing-viz"><span></span><span></span><span></span></span>';

          idx.appendChild(num);
          idx.appendChild(play);
          idx.appendChild(viz);

          const main = document.createElement("div");
          main.className = "entity-track__main";
          const tt = document.createElement("div");
          tt.className = "entity-track__title";
          tt.textContent = String(t?.title || t?.SNG_TITLE || "");
          const ta = document.createElement("div");
          ta.className = "entity-track__artist";
          ta.textContent = String(t?.artist?.name || t?.ART_NAME || "");
          main.appendChild(tt);
          main.appendChild(ta);

          const dur = document.createElement("div");
          dur.className = "entity-track__duration";
          dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

          row.appendChild(idx);
          row.appendChild(main);
          row.appendChild(dur);
          list.appendChild(row);
          i++;
        }

        entityView.appendChild(list);
      } catch (e) {
        entityView.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
      }
      setNavButtons();
      return;
    }

    if (name === "settings") {
      showView("settings");
      const statusEl = document.getElementById("settingsSessionStatus");
      const userEl = document.getElementById("settingsSessionUser");
      const dirEl = document.getElementById("settingsDownloadDir");
      const qualityEl = document.getElementById("settingsQuality");

      const setStatus = (text) => {
        if (statusEl) statusEl.textContent = String(text || "");
      };
      const setUser = (text) => {
        if (userEl) userEl.textContent = String(text || "");
      };

      setStatus("Loading…");
      setUser("—");

      try {
        const st = await window.dz?.status?.();
        if (st?.deezerSdkLoggedIn) {
          setStatus("Logged in");
          setUser(String(st?.user?.name || "Deezer user"));
        } else {
          setStatus("Not logged in");
          setUser("—");
        }
      } catch {
        setStatus("Unknown");
      }

      if (qualityEl) {
        const key = "spotify.downloadQuality";
        const saved = localStorage.getItem(key);
        if (saved) qualityEl.value = saved;
        if (!qualityEl.dataset.wired) {
          qualityEl.dataset.wired = "true";
          qualityEl.addEventListener("change", () => localStorage.setItem(key, String(qualityEl.value)));
        }
      }

      if (dirEl && window.app?.getPaths) {
        try {
          const paths = await window.app.getPaths();
          dirEl.textContent = String(paths?.downloadsDir || "—");
        } catch {
          dirEl.textContent = "—";
        }
      }

      if (!settingsWired) {
        settingsWired = true;

        const openDirBtn = document.getElementById("settingsOpenSessionDir");
        openDirBtn?.addEventListener?.("click", () => void window.app?.openSessionDir?.());

        const refreshBtn = document.getElementById("settingsRefreshAppState");
        refreshBtn?.addEventListener?.("click", async () => {
          await window.deezer?.extractAppState?.();
        });

        const logoutBtn = document.getElementById("settingsLogout");
        logoutBtn?.addEventListener?.("click", () => void window.auth?.logout?.());
      }

      setNavButtons();
      return;
    }
  };

  const navigate = async (route, { replace = false } = {}) => {
    const next = route || { name: "home" };
    if (replace) {
      history[historyIndex] = next;
    } else {
      history.splice(historyIndex + 1);
      history.push(next);
      historyIndex = history.length - 1;
    }
    await renderRoute(next);
  };

  const goBack = async () => {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    await renderRoute(history[historyIndex]);
  };

  const goForward = async () => {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    await renderRoute(history[historyIndex]);
  };

  backBtn.addEventListener("click", () => void goBack());
  forwardBtn.addEventListener("click", () => void goForward());
  homeBtn.addEventListener("click", () => void navigate({ name: "home" }));

  // Allow other UI modules to navigate without tight coupling.
  window.__spotifyNav = { navigate: (route, options) => navigate(route, options) };

  const syncSearchRoute = debounce(() => {
    const q = String(searchInput.value || "").trim();
    const current = history[historyIndex];
    if (!q) {
      if (current?.name === "search") void navigate({ name: "home" }, { replace: true });
      return;
    }

    const filter = current?.name === "search" ? current.filter || "all" : "all";
    const replace = current?.name === "search";
    void navigate({ name: "search", q, filter }, { replace });
  }, 260);

  searchInput.addEventListener("input", () => syncSearchRoute());
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (searchInput.value) {
        searchInput.value = "";
        syncSearchRoute();
      }
      return;
    }
    if (event.key === "Enter") {
      const q = String(searchInput.value || "").trim();
      if (!q) return;
      const current = history[historyIndex];
      const filter = current?.name === "search" ? current.filter || "all" : "all";
      void navigate({ name: "search", q, filter }, { replace: false });
    }
  });

  for (const btn of searchFilterButtons) {
    btn.addEventListener("click", () => {
      const filter = String(btn.dataset.searchFilter || "all");
      const q = String(searchInput.value || "").trim();
      if (!q) return;
      void navigate({ name: "search", q, filter }, { replace: true });
    });
  }

  searchResults.addEventListener("click", (event) => {
    const row = event.target?.closest?.(".search-track");
    if (row) {
      event.preventDefault();
      const idx = Number(row.dataset.trackIndex);
      if (!Number.isFinite(idx) || idx < 0) return;
      if (!window.__player) return;
      const tracks = Array.isArray(window.__lastSearchTracks) ? window.__lastSearchTracks : [];
      if (tracks.length === 0) return;
      void window.__player.setQueueAndPlay(tracks, idx);
      return;
    }

    const a = event.target?.closest?.("a.big-card");
    if (!a) return;
    event.preventDefault();

    const entityType = a.dataset.entityType;
    const entityId = a.dataset.entityId;
    if (!entityType || !entityId) return;
    void navigate({ name: "entity", entityType, id: entityId });
  });

  entityView.addEventListener("click", (event) => {
    const row = event.target?.closest?.(".entity-track");
    if (!row) return;
    const idx = Number(row.dataset.trackIndex);
    if (!Number.isFinite(idx) || idx < 0) return;
    if (!window.__player) return;

    const current = history[historyIndex];
    if (current?.name === "liked") {
      const tracks = Array.isArray(window.__lastLikedTracks) ? window.__lastLikedTracks : [];
      if (tracks.length > 0) {
        void window.__player.setQueueAndPlay(tracks, idx);
      }
      return;
    }

    // For entity pages, reuse the last fetched set if present.
    if (window.__lastEntityTracks && Array.isArray(window.__lastEntityTracks)) {
      void window.__player.setQueueAndPlay(window.__lastEntityTracks, idx);
    }
  });

  // dblclick reserved for future (e.g. "download only" vs "play now")

  setNavButtons();
  void renderRoute(history[historyIndex]);
}

function wireNowPlayingHighlights() {
  const applyToContainer = (container, { trackId, isPlaying }) => {
    if (!container) return;
    const rows = Array.from(container.querySelectorAll(".entity-track[data-track-id], .search-track[data-track-id]"));
    if (rows.length === 0) return;

    for (const row of rows) {
      const id = Number(row.dataset.trackId);
      const isCurrent = Number.isFinite(id) && Number.isFinite(trackId) && id === trackId;
      row.classList.toggle("is-current", isCurrent);
      row.classList.toggle("is-playing", isCurrent && Boolean(isPlaying));
    }
  };

  window.addEventListener("player:change", (event) => {
    const detail = event?.detail || {};
    const trackId = Number(detail.trackId);
    const state = { trackId: Number.isFinite(trackId) ? trackId : null, isPlaying: Boolean(detail.isPlaying) };
    applyToContainer(document.getElementById("entityView"), state);
    applyToContainer(document.getElementById("searchResults"), state);
  });
}

function wireNotifications() {
  const btn = document.getElementById("notificationsBtn");
  if (!btn) return;
  if (!window.dl?.onEvent) return;

  const menu = document.createElement("div");
  menu.id = "notificationsMenu";
  menu.className = "notifications-menu";
  menu.hidden = true;
  menu.tabIndex = -1;
  document.body.appendChild(menu);

  const downloads = new Map();

  const summarizeActiveCount = () => {
    let n = 0;
    for (const d of downloads.values()) {
      if (d.status === "queued" || d.status === "downloading") n++;
    }
    return n;
  };

  const setBadge = () => {
    const active = summarizeActiveCount();
    btn.dataset.badge = active > 0 ? String(active) : "";
  };

  const render = () => {
    const items = Array.from(downloads.values());
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const active = items.filter((d) => d.status === "queued" || d.status === "downloading");
    const recent = items.filter((d) => d.status !== "queued" && d.status !== "downloading").slice(0, 12);

    const rows = [...active, ...recent].slice(0, 18);

    const header = `
      <div class="notifications-menu__header">
        <div class="notifications-menu__title">Downloads</div>
        <div class="notifications-menu__meta">${active.length > 0 ? `${active.length} active` : "No active downloads"}</div>
      </div>
    `;

    const list =
      rows.length === 0
        ? `<div class="notifications-menu__empty">Nothing here yet.</div>`
        : `<div class="notifications-menu__list">
            ${rows
              .map((d) => {
                const title = String(d.title || d.uuid || "Download");
                const status = d.status === "done" ? "Downloaded" : d.status === "failed" ? "Failed" : d.status === "queued" ? "Queued" : "Downloading";
                const pct = typeof d.progress === "number" ? Math.max(0, Math.min(100, d.progress)) : null;
                return `
                  <div class="notifications-menu__item" data-status="${d.status}">
                    <div class="notifications-menu__itemMain">
                      <div class="notifications-menu__itemTitle">${title}</div>
                      <div class="notifications-menu__itemSubtitle">${status}${pct !== null && d.status === "downloading" ? ` • ${Math.floor(pct)}%` : ""}</div>
                    </div>
                    ${pct !== null && (d.status === "downloading" || d.status === "queued") ? `<div class="notifications-menu__bar"><span style="width:${Math.floor(pct)}%"></span></div>` : ""}
                  </div>
                `;
              })
              .join("")}
          </div>`;

    const footer = `
      <div class="notifications-menu__footer">
        <button type="button" class="notifications-menu__btn" data-action="clear-completed">Clear completed</button>
      </div>
    `;

    menu.innerHTML = header + list + footer;
  };

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      render();
      const rect = btn.getBoundingClientRect();
      const x = Math.round(rect.right - 360);
      const y = Math.round(rect.bottom + 10);
      menu.style.left = `${Math.max(12, x)}px`;
      menu.style.top = `${Math.max(12, y)}px`;
      menu.focus();
    }
  };

  const isOpen = () => !menu.hidden;

  btn.addEventListener("click", () => setOpen(!isOpen()));

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (menu.contains(event.target)) return;
    if (btn.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") setOpen(false);
  });

  menu.addEventListener("click", (event) => {
    const action = event.target?.closest?.("button")?.dataset?.action;
    if (action === "clear-completed") {
      for (const [uuid, d] of downloads.entries()) {
        if (d.status === "done" || d.status === "failed") downloads.delete(uuid);
      }
      setBadge();
      render();
    }
  });

  window.dl.onEvent((payload) => {
    const event = String(payload?.event || "");
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const uuid = String(data.uuid || "");
    if (!uuid) return;

    const prev = downloads.get(uuid) || { uuid, status: "queued", progress: null, updatedAt: 0, title: "" };
    const next = { ...prev };
    next.updatedAt = Date.now();

    if (event === "downloadRequested") {
      next.status = "queued";
      next.progress = 0;
      if (data.id) next.title = `Track #${data.id}`;
      else if (data.url) next.title = String(data.url);
    } else if (event === "updateQueue") {
      if (typeof data.progress === "number") {
        next.status = "downloading";
        next.progress = data.progress;
      }
      if (data.downloaded || data.alreadyDownloaded) {
        next.status = "downloading";
        next.progress = 100;
      }
    } else if (event === "downloadFinished") {
      next.status = "done";
      next.progress = 100;
    } else if (event === "downloadFailed") {
      next.status = "failed";
    }

    downloads.set(uuid, next);
    setBadge();
    if (isOpen()) render();
  });

  setBadge();
}

function wireDownloads() {
  if (!window.dl?.onEvent) return;

  const artistEl = document.getElementById("playerArtist");
  window.dl.onEvent((payload) => {
    const event = payload?.event;
    const data = payload?.data;
    const uuid = data?.uuid;
    if (!uuid) return;
    const st = window.__player?.getState?.();
    if (!st || !st.downloadUuid) return;
    if (uuid !== st.downloadUuid) return;

    if (event === "updateQueue" && typeof data.progress === "number") {
      if (artistEl) artistEl.textContent = `Downloading… ${Math.floor(data.progress)}%`;
    }
    if (event === "downloadFinished") {
      if (artistEl && st.track?.artist) artistEl.textContent = st.track.artist;
    }
  });
}

function wireLibraryData() {
  const list = document.getElementById("libraryList");
  const searchBtn = document.getElementById("librarySearchBtn");
  const searchInput = document.getElementById("librarySearchInput");
  if (!list || !searchBtn || !searchInput) return;

  const contentRoot = document.querySelector(".content");
  const recentsBtn = document.querySelector(".recents");

  const SORT_KEY = "spotify.librarySort";
  const VIEW_KEY = "spotify.libraryView";

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const getText = (el) => String(el?.textContent || "").trim().toLowerCase();

  const applySearchFilter = () => {
    const q = String(searchInput.value || "").trim().toLowerCase();
    const items = Array.from(list.querySelectorAll(".library-item"));
    if (!q) {
      for (const it of items) it.hidden = false;
      return;
    }
    for (const it of items) {
      const title = getText(it.querySelector(".library-item__title"));
      const subtitle = getText(it.querySelector(".library-item__subtitle"));
      it.hidden = !(title.includes(q) || subtitle.includes(q));
    }
  };

  const setSearchOpen = (open) => {
    searchInput.hidden = !open;
    if (open) {
      searchInput.value = "";
      searchInput.focus();
    } else {
      searchInput.value = "";
    }
    applySearchFilter();
  };

  searchBtn.addEventListener("click", () => setSearchOpen(searchInput.hidden));
  searchInput.addEventListener("input", () => applySearchFilter());
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setSearchOpen(false);
  });

  list.addEventListener("click", (event) => {
    const item = event.target?.closest?.(".library-item");
    if (!item) return;
    event.preventDefault();

    const all = Array.from(list.querySelectorAll(".library-item"));
    for (const it of all) it.classList.toggle("is-active", it === item);

    if (item.dataset.route === "liked") {
      window.__spotifyNav?.navigate?.({ name: "liked" });
      return;
    }

    const entityType = item.dataset.entityType;
    const entityId = item.dataset.entityId;
    if (entityType && entityId) {
      window.__spotifyNav?.navigate?.({ name: "entity", entityType, id: entityId });
    }
  });

  const lib = window.__localLibrary || (window.__localLibrary = createLocalLibrary());

  const getSortMode = () => String(localStorage.getItem(SORT_KEY) || "recent");
  const getViewMode = () => String(localStorage.getItem(VIEW_KEY) || "default");

  const applyLibraryView = () => {
    if (!contentRoot) return;
    const mode = getViewMode();
    const classes = [
      "library-view-default",
      "library-view-compact",
      "library-view-compact-grid",
      "library-view-default-grid",
    ];
    for (const c of classes) contentRoot.classList.remove(c);
    if (mode === "compact") contentRoot.classList.add("library-view-compact");
    else if (mode === "compact-grid") contentRoot.classList.add("library-view-compact-grid");
    else if (mode === "default-grid") contentRoot.classList.add("library-view-default-grid");
    else contentRoot.classList.add("library-view-default");
  };

  const applyLibrarySort = () => {
    const mode = getSortMode();
    const items = Array.from(list.querySelectorAll(".library-item"));
    if (items.length <= 1) return;

    // Keep Liked Songs at the top.
    const pinned = items.filter((it) => it.dataset.route === "liked");
    const rest = items.filter((it) => it.dataset.route !== "liked");

    const keyFor = (it) => {
      const t = it.dataset.sortTitle || norm(it.querySelector(".library-item__title")?.textContent);
      const c = it.dataset.sortCreator || norm(it.querySelector(".library-item__subtitle")?.textContent);
      if (mode === "alpha") return t;
      if (mode === "creator") return c || t;
      return ""; // recent: preserve current order
    };

    if (mode === "alpha" || mode === "creator") {
      rest.sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
      list.innerHTML = "";
      for (const it of pinned) list.appendChild(it);
      for (const it of rest) list.appendChild(it);
    }
  };

  const applySortAndView = () => {
    applyLibraryView();
    applyLibrarySort();
    applySearchFilter();
  };

  const ensureRecentsMenu = () => {
    if (!recentsBtn) return null;
    if (document.getElementById("libraryRecentsMenu")) return document.getElementById("libraryRecentsMenu");

    const menu = document.createElement("div");
    menu.id = "libraryRecentsMenu";
    menu.className = "library-recents-menu";
    menu.hidden = true;
    menu.tabIndex = -1;
    document.body.appendChild(menu);

    const setOpen = (open) => {
      menu.hidden = !open;
      recentsBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) {
        const rect = recentsBtn.getBoundingClientRect();
        const x = Math.round(rect.right - 260);
        const y = Math.round(rect.bottom + 10);
        menu.style.left = `${Math.max(12, x)}px`;
        menu.style.top = `${Math.max(12, y)}px`;
        menu.focus();
      }
    };

    const isOpen = () => !menu.hidden;

    const renderMenu = () => {
      const sort = getSortMode();
      const view = getViewMode();
      menu.innerHTML = `
        <div class="library-recents-menu__section">
          <div class="library-recents-menu__label">Sort by</div>
          <button type="button" class="library-recents-menu__item${sort === "recent" ? " is-active" : ""}" data-sort="recent">Recent</button>
          <button type="button" class="library-recents-menu__item${sort === "alpha" ? " is-active" : ""}" data-sort="alpha">Alphabetical</button>
          <button type="button" class="library-recents-menu__item${sort === "creator" ? " is-active" : ""}" data-sort="creator">Creator</button>
          <button type="button" class="library-recents-menu__item is-disabled" disabled>Recently played (coming soon)</button>
        </div>
        <div class="library-recents-menu__sep" aria-hidden="true"></div>
        <div class="library-recents-menu__section">
          <div class="library-recents-menu__label">View as</div>
          <button type="button" class="library-recents-menu__item${view === "compact" ? " is-active" : ""}" data-view="compact">Compact</button>
          <button type="button" class="library-recents-menu__item${view === "default" ? " is-active" : ""}" data-view="default">Default List</button>
          <button type="button" class="library-recents-menu__item${view === "compact-grid" ? " is-active" : ""}" data-view="compact-grid">Compact Grid</button>
          <button type="button" class="library-recents-menu__item${view === "default-grid" ? " is-active" : ""}" data-view="default-grid">Default Grid</button>
        </div>
      `;
    };

    renderMenu();

    menu.addEventListener("click", (event) => {
      const btn = event.target?.closest?.("button");
      if (!btn) return;
      const s = btn.dataset.sort;
      const v = btn.dataset.view;
      if (s) {
        localStorage.setItem(SORT_KEY, s);
        applySortAndView();
        renderMenu();
        return;
      }
      if (v) {
        localStorage.setItem(VIEW_KEY, v);
        applySortAndView();
        renderMenu();
      }
    });

    document.addEventListener("click", (event) => {
      if (!isOpen()) return;
      if (menu.contains(event.target)) return;
      if (recentsBtn.contains(event.target)) return;
      setOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (!isOpen()) return;
      if (event.key === "Escape") setOpen(false);
    });

    recentsBtn.addEventListener("click", () => {
      renderMenu();
      setOpen(!isOpen());
    });

    return menu;
  };

  ensureRecentsMenu();
  applySortAndView();

  const renderLibraryLocal = () => {
    const state = lib.load();
    const savedTracksCount = Object.keys(state.savedTracks || {}).length;

    list.innerHTML = "";

    const addItem = ({ category, title, subtitle, imageUrl, entityType, entityId, isActive, isLiked }) => {
      const a = document.createElement("a");
      a.className = `library-item${isActive ? " is-active" : ""}`;
      a.href = "#";
      a.setAttribute("role", "listitem");
      a.dataset.category = category;
      if (entityType) a.dataset.entityType = entityType;
      if (entityId) a.dataset.entityId = String(entityId);
      if (isLiked) a.dataset.route = "liked";
      a.dataset.sortTitle = norm(title);
      a.dataset.sortCreator = norm(subtitle);

      const cover = isLiked
        ? `<div class="cover cover--liked" aria-hidden="true"><i class="ri-heart-fill cover__icon" aria-hidden="true"></i></div>`
        : `<img class="cover cover--img${category === "artist" ? " cover--artist" : ""}" alt="" src="${imageUrl || ""}" />`;

      a.innerHTML = `
        ${cover}
        <div class="library-item__meta">
          <div class="library-item__title">${String(title || "")}</div>
          <div class="library-item__subtitle">${String(subtitle || "")}</div>
        </div>
      `;
      list.appendChild(a);
    };

    addItem({
      category: "playlist",
      title: "Liked Songs",
      subtitle: savedTracksCount > 0 ? `${savedTracksCount} songs` : "No saved songs",
      entityType: null,
      entityId: null,
      isActive: true,
      isLiked: true,
    });
  };

  const refresh = () => {
    renderLibraryLocal();
    applySortAndView();
  };

  refresh();
  window.addEventListener("local-library:changed", () => refresh());
}

function getDeezerSectionsContainer() {
  return document.querySelector("[data-deezer-sections]");
}

function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getPictureMd5(item) {
  const pic0 = item?.pictures?.[0];
  if (pic0 && typeof pic0.md5 === "string" && pic0.md5) return pic0.md5;
  const data = item?.data;
  if (data && typeof data === "object") {
    if (typeof data.ALB_PICTURE === "string" && data.ALB_PICTURE) return data.ALB_PICTURE;
    if (typeof data.ART_PICTURE === "string" && data.ART_PICTURE) return data.ART_PICTURE;
    if (typeof data.PLAYLIST_PICTURE === "string" && data.PLAYLIST_PICTURE) return data.PLAYLIST_PICTURE;
  }
  return null;
}

function getPictureType(item) {
  const pic0 = item?.pictures?.[0];
  if (pic0 && typeof pic0.type === "string" && pic0.type) return pic0.type;
  const t = String(item?.type || "").toLowerCase();
  if (t === "artist" || t === "playlist") return t;
  if (t === "album" || t === "track") return "cover";
  return "cover";
}

function buildDeezerImageUrl(item) {
  const md5 = getPictureMd5(item);
  if (!md5) return "";
  const type = getPictureType(item);
  if (type === "artist") {
    return `https://cdn-images.dzcdn.net/images/artist/${md5}/528x528-000000-80-0-0.jpg`;
  }
  if (type === "playlist") {
    return `https://cdn-images.dzcdn.net/images/playlist/${md5}/528x528-000000-80-0-0.jpg`;
  }
  return `https://cdn-images.dzcdn.net/images/cover/${md5}/500x500.jpg`;
}

function renderDeezerSectionsSkeleton(container) {
  container.innerHTML = "";

  const skeletonSection = (title) => {
    const section = document.createElement("section");
    section.className = "made-for";

    const header = document.createElement("div");
    header.className = "made-for__header";

    const titles = document.createElement("div");
    titles.className = "made-for__titles";

    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = title;
    titles.appendChild(h2);
    header.appendChild(titles);
    section.appendChild(header);

    const carousel = document.createElement("div");
    carousel.className = "carousel";
    carousel.setAttribute("role", "list");

    for (let i = 0; i < 6; i++) {
      const card = document.createElement("div");
      card.className = "big-card big-card--skeleton";
      card.setAttribute("role", "listitem");

      const cover = document.createElement("div");
      cover.className = "big-card__cover big-card__cover--skeleton";

      const titleLine = document.createElement("div");
      titleLine.className = "big-card__title big-card__title--skeleton";

      const subtitleLine = document.createElement("div");
      subtitleLine.className = "big-card__subtitle big-card__subtitle--skeleton";

      card.appendChild(cover);
      card.appendChild(titleLine);
      card.appendChild(subtitleLine);
      carousel.appendChild(card);
    }

    section.appendChild(carousel);
    return section;
  };

  container.appendChild(skeletonSection("Continue streaming"));
  container.appendChild(skeletonSection("Mixes inspired by..."));
  container.appendChild(skeletonSection("Playlists you'll love"));
  container.appendChild(skeletonSection("New releases for you"));
}

function renderDeezerSections(container, appState) {
  const sections = Array.isArray(appState?.sections) ? appState.sections : [];
  const want = new Map([
    ["continue streaming", "Continue streaming"],
    ["mixes inspired by", "Mixes inspired by..."],
    ["playlists you'll love", "Playlists you'll love"],
    ["new releases for you", "New releases for you"],
  ]);

  const picked = [];
  for (const s of sections) {
    const t = normalizeTitle(s?.title);
    for (const key of want.keys()) {
      if (t.includes(key)) {
        picked.push(s);
        break;
      }
    }
  }

  container.innerHTML = "";
  for (const sectionData of picked) {
    const section = document.createElement("section");
    section.className = "made-for";
    section.setAttribute("aria-label", sectionData?.title || "Section");

    const header = document.createElement("div");
    header.className = "made-for__header";

    const titles = document.createElement("div");
    titles.className = "made-for__titles";

    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = sectionData?.title || "";
    titles.appendChild(h2);
    header.appendChild(titles);
    section.appendChild(header);

    const carousel = document.createElement("div");
    carousel.className = "carousel";
    carousel.setAttribute("role", "list");

    const items = Array.isArray(sectionData?.items) ? sectionData.items : [];
    for (const item of items) {
      const a = document.createElement("a");
      a.className = "big-card is-enter";
      a.href = "#";
      a.setAttribute("role", "listitem");
      if (typeof item?.target === "string") a.dataset.target = item.target;

      const cover = document.createElement("div");
      const itemType = String(item?.type || "").toLowerCase();
      cover.className = `big-card__cover${itemType === "artist" ? " big-card__cover--circle" : ""}`;

      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      const src = buildDeezerImageUrl(item);
      if (src) img.src = src;
      cover.appendChild(img);

      const play = document.createElement("span");
      play.className = "hover-play hover-play--cover";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
      cover.appendChild(play);

      const title = document.createElement("div");
      title.className = "big-card__title";
      title.textContent = String(item?.title || item?.data?.ALB_TITLE || item?.data?.SNG_TITLE || "");

      const subtitle = document.createElement("div");
      subtitle.className = "big-card__subtitle";
      subtitle.textContent = String(item?.description || item?.subtitle || "");

      a.appendChild(cover);
      a.appendChild(title);
      a.appendChild(subtitle);
      carousel.appendChild(a);
    }

    section.appendChild(carousel);
    container.appendChild(section);
  }

  requestAnimationFrame(() => {
    for (const el of container.querySelectorAll(".big-card.is-enter")) {
      el.classList.remove("is-enter");
    }
  });
}

function computeSectionsSignature(appState) {
  const sections = Array.isArray(appState?.sections) ? appState.sections : [];
  const want = ["continue streaming", "mixes inspired by", "playlists you'll love", "new releases for you"];
  const picked = [];
  for (const s of sections) {
    const t = normalizeTitle(s?.title);
    if (!want.some((w) => t.includes(w))) continue;
    const firstId = s?.items?.[0]?.id || s?.items?.[0]?.item_id || null;
    picked.push([t, firstId, s?.items?.length || 0]);
  }
  return JSON.stringify(picked);
}

function wireDeezerSections() {
  const container = getDeezerSectionsContainer();
  if (!container) return;

  if (!window.deezer || typeof window.deezer.getAppState !== "function") {
    container.innerHTML = "";
    return;
  }

  let lastSignature = null;
  let inFlight = false;
  const MIN_SKELETON_MS = 350;
  let skeletonShownAt = 0;
  let hasRenderedFresh = false;
  let bootAtMs = null;
  const WARMUP_POLL_MS = 400;
  const WARMUP_TIMEOUT_MS = 20000;
  const warmupStartedAt = performance.now();

  const refresh = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const res = await window.deezer.getAppState();
      if (typeof res?.bootAtMs === "number" && !bootAtMs) bootAtMs = res.bootAtMs;
      const mtimeMs = typeof res?.mtimeMs === "number" ? res.mtimeMs : null;
      const isFreshForThisRun =
        typeof bootAtMs === "number" && typeof mtimeMs === "number" ? mtimeMs >= bootAtMs : false;

      if (!res?.ok || !res?.appState) {
        return;
      }

      if (!isFreshForThisRun && !hasRenderedFresh) {
        return;
      }

      const sig = computeSectionsSignature(res.appState);
      if (sig && sig === lastSignature) return;

      const elapsed = performance.now() - skeletonShownAt;
      if (elapsed < MIN_SKELETON_MS) {
        await new Promise((r) => setTimeout(r, MIN_SKELETON_MS - elapsed));
      }

      lastSignature = sig;
      renderDeezerSections(container, res.appState);
      hasRenderedFresh = true;
    } finally {
      inFlight = false;
    }
  };

  container.addEventListener("click", (event) => {
    const a = event.target?.closest?.("a.big-card");
    if (!a) return;
    const target = a.dataset.target;
    if (!target) return;
    event.preventDefault();

    const m = String(target).match(/^\/(album|artist|playlist)\/(\d+)/i);
    if (!m) return;
    const entityType = m[1].toLowerCase();
    const id = m[2];
    window.__spotifyNav?.navigate?.({ name: "entity", entityType, id });
  });

  renderDeezerSectionsSkeleton(container);
  skeletonShownAt = performance.now();

  // Allow Home button to force a refresh + skeleton.
  window.__deezerSectionsRefresh = () => {
    lastSignature = null;
    renderDeezerSectionsSkeleton(container);
    skeletonShownAt = performance.now();
    void refresh();
  };

  const warmupInterval = setInterval(() => {
    if (hasRenderedFresh) {
      clearInterval(warmupInterval);
      setInterval(() => void refresh(), 8000);
      return;
    }
    const elapsed = performance.now() - warmupStartedAt;
    if (elapsed > WARMUP_TIMEOUT_MS) {
      clearInterval(warmupInterval);
      return;
    }
    void refresh();
  }, WARMUP_POLL_MS);

  requestAnimationFrame(() => requestAnimationFrame(() => void refresh()));
}

wirePlatformClasses();
wireRanges();
wireChips();
window.__player = createPlayerController();
wireQuickCards();
wireLibrarySelection();
wireLibraryFilters();
wireLibraryData();
wireSidebarResize();
wireSidebarCollapse();
wireAccountMenu();
wireNavigation();
wireNowPlayingHighlights();
wireNotifications();
wireDownloads();
wireDeezerSections();
