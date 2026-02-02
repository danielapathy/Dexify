import { clamp, formatRecordTypeLabel } from "./utils.js";
import { getLocalLibrary } from "./localLibrary.js";

export function wireQuickCards() {
  const grid = document.getElementById("quickGrid");
  const lib = getLocalLibrary();

  const focusTopSearch = () => {
    const input = document.getElementById("topSearchInput");
    try {
      input?.focus?.();
    } catch {}
  };

  const createQuickEmpty = () => {
    const wrap = document.createElement("div");
    wrap.className = "quick-empty";

    const icon = document.createElement("div");
    icon.className = "quick-empty__icon";
    icon.innerHTML = '<i class="ri-emotion-happy-line" aria-hidden="true"></i>';

    const text = document.createElement("div");
    text.className = "quick-empty__text";
    text.innerHTML = "<strong>No recents yet.</strong><br/>Search and play something — it’ll show up here.";

    const actions = document.createElement("div");
    actions.className = "quick-empty__actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill is-active";
    btn.textContent = "Search music";
    btn.addEventListener("click", () => focusTopSearch());
    actions.appendChild(btn);

    wrap.appendChild(icon);
    wrap.appendChild(text);
    wrap.appendChild(actions);
    return wrap;
  };

  const normalizeRecentToPlayer = (r) => {
    const cover =
      String(r?.albumCover || r?.trackJson?.album?.cover_medium || r?.trackJson?.album?.cover_small || r?.trackJson?.album?.cover || r?.trackJson?.cover || "").trim() ||
      "";
    const raw = r?.trackJson && typeof r.trackJson === "object" ? { ...r.trackJson } : null;
    if (raw) {
      if (cover) {
        raw.cover = String(raw.cover || cover);
        if (raw.album && typeof raw.album === "object") {
          raw.album = { ...raw.album };
          raw.album.cover_small = String(raw.album.cover_small || cover);
          raw.album.cover_medium = String(raw.album.cover_medium || cover);
          raw.album.cover = String(raw.album.cover || cover);
        } else if (raw.album === undefined) {
          raw.album = { cover_small: cover, cover_medium: cover, cover };
        }
      }
      return raw;
    }
    return {
      id: Number(r?.id) || null,
      title: String(r?.title || ""),
      duration: Number(r?.duration) || 0,
      artist: { id: Number(r?.artistId) || null, name: String(r?.artist || "") },
      album: { cover_small: cover, cover_medium: cover, cover: cover, title: String(r?.albumTitle || ""), id: Number(r?.albumId) || null },
      ...(cover ? { cover } : {}),
    };
  };

  const render = () => {
    if (!grid) return;
    grid.innerHTML = "";

    const recents = lib.listRecentTracks().slice(0, 8);
    if (recents.length === 0) {
      grid.appendChild(createQuickEmpty());
      return;
    }

    const queue = recents.map((r) => normalizeRecentToPlayer(r));

    let idx = 0;
    for (const t of recents) {
      const i = idx++;
      const a = document.createElement("a");
      a.className = "quick-card";
      a.href = "#";
      a.dataset.trackIndex = String(i);
      a.dataset.trackId = String(t?.id || "");
      const albumId = Number(t?.albumId || t?.trackJson?.album?.id) || 0;
      if (Number.isFinite(albumId) && albumId > 0) a.dataset.albumId = String(albumId);
      const artistId = Number(t?.artistId || t?.trackJson?.artist?.id) || 0;
      if (Number.isFinite(artistId) && artistId > 0) a.dataset.artistId = String(artistId);
      a.__payload = queue[i] || null;

      const cover = document.createElement("div");
      cover.className = "quick-card__cover";
      const coverUrl = String(t?.albumCover || t?.trackJson?.album?.cover_medium || t?.trackJson?.album?.cover_small || t?.trackJson?.album?.cover || "").trim();
      if (coverUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.src = coverUrl;
        cover.appendChild(img);
      } else {
        cover.classList.add("cover--liked-mini");
        cover.innerHTML = '<i class="ri-music-2-fill cover__icon cover__icon--mini" aria-hidden="true"></i>';
      }

      const meta = document.createElement("div");
      meta.className = "quick-card__meta";
      const title = document.createElement("div");
      title.className = "quick-card__title";
      title.textContent = String(t?.title || "Track");
      const subtitle = document.createElement("div");
      subtitle.className = "quick-card__subtitle";
      subtitle.textContent = String(t?.artist || "");
      meta.appendChild(title);
      meta.appendChild(subtitle);

      const play = document.createElement("span");
      play.className = "hover-play";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';

      a.appendChild(cover);
      a.appendChild(meta);
      a.appendChild(play);

      a.addEventListener("click", (event) => {
        event.preventDefault();
        const cards = Array.from(grid.querySelectorAll(".quick-card"));
        for (const c of cards) c.classList.toggle("is-playing", c === a);
        if (window.__player?.setQueueAndPlay) void window.__player.setQueueAndPlay(queue, i);
      });

      grid.appendChild(a);
    }
  };

  render();
  window.addEventListener("local-library:changed", () => render());
}

