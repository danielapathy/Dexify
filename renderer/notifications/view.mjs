import { extractColorPaletteFromImageUrl } from "../utils.js";

function toCoverKey(url) {
  try {
    return encodeURIComponent(String(url || ""));
  } catch {
    return "";
  }
}

function rgbaFromRgb(rgb, alpha = 0.18) {
  const r = Number(rgb?.r);
  const g = Number(rgb?.g);
  const b = Number(rgb?.b);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  const a = Math.max(0, Math.min(1, Number(alpha)));
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRgb(rgb) {
  const r = Number(rgb?.r);
  const g = Number(rgb?.g);
  const b = Number(rgb?.b);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return {
    r: clamp(Math.round(r), 0, 255),
    g: clamp(Math.round(g), 0, 255),
    b: clamp(Math.round(b), 0, 255),
  };
}

function mixRgb(a, b, t = 0.5) {
  const nA = normalizeRgb(a);
  const nB = normalizeRgb(b);
  if (!nA || !nB) return nA || nB || null;
  const f = clamp(Number(t), 0, 1);
  return {
    r: clamp(Math.round(nA.r + (nB.r - nA.r) * f), 0, 255),
    g: clamp(Math.round(nA.g + (nB.g - nA.g) * f), 0, 255),
    b: clamp(Math.round(nA.b + (nB.b - nA.b) * f), 0, 255),
  };
}

function liftRgb(rgb, amount = 0.1) {
  const n = normalizeRgb(rgb);
  if (!n) return null;
  const t = clamp(Number(amount), 0, 1);
  return {
    r: clamp(Math.round(n.r + (255 - n.r) * t), 0, 255),
    g: clamp(Math.round(n.g + (255 - n.g) * t), 0, 255),
    b: clamp(Math.round(n.b + (255 - n.b) * t), 0, 255),
  };
}

function accentVarsFromPalette(palette) {
  const colors = Array.isArray(palette) ? palette.map((c) => normalizeRgb(c)).filter(Boolean) : [];
  const first = colors[0] || null;
  if (!first) return null;
  const second = colors[1] || liftRgb(first, 0.22) || first;

  const accentBase = liftRgb(first, 0.08) || first;
  const accentBlend = mixRgb(accentBase, second, 0.22) || accentBase;
  const shine = liftRgb(second, 0.20) || second;

  return {
    strong: rgbaFromRgb(accentBase, 0.80),
    mid: rgbaFromRgb(accentBlend, 0.55),
    weak: rgbaFromRgb(accentBlend, 0.30),
    progressBase: rgbaFromRgb(accentBase, 0.96),
    progressEnd: rgbaFromRgb(accentBlend, 0.96),
    progressShine: rgbaFromRgb(shine, 0.70),
  };
}

export function createNotificationsView({ rootEl, callbacks }) {
  const coverAccentCache = new Map();
  const coverAccentInFlight = new Set();
  const coverAccentFailed = new Set();

  const cardByUuid = new Map();
  let ui = null;
  let currentSort = "recent";
  let currentFilter = "all";
  let allItems = [];

  const SORT_OPTIONS = [
    { value: "recent", label: "Date" },
    { value: "name", label: "Name" },
  ];

  const FILTER_OPTIONS = [
    { value: "all", label: "All" },
    { value: "completed", label: "Completed" },
    { value: "downloading", label: "Downloading" },
  ];

  const resolveKindKey = (item) => {
    const raw = String(item?.kind || item?.type || "").trim().toLowerCase();
    return raw || "other";
  };

  const resolveKindLabel = (item) => {
    const kind = resolveKindKey(item);
    if (kind === "album") return "Album";
    if (kind === "playlist") return "Playlist";
    if (kind === "artist") return "Artist";
    if (kind === "track") return "Song";
    return "Download";
  };

  const resolveTypeLabel = (item) => {
    const base = resolveKindLabel(item);
    const total = Number(item?.groupCount);
    if (!Number.isFinite(total) || total <= 0) return base;
    const done = Number(item?.groupDone);
    const doneCount = Number.isFinite(done) && done >= 0 ? done : 0;
    return `${base} \u2022 ${Math.min(total, doneCount)}/${total}`;
  };

  const isTerminal = (status) => {
    const s = String(status || "");
    return s === "done" || s === "failed" || s === "cancelled";
  };

  const getFilteredItems = () => {
    let items = [...allItems];
    
    // Apply status filter
    if (currentFilter === "completed") {
      items = items.filter(item => isTerminal(item?.status));
    } else if (currentFilter === "downloading") {
      items = items.filter(item => !isTerminal(item?.status));
    }
    
    // Apply sorting
    if (currentSort === "name") {
      items.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
    } else if (currentSort === "artist") {
      items.sort((a, b) => String(a.artist || "").localeCompare(String(b.artist || "")));
    } else if (currentSort === "progress") {
      items.sort((a, b) => (b.progress || 0) - (a.progress || 0));
    }
    // "recent" keeps original order
    
    return items;
  };
  
  const getActiveItems = () => getFilteredItems().filter((item) => !isTerminal(item?.status));
  const getCompletedItems = () => getFilteredItems().filter((item) => isTerminal(item?.status));

  const refreshCards = (player) => {
    if (!ui) return;
    
    const activeItems = getActiveItems();
    const completedItems = getCompletedItems();

    const syncList = (listEl, items) => {
      if (!listEl) return;
      const desired = [];
      for (const item of items) {
        const uuid = String(item?.uuid || "");
        if (uuid) desired.push(uuid);
      }

      const current = Array.from(listEl.children).map((child) => String(child?.dataset?.uuid || "")).filter(Boolean);
      const sameOrder = desired.length === current.length && desired.every((uuid, idx) => uuid === current[idx]);
      if (sameOrder) return;

      const frag = document.createDocumentFragment();
      for (const uuid of desired) {
        const ref = cardByUuid.get(uuid);
        if (ref?.el) frag.appendChild(ref.el);
      }
      listEl.replaceChildren(frag);
    };
    
    // Update active section
    syncList(ui.activeList, activeItems);
    
    // Update completed section
    syncList(ui.completedList, completedItems);
    
    // Show/hide "Downloading" section based on content (only show if there are active downloads)
    if (ui.activeSection) {
      ui.activeSection.hidden = activeItems.length === 0;
    }
    
    // "Complete Downloads" section is always visible, but show empty state if no items
    if (ui.completedEmpty) {
      ui.completedEmpty.hidden = completedItems.length > 0;
    }
    if (ui.completedList) {
      ui.completedList.hidden = completedItems.length === 0;
    }
  };

  const setSort = (sort, player) => {
    currentSort = sort;
    if (ui?.sortSelect) ui.sortSelect.value = sort;
    refreshCards(player);
  };

  const setFilter = (filter, player) => {
    currentFilter = filter;
    if (ui?.filterSelect) ui.filterSelect.value = filter;
    refreshCards(player);
  };

  const clearAll = () => {
    if (typeof callbacks?.onClearAll === "function") {
      callbacks.onClearAll("all");
    }
  };

  const ensureScaffold = () => {
    if (ui) return ui;

    rootEl.innerHTML = `
      <section class="downloads-shell">
        <header class="downloads-shell__header">
          <h1 class="downloads-shell__title">Notifications</h1>
          <div class="downloads-shell__controls">
            <button class="downloads-shell__dropdownBtn" data-el="sortBtn" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="downloads-shell__dropdownBtn__label">Sort by:</span>
              <span data-el="sortValue">${SORT_OPTIONS.find(o => o.value === currentSort)?.label || 'Date'}</span>
              <i class="ri-arrow-down-s-line downloads-shell__dropdownBtn__arrow" aria-hidden="true"></i>
            </button>
            <button class="downloads-shell__dropdownBtn" data-el="filterBtn" type="button" aria-haspopup="menu" aria-expanded="false">
              <span class="downloads-shell__dropdownBtn__label">Filter:</span>
              <span data-el="filterValue">${FILTER_OPTIONS.find(o => o.value === currentFilter)?.label || 'All'}</span>
              <i class="ri-arrow-down-s-line downloads-shell__dropdownBtn__arrow" aria-hidden="true"></i>
            </button>
            <button class="downloads-shell__clearBtn" data-action="clearAll" type="button">Clear All</button>
          </div>
        </header>
        
        <section class="downloads-shell__section" data-el="activeSection">
          <h2 class="downloads-shell__sectionTitle">Downloading</h2>
          <div class="downloads-shell__list" data-el="activeList"></div>
        </section>
        
        <section class="downloads-shell__section" data-el="completedSection">
          <h2 class="downloads-shell__sectionTitle">Complete Downloads</h2>
          <div class="downloads-shell__list" data-el="completedList"></div>
          <div class="downloads-shell__sectionEmpty" data-el="completedEmpty" hidden>
            <span>No completed downloads yet</span>
          </div>
        </section>
      </section>
    `;

    const sortBtn = rootEl.querySelector('[data-el="sortBtn"]');
    const filterBtn = rootEl.querySelector('[data-el="filterBtn"]');
    const activeSection = rootEl.querySelector('[data-el="activeSection"]');
    const completedSection = rootEl.querySelector('[data-el="completedSection"]');
    const activeList = rootEl.querySelector('[data-el="activeList"]');
    const completedList = rootEl.querySelector('[data-el="completedList"]');
    const completedEmpty = rootEl.querySelector('[data-el="completedEmpty"]');

    ui = { sortBtn, filterBtn, activeSection, completedSection, activeList, completedList, completedEmpty };

    // Global registry for dropdown menus to ensure only one is open
    if (!window.__dropdownMenus) window.__dropdownMenus = new Set();

    const closeAllDropdowns = (except) => {
      for (const closeFunc of window.__dropdownMenus) {
        if (closeFunc !== except) closeFunc();
      }
    };

    const createMenu = ({ id, anchorEl, valueEl, options, getValue, onPick }) => {
      if (!anchorEl) return null;
      if (document.getElementById(id)) return document.getElementById(id);

      const menu = document.createElement("div");
      menu.id = id;
      menu.className = "downloads-dropdown-menu";
      menu.hidden = true;
      menu.tabIndex = -1;
      document.body.appendChild(menu);

      let isAnimating = false;

      const animateOpen = () => {
        menu.hidden = false;
        menu.classList.add("is-opening");
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            menu.classList.remove("is-opening");
            menu.focus();
          });
        });
      };

      const animateClose = (callback) => {
        if (menu.hidden) {
          callback?.();
          return;
        }
        isAnimating = true;
        menu.classList.add("is-closing");
        setTimeout(() => {
          menu.classList.remove("is-closing");
          menu.hidden = true;
          isAnimating = false;
          callback?.();
        }, 150);
      };

      const setOpen = (open) => {
        anchorEl.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          const rect = anchorEl.getBoundingClientRect();
          menu.style.left = `${Math.max(12, Math.round(rect.left))}px`;
          menu.style.top = `${Math.max(12, Math.round(rect.bottom + 6))}px`;
          animateOpen();
        } else {
          animateClose();
        }
      };

      const close = () => setOpen(false);
      window.__dropdownMenus.add(close);

      const isOpen = () => !menu.hidden && !isAnimating;

      const renderMenu = () => {
        const active = String(getValue?.() || "");
        menu.innerHTML = options.map(opt => `
          <button type="button" class="downloads-dropdown-menu__item${opt.value === active ? " is-active" : ""}" data-value="${opt.value}">
            <span>${opt.label}</span>
            ${opt.value === active ? '<i class="ri-check-line" aria-hidden="true"></i>' : ''}
          </button>
        `).join("");
      };

      const updateValueLabel = () => {
        if (!valueEl) return;
        const active = String(getValue?.() || "");
        const opt = options.find(o => o.value === active);
        if (opt) valueEl.textContent = opt.label;
      };

      renderMenu();

      menu.addEventListener("click", (event) => {
        const btn = event.target?.closest?.("button[data-value]");
        if (!btn) return;
        onPick?.(btn.dataset.value);
        renderMenu();
        updateValueLabel();
        setOpen(false);
      });

      document.addEventListener("click", (event) => {
        if (!isOpen()) return;
        if (menu.contains(event.target) || anchorEl.contains(event.target)) return;
        setOpen(false);
      });

      document.addEventListener("keydown", (event) => {
        if (isOpen() && event.key === "Escape") setOpen(false);
      });

      anchorEl.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (isOpen()) {
          setOpen(false);
          return;
        }
        closeAllDropdowns(close);
        renderMenu();
        setOpen(true);
      });

      return menu;
    };

    const sortValueEl = rootEl.querySelector('[data-el="sortValue"]');
    const filterValueEl = rootEl.querySelector('[data-el="filterValue"]');

    createMenu({
      id: "notificationsSortMenu",
      anchorEl: sortBtn,
      valueEl: sortValueEl,
      options: SORT_OPTIONS,
      getValue: () => currentSort,
      onPick: (v) => setSort(v),
    });

    createMenu({
      id: "notificationsFilterMenu",
      anchorEl: filterBtn,
      valueEl: filterValueEl,
      options: FILTER_OPTIONS,
      getValue: () => currentFilter,
      onPick: (v) => setFilter(v),
    });

    rootEl.addEventListener("click", (event) => {
      const clearBtn = event.target?.closest?.("button[data-action='clearAll']");
      if (clearBtn) {
        event.preventDefault();
        clearAll();
        return;
      }

      const btn = event.target?.closest?.("button[data-action]");
      if (btn) {
        event.preventDefault();
        event.stopPropagation();
        const action = String(btn.dataset.action || "");
        const uuid = String(btn.dataset.uuid || "");
        if (typeof callbacks?.onAction === "function") callbacks.onAction({ action, uuid });
        return;
      }

      const card = event.target?.closest?.(".download-card[data-open='1']");
      if (card) {
        const type = String(card.dataset.openType || "");
        const id = String(card.dataset.openId || "");
        if (typeof callbacks?.onAction === "function") callbacks.onAction({ action: "open", type, id });
      }
    });

    return ui;
  };

  const ensureCoverAccent = (coverUrl) => {
    const url = String(coverUrl || "").trim();
    if (!url) return;
    if (coverAccentCache.has(url) || coverAccentFailed.has(url) || coverAccentInFlight.has(url)) return;
    coverAccentInFlight.add(url);
    void extractColorPaletteFromImageUrl(url, { limit: 4 })
      .then((palette) => {
        const vars = accentVarsFromPalette(palette);
        if (vars) coverAccentCache.set(url, vars);
        else coverAccentFailed.add(url);
      })
      .catch(() => {})
      .finally(() => {
        coverAccentInFlight.delete(url);
        // Accent updates are patched per-card; no full re-render.
        const key = toCoverKey(url);
        for (const card of rootEl.querySelectorAll(`.download-card[data-cover-key="${key}"]`)) {
          try {
            const vars = coverAccentCache.get(url);
            if (!vars) continue;
            const prev = String(card.dataset.accentStrong || "");
            if (prev === String(vars.strong || "")) continue;
            card.dataset.accentStrong = String(vars.strong || "");
            card.style.setProperty("--card-accent-strong", vars.strong);
            card.style.setProperty("--card-accent-mid", vars.mid);
            card.style.setProperty("--card-accent-weak", vars.weak);
            card.style.setProperty("--download-progress-base", vars.progressBase);
            card.style.setProperty("--download-progress-end", vars.progressEnd);
            card.style.setProperty("--download-progress-shine", vars.progressShine);
          } catch {}
        }
      });
  };

  const buildCard = (item) => {
    const uuid = String(item.uuid || "");
    const card = document.createElement("article");
    card.className = "download-card";
    card.dataset.uuid = uuid;

    // Store entity data for context menu and navigation
    const trackId = Number(item?.trackId);
    const albumId = Number(item?.albumId);
    const playlistId = Number(item?.playlistId);
    const artistId = Number(item?.artistId);
    if (Number.isFinite(trackId) && trackId > 0) card.dataset.trackId = String(trackId);
    if (Number.isFinite(albumId) && albumId > 0) card.dataset.albumId = String(albumId);
    if (Number.isFinite(playlistId) && playlistId > 0) card.dataset.playlistId = String(playlistId);
    if (Number.isFinite(artistId) && artistId > 0) card.dataset.artistId = String(artistId);
    card.dataset.title = String(item?.title || "");
    card.dataset.artist = String(item?.artist || "");
    card.dataset.albumTitle = String(item?.albumTitle || "");

    // Blurred background image
    const bgBlur = document.createElement("div");
    bgBlur.className = "download-card__bg";
    card.appendChild(bgBlur);

    // Main content wrapper
    const main = document.createElement("div");
    main.className = "download-card__main";

    // Cover image + hover play overlay
    const coverWrap = document.createElement("div");
    coverWrap.className = "download-card__coverWrap";

    const cover = document.createElement("img");
    cover.className = "download-card__cover";
    cover.alt = "";
    cover.loading = "lazy";
    coverWrap.appendChild(cover);

    const coverFallback = document.createElement("div");
    coverFallback.className = "download-card__coverFallback";
    coverFallback.innerHTML = `<div class="download-card__coverFallbackX" aria-hidden="true"></div>`;
    coverWrap.appendChild(coverFallback);

    const playBtn = document.createElement("button");
    playBtn.className = "download-card__coverPlay";
    playBtn.type = "button";
    playBtn.dataset.action = "play";
    playBtn.dataset.uuid = uuid;
    playBtn.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';
    playBtn.setAttribute("aria-label", "Play");
    coverWrap.appendChild(playBtn);

    main.appendChild(coverWrap);

    // Info section
    const info = document.createElement("div");
    info.className = "download-card__info";

    const title = document.createElement("div");
    title.className = "download-card__title";
    info.appendChild(title);

    const type = document.createElement("div");
    type.className = "download-card__type";
    info.appendChild(type);

    const finishedLine = document.createElement("div");
    finishedLine.className = "download-card__finished";
    finishedLine.innerHTML = `<span data-el="finishedText"></span>`;
    info.appendChild(finishedLine);

    main.appendChild(info);

    // Right side with status/actions
    const right = document.createElement("div");
    right.className = "download-card__right";

    const statusText = document.createElement("span");
    statusText.className = "download-card__status download-card__statusText";

    const playingViz = document.createElement("span");
    playingViz.className = "download-card__playingViz";
    playingViz.innerHTML = "<span></span><span></span><span></span>";

    const statusWrap = document.createElement("span");
    statusWrap.className = "download-card__statusWrap";
    statusWrap.appendChild(statusText);
    statusWrap.appendChild(playingViz);
    right.appendChild(statusWrap);

    const dismissBtn = document.createElement("button");
    dismissBtn.className = "download-card__actionBtn download-card__actionBtn--cancel";
    dismissBtn.type = "button";
    dismissBtn.dataset.action = "dismiss";
    dismissBtn.dataset.uuid = uuid;
    dismissBtn.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
    dismissBtn.title = "Remove";
    right.appendChild(dismissBtn);

    main.appendChild(right);
    card.appendChild(main);

    // Progress bar at bottom (for active downloads)
    const progressBar = document.createElement("div");
    progressBar.className = "download-card__progressBar";
    const progressFill = document.createElement("div");
    progressFill.className = "download-card__progressFill";
    progressBar.appendChild(progressFill);
    card.appendChild(progressBar);

    cardByUuid.set(uuid, {
      el: card,
      bgEl: bgBlur,
      coverWrapEl: coverWrap,
      coverEl: cover,
      coverFallbackEl: coverFallback,
      playBtnEl: playBtn,
      titleEl: title,
      typeEl: type,
      finishedLineEl: finishedLine,
      finishedTextEl: finishedLine.querySelector('[data-el="finishedText"]'),
      statusEl: statusText,
      playingVizEl: playingViz,
      progressBarEl: progressBar,
      progressFillEl: progressFill,
    });

    return card;
  };

  const formatRelativeDate = (ts) => {
    if (!Number.isFinite(ts) || ts <= 0) return "";
    const now = new Date();
    const date = new Date(ts);
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return dayNames[date.getDay()];
    }
    if (diffWeeks === 1) return "Last week";
    if (diffWeeks <= 4) return `${diffWeeks} weeks ago`;
    if (diffMonths === 1) return "1 month ago";
    if (diffMonths < 12) return `${diffMonths} months ago`;
    return "Over a year ago";
  };

  const formatFileSize = (bytes) => {
    const num = Number(bytes);
    if (!Number.isFinite(num) || num <= 0) return "";
    const mb = num / (1024 * 1024);
    if (mb < 1) return `${Math.round(num / 1024)} KB`;
    return `${mb.toFixed(1)} MB`;
  };

  const updateCard = (item, { coverUrl, accent, mediaState, player } = {}) => {
    const uuid = String(item.uuid || "");
    const ref = cardByUuid.get(uuid);
    if (!ref) return;

    const title = String(item.title || item.albumTitle || item.uuid || "Download");
    const progress = Math.min(100, Math.max(0, Number(item.progress) || 0));
    const status = String(item.status || "");
    const done = status === "done";
    const failed = status === "failed";
    const cancelled = status === "cancelled";
    const terminal = done || failed || cancelled;
    const hasLocalTrack = Boolean(mediaState?.hasLocalTrack);
    const kindKey = resolveKindKey(item);
    const treatAsSingleTrack = kindKey === "track" && Number.isFinite(Number(item?.trackId)) && Number(item.trackId) > 0;
    const missingLocal = treatAsSingleTrack && done && !hasLocalTrack;
    const resolvedCoverUrl = missingLocal ? "" : String(coverUrl || "").trim();

    // Keep entity data attributes in sync for context menu
    const trackId = Number(item?.trackId);
    const albumId = Number(item?.albumId);
    const playlistId = Number(item?.playlistId);
    const artistId = Number(item?.artistId);
    if (Number.isFinite(trackId) && trackId > 0) ref.el.dataset.trackId = String(trackId);
    if (Number.isFinite(albumId) && albumId > 0) ref.el.dataset.albumId = String(albumId);
    if (Number.isFinite(playlistId) && playlistId > 0) ref.el.dataset.playlistId = String(playlistId);
    if (Number.isFinite(artistId) && artistId > 0) ref.el.dataset.artistId = String(artistId);
    ref.el.dataset.title = String(item?.title || "");
    ref.el.dataset.artist = String(item?.artist || "");
    ref.el.dataset.albumTitle = String(item?.albumTitle || "");

    ref.titleEl.textContent = title;
    ref.typeEl.textContent = resolveTypeLabel(item);

    // Update finished line for completed downloads
    if (ref.finishedLineEl && ref.finishedTextEl) {
      if (done) {
        const relDate = formatRelativeDate(Number(item?.updatedAt));
        const fileSize = formatFileSize(mediaState?.fileSize || item?.fileSize || item?.size);
        const parts = [`Finished ${relDate}`, fileSize].filter(Boolean);
        ref.finishedTextEl.textContent = parts.join(" • ");
        ref.finishedLineEl.hidden = false;
      } else {
        ref.finishedLineEl.hidden = true;
      }
    }

    if (ref.statusEl) {
      if (done) ref.statusEl.textContent = "";
      else if (failed) ref.statusEl.textContent = "Failed";
      else if (cancelled) ref.statusEl.textContent = "Cancelled";
      else ref.statusEl.textContent = `${Math.round(progress)}%`;
    }

    if (ref.progressFillEl) {
      ref.progressFillEl.style.width = terminal ? "100%" : `${progress}%`;
    }
    if (ref.progressBarEl) {
      ref.progressBarEl.hidden = terminal;
    }

    ref.el.classList.toggle("is-done", done);
    ref.el.classList.toggle("is-unavailable", missingLocal);
    const hasCover = Boolean(resolvedCoverUrl);
    const shouldShowFallback = !hasCover;
    if (ref.coverWrapEl) ref.coverWrapEl.classList.toggle("is-fallback", shouldShowFallback);
    if (ref.coverFallbackEl && shouldShowFallback) {
      const icon = (() => {
        if (missingLocal) return null;
        if (kindKey === "playlist") return "ri-play-list-2-fill";
        if (kindKey === "album") return "ri-album-fill";
        if (kindKey === "artist") return "ri-user-3-fill";
        return "ri-download-2-fill";
      })();
      if (!icon) {
        // Missing file: keep the existing "X" fallback.
        ref.coverFallbackEl.innerHTML = `<div class="download-card__coverFallbackX" aria-hidden="true"></div>`;
      } else {
        ref.coverFallbackEl.innerHTML = `<i class="${icon} download-card__coverFallbackIcon" aria-hidden="true"></i>`;
      }
    }

    const playerTrackId = Number(player?.trackId);
    const thisTrackId = Number(item?.trackId);
    const isCurrent = Number.isFinite(playerTrackId) && Number.isFinite(thisTrackId) && playerTrackId > 0 && playerTrackId === thisTrackId;
    const canPlay = Boolean(player?.canPlay) && done && hasLocalTrack && Number.isFinite(thisTrackId) && thisTrackId > 0;
    const playing = canPlay && isCurrent && Boolean(player?.isPlaying);
    ref.el.classList.toggle("is-playing", playing);
    if (ref.playBtnEl) {
      ref.playBtnEl.hidden = !canPlay;
      ref.playBtnEl.disabled = !canPlay;
      ref.playBtnEl.innerHTML = playing
        ? '<i class="ri-pause-fill" aria-hidden="true"></i>'
        : '<i class="ri-play-fill" aria-hidden="true"></i>';
      ref.playBtnEl.setAttribute("aria-label", playing ? "Pause" : "Play");
    }

    const openTarget = typeof callbacks?.resolveOpenTarget === "function" ? callbacks.resolveOpenTarget(item) : null;
    if (openTarget && typeof openTarget === "object") {
      ref.el.dataset.open = "1";
      ref.el.dataset.openType = String(openTarget.type || "");
      ref.el.dataset.openId = String(openTarget.id || "");
    } else {
      ref.el.dataset.open = "0";
      ref.el.dataset.openType = "";
      ref.el.dataset.openId = "";
    }

    if (resolvedCoverUrl) {
      ref.coverEl.hidden = false;
      if (ref.coverEl.src !== resolvedCoverUrl) ref.coverEl.src = resolvedCoverUrl;
      if (ref.bgEl) ref.bgEl.style.backgroundImage = `url('${resolvedCoverUrl}')`;
      ref.el.dataset.coverKey = toCoverKey(resolvedCoverUrl);
      ensureCoverAccent(resolvedCoverUrl);
    } else {
      ref.coverEl.hidden = true;
      if (ref.bgEl) ref.bgEl.style.backgroundImage = "";
      ref.el.dataset.coverKey = "";
    }

    if (accent) {
      try {
        const prev = String(ref.el.dataset.accentStrong || "");
        if (prev !== String(accent.strong || "")) {
          ref.el.dataset.accentStrong = String(accent.strong || "");
          ref.el.style.setProperty("--card-accent-strong", accent.strong);
          ref.el.style.setProperty("--card-accent-mid", accent.mid);
          ref.el.style.setProperty("--card-accent-weak", accent.weak);
          ref.el.style.setProperty("--download-progress-base", accent.progressBase);
          ref.el.style.setProperty("--download-progress-end", accent.progressEnd);
          ref.el.style.setProperty("--download-progress-shine", accent.progressShine);
        }
      } catch {}
    }
  };

  const render = ({ items, player }) => {
    ensureScaffold();

    const itemsArr = Array.isArray(items) ? items : [];
    allItems = itemsArr;

    const wanted = new Set();
    for (const item of itemsArr) {
      const uuid = String(item?.uuid || "");
      if (!uuid) continue;
      wanted.add(uuid);
      if (!cardByUuid.has(uuid)) {
        buildCard(item);
      }
    }

    // Remove cards not wanted.
    for (const [uuid, ref] of Array.from(cardByUuid.entries())) {
      if (wanted.has(uuid)) continue;
      try {
        ref.el.remove();
      } catch {}
      cardByUuid.delete(uuid);
    }

    // Update cards.
    for (const item of itemsArr) {
      const uuid = String(item?.uuid || "");
      if (!uuid) continue;
      const ref = cardByUuid.get(uuid);
      if (!ref) continue;

      const mediaState =
        typeof callbacks?.resolveMediaState === "function" ? callbacks.resolveMediaState(item) : { hasLocalTrack: false, coverUrl: "" };
      const mediaCoverUrlRaw = String(mediaState?.coverUrl || "").trim();
      const itemCoverUrl = String(item?.cover || "").trim();
      const kindKey = resolveKindKey(item);
      const coverUrl = kindKey === "playlist" ? itemCoverUrl || mediaCoverUrlRaw : mediaCoverUrlRaw || itemCoverUrl;
      const accent = coverUrl ? coverAccentCache.get(coverUrl) : null;

      updateCard(item, { coverUrl, accent, mediaState, player });
    }

    // Refresh the grid with filtered items
    refreshCards(player);
  };

  return { render, ensureScaffold };
}