export function wireLibrarySelection() {
  const items = Array.from(document.querySelectorAll(".library-item"));
  for (const item of items) {
    item.addEventListener("click", (event) => {
      event.preventDefault();
      for (const i of items) i.classList.toggle("is-active", i === item);
    });
  }
}

export function wireLibraryFilters() {
  const filterButtons = Array.from(document.querySelectorAll(".library__filters .pill[data-filter]"));
  if (filterButtons.length === 0) return;

  const list = document.getElementById("libraryList") || document.querySelector(".library__list");
  if (!list) return;

  const pinnedRoutes = new Set(["liked", "downloads"]);
  const FILTER_KEY = "spotify.libraryFilter";

  const isValidFilter = (filter) => {
    const f = String(filter || "");
    if (!f) return false;
    return filterButtons.some((b) => b.dataset.filter === f);
  };

  const applyFilter = (filter) => {
    const activeFilter = isValidFilter(filter) ? String(filter) : "all";
    for (const button of filterButtons) {
      const isActive = button.dataset.filter === activeFilter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    try {
      localStorage.setItem(FILTER_KEY, activeFilter);
    } catch {}

    const items = Array.from(list.querySelectorAll(".library-item[data-category]"));
    let firstVisible = null;
    for (const item of items) {
      const route = String(item.dataset.route || "");
      const shouldShow =
        pinnedRoutes.has(route) ||
        activeFilter === "all" ||
        (activeFilter && item.dataset.category === activeFilter);
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

  const stored = (() => {
    try {
      return String(localStorage.getItem(FILTER_KEY) || "");
    } catch {
      return "";
    }
  })();
  const initial = (isValidFilter(stored) && stored) || filterButtons.find((b) => b.classList.contains("is-active"))?.dataset.filter || "all";
  applyFilter(initial);
}

export function wireSidebarResize() {
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

export function wireSidebarCollapse() {
  const content = document.querySelector(".content");
  const button = document.querySelector(".library__collapse");
  if (!content || !button) return;

  const COLLAPSE_KEY = "spotify.sidebarCollapsed";
  const WIDTH_KEY = "spotify.sidebarWidthBeforeCollapse";

  const isCollapsed = () => content.classList.contains("is-sidebar-collapsed");

  const applyCollapsed = (shouldCollapse) => {
    if (shouldCollapse) {
      const styles = getComputedStyle(content);
      const currentWidth = parseFloat(styles.getPropertyValue("--sidebar-width")) || 330;
      localStorage.setItem(WIDTH_KEY, String(currentWidth));

      content.classList.add("is-sidebar-collapsed");
      button.setAttribute("aria-pressed", "true");
    } else {
      content.classList.remove("is-sidebar-collapsed");
      button.setAttribute("aria-pressed", "false");

      const savedWidth = Number(localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 120) {
        content.style.setProperty("--sidebar-width", `${Math.round(savedWidth)}px`);
      }
    }
    localStorage.setItem(COLLAPSE_KEY, shouldCollapse ? "1" : "0");
  };

  const saved = localStorage.getItem(COLLAPSE_KEY) === "1";
  applyCollapsed(saved);

  button.addEventListener("click", () => applyCollapsed(!isCollapsed()));
}

export function wireLibraryData() {
  const list = document.getElementById("libraryList");
  const searchBtn = document.getElementById("librarySearchBtn");
  const searchPill = document.getElementById("librarySearchPill");
  const searchInput = document.getElementById("librarySearchInput");
  const searchClearBtn = document.getElementById("librarySearchClearBtn");
  const tools = searchBtn?.closest?.(".library__tools") || null;
  if (!list || !searchBtn || !searchPill || !searchInput || !searchClearBtn || !tools) return;

  const contentRoot = document.querySelector(".content");
  const recentsBtn = document.querySelector(".recents");

  const SORT_KEY = "spotify.librarySort";
  const VIEW_KEY = "spotify.libraryView";
  const FILTER_KEY = "spotify.libraryFilter";

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const getText = (el) => String(el?.textContent || "").trim().toLowerCase();

  const applySearchFilter = () => {
    const q = norm(searchInput.value);
    const items = Array.from(list.querySelectorAll(".library-item"));
    for (const it of items) {
      const title = getText(it.querySelector(".library-item__title"));
      const subtitle = getText(it.querySelector(".library-item__subtitle"));
      const extra = norm(it.dataset.searchMeta || "");
      const matches = !q || title.includes(q) || subtitle.includes(q) || (extra && extra.includes(q));
      it.classList.toggle("is-hidden-by-search", !matches);
    }

    const active = list.querySelector(".library-item.is-active");
    const activeHidden = active?.hidden || active?.classList?.contains?.("is-hidden-by-search");
    if (active && activeHidden) {
      const nextActive = items.find((it) => !it.hidden && !it.classList.contains("is-hidden-by-search"));
      if (nextActive) {
        for (const it of items) it.classList.toggle("is-active", it === nextActive);
      }
    }
  };

  const setSearchOpen = (open) => {
    tools.classList.toggle("is-search-open", open);
    searchPill.setAttribute("aria-expanded", open ? "true" : "false");
    searchInput.disabled = !open;
    searchClearBtn.disabled = !open;
    if (open) {
      try {
        const recentsMenu = document.getElementById("libraryRecentsMenu");
        if (recentsMenu) recentsMenu.hidden = true;
      } catch {}
      try {
        recentsBtn?.setAttribute?.("aria-expanded", "false");
      } catch {}
      searchInput.focus();
    } else {
      searchInput.value = "";
    }
    applySearchFilter();
  };

  const isOpen = () => tools.classList.contains("is-search-open");

  searchPill.addEventListener("click", () => {
    if (!isOpen()) setSearchOpen(true);
    else searchInput.focus();
  });

  searchBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!isOpen()) setSearchOpen(true);
    else searchInput.focus();
  });
  searchInput.addEventListener("input", () => applySearchFilter());
  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    setSearchOpen(false);
  });
  searchClearBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSearchOpen(false);
  });

  setSearchOpen(false);

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
    if (item.dataset.route === "downloads") {
      window.__spotifyNav?.navigate?.({ name: "downloads" });
      return;
    }
    if (item.dataset.route === "saved-track") {
      const trackId = Number(item.dataset.trackId);
      const lib = getLocalLibrary();
      const t = lib.getSavedTrack?.(trackId);
      if (t && window.__player?.setQueueAndPlay) {
        void window.__player.setQueueAndPlay([t], 0);
      }
      return;
    }

    const entityType = item.dataset.entityType;
    const entityId = item.dataset.entityId;
    if (entityType && entityId) {
      window.__spotifyNav?.navigate?.({ name: "entity", entityType, id: entityId });
    }
  });

  const getSortMode = () => String(localStorage.getItem(SORT_KEY) || "recent");
  const getViewMode = () => String(localStorage.getItem(VIEW_KEY) || "default");

  const applyLibraryView = () => {
    if (!contentRoot) return;
    const mode = getViewMode();
    const classes = ["library-view-default", "library-view-compact", "library-view-compact-grid", "library-view-default-grid"];
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

    const pinnedRoutes = new Set(["liked", "downloads"]);
    const pinned = items.filter((it) => pinnedRoutes.has(String(it.dataset.route || "")));
    const rest = items.filter((it) => !pinnedRoutes.has(String(it.dataset.route || "")));

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    if (mode === "recent" || mode === "recently-added") {
      const key = mode === "recent" ? "sortRecent" : "sortAdded";
      rest.sort((a, b) => num(b.dataset[key]) - num(a.dataset[key]));
      list.innerHTML = "";
      for (const it of pinned) list.appendChild(it);
      for (const it of rest) list.appendChild(it);
      return;
    }

    const keyFor = (it) => {
      const t = it.dataset.sortTitle || norm(it.querySelector(".library-item__title")?.textContent);
      const c = it.dataset.sortCreator || norm(it.querySelector(".library-item__subtitle")?.textContent);
      if (mode === "alpha") return t;
      if (mode === "creator") return c || t;
      return "";
    };

    if (mode === "alpha" || mode === "creator") {
      rest.sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
      list.innerHTML = "";
      for (const it of pinned) list.appendChild(it);
      for (const it of rest) list.appendChild(it);
    }
  };

  const applyCategoryFilter = () => {
    let filter = "all";
    try {
      filter = String(localStorage.getItem(FILTER_KEY) || "all");
    } catch {
      filter = "all";
    }

    const pinnedRoutes = new Set(["liked", "downloads"]);
    const items = Array.from(list.querySelectorAll(".library-item[data-category]"));
    if (items.length === 0) return;

    const active = list.querySelector(".library-item.is-active");
    const activeVisible = Boolean(active && !active.hidden);

    let firstVisible = null;
    for (const item of items) {
      const route = String(item.dataset.route || "");
      const shouldShow = pinnedRoutes.has(route) || filter === "all" || (filter && item.dataset.category === filter);
      item.hidden = !shouldShow;
      if (shouldShow && !firstVisible) firstVisible = item;
    }

    if (!activeVisible && firstVisible) {
      for (const item of items) item.classList.toggle("is-active", item === firstVisible);
    }
  };

  const applySortAndView = () => {
    applyLibraryView();
    applyLibrarySort();
    applyCategoryFilter();
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
          <button type="button" class="library-recents-menu__item${sort === "recent" ? " is-active" : ""}" data-sort="recent">
            <span>Recents</span>
            <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
          </button>
          <button type="button" class="library-recents-menu__item${sort === "recently-added" ? " is-active" : ""}" data-sort="recently-added">
            <span>Recently added</span>
            <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
          </button>
          <button type="button" class="library-recents-menu__item${sort === "alpha" ? " is-active" : ""}" data-sort="alpha">
            <span>Alphabetical</span>
            <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
          </button>
          <button type="button" class="library-recents-menu__item${sort === "creator" ? " is-active" : ""}" data-sort="creator">
            <span>Creator</span>
            <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
          </button>
        </div>
        <div class="library-recents-menu__sep" aria-hidden="true"></div>
        <div class="library-recents-menu__section">
          <div class="library-recents-menu__label">View as</div>
          <div class="library-recents-menu__viewRow" role="group" aria-label="View as">
            <button type="button" class="library-recents-menu__iconBtn${view === "compact" ? " is-active" : ""}" data-view="compact" data-tooltip="Compact" aria-label="Compact">
              <i class="ri-menu-line" aria-hidden="true"></i>
            </button>
            <button type="button" class="library-recents-menu__iconBtn${view === "default" ? " is-active" : ""}" data-view="default" data-tooltip="Default List" aria-label="Default List">
              <i class="ri-list-check-2" aria-hidden="true"></i>
            </button>
            <button type="button" class="library-recents-menu__iconBtn${view === "compact-grid" ? " is-active" : ""}" data-view="compact-grid" data-tooltip="Compact Grid" aria-label="Compact Grid">
              <i class="ri-grid-line" aria-hidden="true"></i>
            </button>
            <button type="button" class="library-recents-menu__iconBtn${view === "default-grid" ? " is-active" : ""}" data-view="default-grid" data-tooltip="Default Grid" aria-label="Default Grid">
              <i class="ri-layout-grid-line" aria-hidden="true"></i>
            </button>
          </div>
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

  const renderLibraryLocal = async () => {
    const lib = getLocalLibrary();
    const state = lib.load();

    const savedTracksCount = Object.keys(state.savedTracks || {}).length;
    const downloadedTracksState =
      state.downloadedTracks && typeof state.downloadedTracks === "object" ? state.downloadedTracks : {};

    let downloadedTracksCount = Object.values(downloadedTracksState || {}).filter((t) => t?.download?.fileUrl).length;

    const recentTracks = Array.isArray(state.recentTracks) ? state.recentTracks : [];
    const playedAtByTrackId = new Map();
    const playedAtByAlbumId = new Map();
    for (const r of recentTracks) {
      const playedAt = Number(r?.playedAt) || 0;
      if (!Number.isFinite(playedAt) || playedAt <= 0) continue;

      const trackId = Number(r?.id);
      if (Number.isFinite(trackId) && trackId > 0) {
        const prev = playedAtByTrackId.get(trackId) || 0;
        if (playedAt > prev) playedAtByTrackId.set(trackId, playedAt);
      }

      const albumId = Number(r?.albumId);
      if (Number.isFinite(albumId) && albumId > 0) {
        const prev = playedAtByAlbumId.get(albumId) || 0;
        if (playedAt > prev) playedAtByAlbumId.set(albumId, playedAt);
      }
    }

    const getTrackDownloadedAt = (trackId) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return 0;
      const entry =
        downloadedTracksState[String(id)] && typeof downloadedTracksState[String(id)] === "object"
          ? downloadedTracksState[String(id)]
          : null;
      const at = Number(entry?.download?.at) || Number(entry?.download?.mtimeMs) || Number(entry?.updatedAt) || 0;
      return Number.isFinite(at) && at > 0 ? at : 0;
    };

	    const albumTotalsById = new Map(); // albumId -> totalTracks
	    const albumMetaById = new Map(); // albumId -> { title, artist, cover, recordType }
    const albumDownloadedTrackIdsById = new Map(); // albumId -> Set(trackId)
    const albumLastDownloadedAtById = new Map(); // albumId -> max download.at (best-effort)
    const albumSearchPartsById = new Map(); // albumId -> Set(text)

    try {
      if (window.dl?.listDownloads) {
        const res = await window.dl.listDownloads();
        const rows = Array.isArray(res?.tracks) ? res.tracks : [];
        downloadedTracksCount = rows.length;

        const getAlbumId = (row) => {
          const album = row?.album && typeof row.album === "object" ? row.album : null;
          const track = row?.track && typeof row.track === "object" ? row.track : null;
          const direct = Number(row?.albumId || row?.album_id);
          const id = Number(album?.id || album?.ALB_ID || direct || track?.album?.id || track?.ALB_ID || track?.album_id);
          return Number.isFinite(id) && id > 0 ? id : null;
        };

        const getAlbumTotal = (album) => {
          const a = album && typeof album === "object" ? album : null;
          if (!a) return null;
          const direct = Number(a?.nb_tracks);
          if (Number.isFinite(direct) && direct > 0) return direct;
          const nested = Number(a?.tracks?.total);
          if (Number.isFinite(nested) && nested > 0) return nested;
          if (Array.isArray(a?.tracks?.data) && a.tracks.data.length > 0) return a.tracks.data.length;
          if (Array.isArray(a?.tracks) && a.tracks.length > 0) return a.tracks.length;
          return null;
        };

        const pickCover = (album, coverUrl) => {
          const url = typeof coverUrl === "string" ? coverUrl.trim() : "";
          if (url) return url;
          const a = album && typeof album === "object" ? album : null;
          if (!a) return "";
          const candidates = [
            a.cover_medium,
            a.cover_big,
            a.cover_xl,
            a.cover_small,
            a.cover,
            a.picture_medium,
            a.picture_big,
            a.picture_xl,
            a.picture_small,
            a.picture,
          ];
          for (const c of candidates) {
            const s = typeof c === "string" ? c.trim() : "";
            if (s) return s;
          }
          return "";
        };

        for (const row of rows) {
          const track = row?.track && typeof row.track === "object" ? row.track : null;
          const album =
            row?.album && typeof row.album === "object"
              ? row.album
              : track?.album && typeof track.album === "object"
                ? track.album
                : null;

          const albumId = getAlbumId(row);
          if (!albumId) continue;

          const trackId = Number(row?.trackId || track?.id || track?.SNG_ID);
          if (Number.isFinite(trackId) && trackId > 0) {
            const set = albumDownloadedTrackIdsById.get(albumId) || new Set();
            set.add(trackId);
            albumDownloadedTrackIdsById.set(albumId, set);

            const at = Math.max(getTrackDownloadedAt(trackId), Number(row?.mtimeMs) || 0);
            const prevAt = albumLastDownloadedAtById.get(albumId) || 0;
            if (at > prevAt) albumLastDownloadedAtById.set(albumId, at);

            const parts = albumSearchPartsById.get(albumId) || new Set();
            if (parts.size < 60) {
              const tTitle = String(track?.title || track?.SNG_TITLE || "").trim();
              if (tTitle) parts.add(tTitle);
              const tArtist = String(track?.artist?.name || track?.ART_NAME || "").trim();
              if (tArtist) parts.add(tArtist);
            }
            albumSearchPartsById.set(albumId, parts);
          }

          if (!albumTotalsById.has(albumId)) {
            const total = getAlbumTotal(album);
            if (Number.isFinite(total) && total > 0) albumTotalsById.set(albumId, total);
          }

	          if (!albumMetaById.has(albumId)) {
	            const cover = pickCover(album, row?.coverUrl);
	            albumMetaById.set(albumId, {
	              title: String(album?.title || album?.ALB_TITLE || "").trim(),
	              artist: String(album?.artist?.name || album?.artist?.ART_NAME || album?.ART_NAME || "").trim(),
	              recordType: String(album?.record_type || album?.recordType || "").trim(),
	              cover,
	            });
	          }
        }
      }
    } catch {}

    const albumDownloadProgressById = new Map(); // albumId -> { total, downloaded }
    const fullyDownloadedAlbumIds = new Set();
    for (const [albumId, ids] of albumDownloadedTrackIdsById.entries()) {
      const total = albumTotalsById.get(albumId);
      if (!Number.isFinite(total) || total <= 0) continue;
      const downloaded = ids.size;
      albumDownloadProgressById.set(albumId, { total, downloaded });
      if (downloaded >= total) fullyDownloadedAlbumIds.add(albumId);
    }

    list.innerHTML = "";

    const addItem = ({
      category,
      title,
      subtitle,
      imageUrl,
      entityType,
      entityId,
      isActive,
      route,
      trackId,
      sortCreator,
      sortRecent,
      sortAdded,
      searchMeta,
    }) => {
      const a = document.createElement("a");
      a.className = `library-item${isActive ? " is-active" : ""}`;
      a.href = "#";
      a.setAttribute("role", "listitem");

      a.dataset.category = category;
      if (entityType) a.dataset.entityType = entityType;
      if (entityId) a.dataset.entityId = String(entityId);
      if (route) a.dataset.route = String(route);
      if (trackId) a.dataset.trackId = String(trackId);

      a.dataset.sortTitle = norm(title);
      a.dataset.sortCreator = norm(sortCreator || subtitle);
      a.dataset.sortRecent = String(Number(sortRecent) || 0);
      a.dataset.sortAdded = String(Number(sortAdded) || 0);
      a.dataset.searchMeta = searchMeta ? norm(searchMeta) : "";

      const cover =
        route === "liked"
          ? `<div class="cover cover--liked" aria-hidden="true">
              <i class="ri-heart-fill cover__icon" aria-hidden="true"></i>
              <span class="cover__play" aria-hidden="true"><i class="ri-play-fill" aria-hidden="true"></i></span>
            </div>`
          : route === "downloads"
            ? `<div class="cover cover--downloads" aria-hidden="true">
                <i class="ri-download-2-fill cover__icon" aria-hidden="true"></i>
                <span class="cover__play" aria-hidden="true"><i class="ri-play-fill" aria-hidden="true"></i></span>
              </div>`
            : `<div class="cover${category === "artist" ? " cover--artist" : ""}" aria-hidden="true">
                <img class="cover--img" alt="" src="${imageUrl || ""}" />
                <span class="cover__play" aria-hidden="true"><i class="ri-play-fill" aria-hidden="true"></i></span>
              </div>`;

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
      subtitle:
        savedTracksCount > 0
          ? `<i class="ri-pushpin-fill pin-icon" aria-hidden="true"></i> Playlist • ${savedTracksCount} songs`
          : `<i class="ri-pushpin-fill pin-icon" aria-hidden="true"></i> Playlist • No saved songs`,
      entityType: null,
      entityId: null,
      isActive: true,
      route: "liked",
      sortRecent: Number.POSITIVE_INFINITY,
      sortAdded: Number.POSITIVE_INFINITY,
    });

    addItem({
      category: "playlist",
      title: "Downloads",
      subtitle:
        downloadedTracksCount > 0
          ? `<i class="ri-pushpin-fill pin-icon" aria-hidden="true"></i> Offline • ${downloadedTracksCount} songs`
          : `<i class="ri-pushpin-fill pin-icon" aria-hidden="true"></i> Offline • No downloads`,
      entityType: null,
      entityId: null,
      isActive: false,
      route: "downloads",
      sortRecent: Number.POSITIVE_INFINITY - 1,
      sortAdded: Number.POSITIVE_INFINITY - 1,
    });

    const rest = [];

    const savedTracks = Object.values(state.savedTracks || {});
    const albumAddedAtById = new Map(); // albumId -> max saved-track addedAt (for recently-added ordering)
    for (const t of savedTracks) {
      const id = Number(t?.id);
      if (!Number.isFinite(id) || id <= 0) continue;

      const cover = String(t?.albumCover || "").trim();
      const addedAt = Number(t?.addedAt) || 0;
      const albumId = Number(t?.albumId);

      const playedAt = playedAtByTrackId.get(id) || 0;
      const recentAt = Math.max(playedAt, getTrackDownloadedAt(id), addedAt);

      if (Number.isFinite(albumId) && albumId > 0) {
        const prev = albumAddedAtById.get(albumId) || 0;
        const next = Math.max(prev, addedAt);
        if (next > prev) albumAddedAtById.set(albumId, next);
      }

      // If an album is fully downloaded, collapse any saved-track rows into the album item.
      if (Number.isFinite(albumId) && albumId > 0 && fullyDownloadedAlbumIds.has(albumId)) continue;

      rest.push({
        category: "track",
        title: String(t?.title || "Track"),
        subtitle: `Song • ${String(t?.artist || "").trim()}`.trim(),
        sortCreator: String(t?.artist || "").trim(),
        imageUrl: cover,
        entityType: null,
        entityId: null,
        route: "saved-track",
        trackId: id,
        sortRecent: recentAt,
        sortAdded: addedAt,
      });
    }

	    const savedAlbums = Object.values(state.savedAlbums || {});
	    for (const a of savedAlbums) {
	      const id = Number(a?.id);
	      if (!Number.isFinite(id) || id <= 0) continue;

	      const artist = String(a?.artist || "").trim();
	      const title = String(a?.title || "Album");
	      const typeLabel = formatRecordTypeLabel(a?.recordType || a?.record_type, { fallback: "Album" });
	      const subtitleBase = artist ? `${typeLabel} • ${artist}` : typeLabel;
	      const cover = String(a?.cover || "").trim();
	      const addedAt = Number(a?.addedAt) || 0;

      const recentAtBase = Number(a?.updatedAt) || Number(a?.downloadedAt) || addedAt;
      const playedAt = playedAtByAlbumId.get(id) || 0;
      const downloadedAt = albumLastDownloadedAtById.get(id) || 0;
      const recentAt = Math.max(Number(recentAtBase) || 0, playedAt, downloadedAt);

      const progress = albumDownloadProgressById.get(id);
      const isFull = fullyDownloadedAlbumIds.has(id);
      let subtitle = subtitleBase;
      if (isFull) subtitle = `${subtitleBase} • Downloaded`;
      else if (progress && progress.downloaded > 0) subtitle = `${subtitleBase} • ${progress.downloaded}/${progress.total} downloaded`;

      const searchParts = albumSearchPartsById.get(id);
      const searchMeta = searchParts && searchParts.size > 0 ? Array.from(searchParts).join(" ") : "";

      rest.push({
        category: "album",
        title,
        subtitle,
        sortCreator: artist,
        imageUrl: cover,
        entityType: "album",
        entityId: id,
        route: null,
        trackId: null,
        sortRecent: recentAt,
        sortAdded: addedAt,
        searchMeta,
      });
    }

    const savedPlaylists = Object.values(state.playlists || {});
    for (const p of savedPlaylists) {
      const id = Number(p?.id);
      if (!Number.isFinite(id) || id <= 0) continue;

      const creator = String(p?.creator || "").trim();
      const title = String(p?.title || "Playlist");
      const subtitle = creator ? `Playlist • ${creator}` : "Playlist";
      const cover = String(p?.cover || "").trim();
      const addedAt = Number(p?.addedAt) || 0;
      const recentAt = Number(p?.updatedAt) || Number(p?.downloadedAt) || addedAt;

      rest.push({
        category: "playlist",
        title,
        subtitle,
        sortCreator: creator,
        imageUrl: cover,
        entityType: "playlist",
        entityId: id,
        route: null,
        trackId: null,
        sortRecent: recentAt,
        sortAdded: addedAt,
      });
    }

    // Collapsed album rows for fully-downloaded albums (even if the user never explicitly saved the album).
	    for (const albumId of Array.from(fullyDownloadedAlbumIds)) {
	      if (state.savedAlbums && typeof state.savedAlbums === "object" && state.savedAlbums[String(albumId)]) continue;

	      const meta = albumMetaById.get(albumId) || { title: "", artist: "", cover: "", recordType: "" };
	      const title = String(meta.title || "Album").trim() || "Album";
	      const artist = String(meta.artist || "").trim();
	      const typeLabel = formatRecordTypeLabel(meta.recordType, { fallback: "Album" });
	      const subtitleBase = artist ? `${typeLabel} • ${artist}` : typeLabel;
	      const subtitle = `${subtitleBase} • Downloaded`;
	      const cover = String(meta.cover || "").trim();

      const playedAt = playedAtByAlbumId.get(albumId) || 0;
      const downloadedAt = albumLastDownloadedAtById.get(albumId) || 0;
      const sortRecent = Math.max(playedAt, downloadedAt);
      const sortAdded = Math.max(albumAddedAtById.get(albumId) || 0, downloadedAt);

      const searchParts = albumSearchPartsById.get(albumId);
      const searchMeta = searchParts && searchParts.size > 0 ? Array.from(searchParts).join(" ") : "";

      rest.push({
        category: "album",
        title,
        subtitle,
        sortCreator: artist,
        imageUrl: cover,
        entityType: "album",
        entityId: albumId,
        route: null,
        trackId: null,
        sortRecent,
        sortAdded,
        searchMeta,
      });
    }

    rest.sort((a, b) => (Number(b.sortRecent) || 0) - (Number(a.sortRecent) || 0));
    for (const it of rest) addItem({ ...it, isActive: false });
  };

  const refresh = async () => {
    try {
      const existingExit = list.querySelector(".library-exit-layer");
      existingExit?.remove?.();
    } catch {}

    const items = Array.from(list.querySelectorAll(".library-item"));
    const before = new Map();
    const beforeNodes = new Map();
    for (const it of items) {
      const route = String(it.dataset.route || "");
      const key = [
        route,
        String(it.dataset.entityType || ""),
        String(it.dataset.entityId || ""),
        String(it.dataset.trackId || ""),
        it.dataset.sortTitle || norm(it.querySelector(".library-item__title")?.textContent),
      ].join("|");
      before.set(key, it.getBoundingClientRect());
      try {
        beforeNodes.set(key, it.cloneNode(true));
      } catch {}
    }

    list.style.visibility = "hidden";
    await renderLibraryLocal();
    applySortAndView();

    const afterItems = Array.from(list.querySelectorAll(".library-item"));
    const toAnimate = [];
    const afterKeys = new Set();
    for (const it of afterItems) {
      const route = String(it.dataset.route || "");
      const key = [
        route,
        String(it.dataset.entityType || ""),
        String(it.dataset.entityId || ""),
        String(it.dataset.trackId || ""),
        it.dataset.sortTitle || norm(it.querySelector(".library-item__title")?.textContent),
      ].join("|");
      afterKeys.add(key);
      const now = it.getBoundingClientRect();
      const prev = before.get(key);
      if (!prev) {
        it.classList.add("is-enter");
        toAnimate.push(() => it.classList.remove("is-enter"));
        continue;
      }
      const dy = prev.top - now.top;
      if (Math.abs(dy) < 0.5) continue;
      it.style.transition = "none";
      it.style.transform = `translateY(${dy}px)`;
      toAnimate.push(() => {
        it.style.transition = "";
        it.style.transform = "";
      });
    }

    const removed = [];
    for (const [key, rect] of before.entries()) {
      if (afterKeys.has(key)) continue;
      const node = beforeNodes.get(key);
      if (!node) continue;
      removed.push({ node, rect });
    }

    // Ensure initial transforms/opacity apply before revealing.
    // eslint-disable-next-line no-unused-expressions
    list.offsetHeight;
    list.style.visibility = "";

    if (removed.length > 0) {
      try {
        const layer = document.createElement("div");
        layer.className = "library-exit-layer";
        layer.style.position = "absolute";
        layer.style.inset = "0";
        layer.style.pointerEvents = "none";
        layer.style.zIndex = "3";
        layer.style.contain = "layout paint";

        const listRect = list.getBoundingClientRect();
        const scrollTop = Number(list.scrollTop) || 0;
        const scrollLeft = Number(list.scrollLeft) || 0;

        for (const { node, rect } of removed) {
          const el = node && node.nodeType === 1 ? node : null;
          if (!el) continue;
          el.style.position = "absolute";
          el.style.top = `${Math.round(rect.top - listRect.top + scrollTop)}px`;
          el.style.left = `${Math.round(rect.left - listRect.left + scrollLeft)}px`;
          el.style.width = `${Math.round(rect.width)}px`;
          el.style.height = `${Math.round(rect.height)}px`;
          el.style.margin = "0";
          el.style.pointerEvents = "none";
          layer.appendChild(el);
        }

        list.appendChild(layer);
      } catch {}
    }

    requestAnimationFrame(() => {
      for (const fn of toAnimate) fn();
      try {
        const layer = list.querySelector(".library-exit-layer");
        if (layer) {
          const nodes = Array.from(layer.querySelectorAll(".library-item"));
          for (const n of nodes) {
            n.style.opacity = "0";
            n.style.transform = "translateY(-6px)";
          }
          setTimeout(() => {
            try {
              layer.remove();
            } catch {}
          }, 260);
        }
      } catch {}
    });
  };

  void refresh();
  window.addEventListener("local-library:changed", () => void refresh());
  if (window.dl?.onEvent) {
    window.dl.onEvent((payload) => {
      const event = String(payload?.event || "");
      if (event === "downloadFinished" || event === "downloadFailed") void refresh();
    });
  }
}
