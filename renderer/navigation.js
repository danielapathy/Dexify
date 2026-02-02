import { extractAverageColorFromImageUrl, formatDuration, formatFansCountText, formatRecordTypeLabel, normalizeRecordType } from "./utils.js";
import { getLocalLibrary } from "./localLibrary.js";
import { buildDeezerImageUrl, cleanTargetToPage, isFlowSectionTitle, parseTarget } from "./deezerImages.js";
import { renderEntitySkeleton, renderPageSkeleton, renderSearchResultsSkeleton } from "./skeletons.js";
import { wireSearchPopover } from "./searchPopover.js";
import { registerTrackList, resolveTrackListFromRow } from "./contextMenu.js";

export function wireNavigation() {
  const lib = getLocalLibrary();
  const backBtn = document.querySelector('[data-nav="back"]');
  const forwardBtn = document.querySelector('[data-nav="forward"]');
  const homeBtn = document.querySelector('[data-nav="home"]');
  const searchInput = document.getElementById("topSearchInput");
  const searchClearBtn = document.getElementById("topSearchClear");
  const searchEl = document.querySelector("[data-search]");
  const searchSubmitBtn = document.querySelector('[data-search-action="submit"]');
  const searchPopoverEl = document.getElementById("searchPopover");
  const searchPopoverList = document.getElementById("searchPopoverList");
  const scrollEl = document.querySelector(".main__scroll");

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
    !searchClearBtn ||
    !searchEl ||
    !searchSubmitBtn ||
    !searchPopoverEl ||
    !searchPopoverList ||
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

  const getRouteKey = (r) => {
    const name = String(r?.name || "home");
    if (name === "entity") return `entity:${String(r?.entityType || "")}:${String(r?.id || "")}`;
    if (name === "search") return `search:${String(r?.q || "")}:${String(r?.filter || "")}`;
    if (name === "page") return `page:${String(r?.page || "")}`;
    if (name === "settings") return "settings";
    if (name === "liked") return "liked";
    if (name === "downloads") return "downloads";
    return "home";
  };

  const downloadBadges = (() => {
    const inFlightByTrackId = new Map(); // trackId -> { status, progress, uuid, updatedAt }

    const parseUuid = (uuid) => {
      const s = String(uuid || "").trim();
      if (!s) return null;
      let m = s.match(/^(?:track|dl)_(\d+)_(\d+)/);
      if (!m) m = s.match(/(?:^|_)track_(\d+)_(\d+)/);
      if (!m) return null;
      return { trackId: Number(m[1]), bitrate: Number(m[2]) };
    };

    const rememberMeta = ({ trackId, title, artist, cover }) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return;
      const map = window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById : {};
      map[String(id)] = { title: String(title || ""), artist: String(artist || ""), cover: String(cover || ""), at: Date.now() };
      window.__downloadMetaById = map;
    };

    const getDownloadedState = () => {
      const state = lib.load?.() || {};
      return state.downloadedTracks && typeof state.downloadedTracks === "object" ? state.downloadedTracks : {};
    };

    const isTrackDownloaded = (trackId, downloadedTracks) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return false;
      const downloaded = downloadedTracks || getDownloadedState();
      const entry = downloaded[String(id)] && typeof downloaded[String(id)] === "object" ? downloaded[String(id)] : null;
      const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
      return Boolean(fileUrl);
    };

    const looksLikeDownloading = (trackId, downloadedTracks) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return false;
      if (inFlightByTrackId.has(id)) return true;

      const downloaded = downloadedTracks || getDownloadedState();
      const entry = downloaded[String(id)] && typeof downloaded[String(id)] === "object" ? downloaded[String(id)] : null;
      const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
      const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
      const at = Number(entry?.download?.at) || 0;
      if (fileUrl) return false;
      if (!uuid || !at) return false;
      return Date.now() - at < 10 * 60 * 1000;
    };

    const setIcon = (badge, iconClass) => {
      const el = badge && badge.nodeType === 1 ? badge : null;
      if (!el) return;
      const i = el.querySelector("i");
      if (i) {
        i.className = String(iconClass || "");
        i.setAttribute("aria-hidden", "true");
      } else {
        el.innerHTML = `<i class="${String(iconClass || "")}" aria-hidden="true"></i>`;
      }
    };

    const applyToRow = (row, downloadedTracks = null) => {
      const r = row && row.nodeType === 1 ? row : null;
      if (!r) return;
      const badge = r.querySelector(".entity-track__download");
      if (!badge) return;
      const trackId = Number(r.dataset.trackId);
      if (!Number.isFinite(trackId) || trackId <= 0) return;

      const downloading = looksLikeDownloading(trackId, downloadedTracks);
      const downloaded = !downloading && isTrackDownloaded(trackId, downloadedTracks);

      badge.classList.toggle("is-downloading", downloading);
      badge.classList.toggle("is-downloaded", downloaded);

      if (downloading) setIcon(badge, "ri-loader-4-line");
      else if (downloaded) setIcon(badge, "ri-download-2-fill");
      else setIcon(badge, "ri-download-2-line");
    };

    const applyToTrackId = (trackId) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return;
      const rows = Array.from(entityView.querySelectorAll(`.entity-tracks--dl .entity-track[data-track-id="${id}"]`));
      const downloaded = getDownloadedState();
      for (const row of rows) applyToRow(row, downloaded);
    };

    const applyAll = () => {
      const rows = Array.from(entityView.querySelectorAll(".entity-tracks--dl .entity-track[data-track-id]"));
      const downloaded = getDownloadedState();
      for (const row of rows) applyToRow(row, downloaded);
    };

    const schedule = (() => {
      let raf = 0;
      let forceAll = false;
      const pending = new Set();
      return (trackId = null) => {
        const id = Number(trackId);
        if (Number.isFinite(id) && id > 0) pending.add(id);
        else forceAll = true;

        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (forceAll) {
            forceAll = false;
            pending.clear();
            applyAll();
            return;
          }
          const ids = Array.from(pending);
          pending.clear();
          for (const tid of ids) applyToTrackId(tid);
        });
      };
    })();

    window.addEventListener("local-library:changed", () => schedule());
    window.addEventListener("nav:viewChanged", () => schedule());

    if (window.dl?.onEvent) {
      window.dl.onEvent((payload) => {
        const event = String(payload?.event || "");
        const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
        const uuid = String(data?.uuid || "").trim();
        const fromData = Number(data?.id);
        const parsed = uuid ? parseUuid(uuid) : null;
        const trackId = Number.isFinite(fromData) && fromData > 0 ? fromData : parsed?.trackId ?? null;
        if (!Number.isFinite(trackId) || trackId <= 0) return;

        if (event === "downloadRequested") {
          inFlightByTrackId.set(trackId, { status: "queued", progress: 0, uuid, updatedAt: Date.now() });
          schedule(trackId);
          return;
        }

        if (event === "updateQueue") {
          const progress = typeof data?.progress === "number" ? data.progress : null;
          inFlightByTrackId.set(trackId, { status: "downloading", progress, uuid, updatedAt: Date.now() });
          schedule(trackId);
          return;
        }

        if (event === "downloadFinished" || event === "finishDownload" || event === "downloadFailed") {
          inFlightByTrackId.delete(trackId);
          schedule(trackId);
        }
      });
    }

    // Initial pass (in case the first view renders before any events fire).
    schedule();

    return { applyToRow, rememberMeta };
  })();

  // Cache entity/page/liked DOM so navigation can crossfade without clearing/rebuilding.
  const ENTITY_PAGE_CACHE_MAX = 12;
  const entityPageCache = new Map(); // key -> { key, root, tracks, accent, lastUsedAt, renderedAt }
  let activeEntityEntry = null;
  const entityLeaveTimers = new WeakMap(); // root -> timeoutId

  const evictEntityCacheIfNeeded = () => {
    if (entityPageCache.size <= ENTITY_PAGE_CACHE_MAX) return;
    const entries = Array.from(entityPageCache.values());
    entries.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    for (const e of entries) {
      if (entityPageCache.size <= ENTITY_PAGE_CACHE_MAX) break;
      if (activeEntityEntry && e.key === activeEntityEntry.key) continue;
      try {
        e.root?.remove?.();
      } catch {}
      entityPageCache.delete(e.key);
    }
  };

  const mountEntityEntry = (entry) => {
    if (!entry?.root) return;

    const prev = activeEntityEntry?.root && activeEntityEntry.root.isConnected ? activeEntityEntry.root : null;
    const next = entry.root;
    if (prev === next) return;

    // If we’re reactivating a page that was mid-leave, cancel the pending removal and restore interactivity.
    const nextLeaveTimer = entityLeaveTimers.get(next);
    if (nextLeaveTimer) {
      clearTimeout(nextLeaveTimer);
      entityLeaveTimers.delete(next);
    }
    next.classList.remove("is-leaving");
    next.style.removeProperty("pointerEvents");

    // Apply per-page accent (stored from the cover average color).
    if (entry.accent) entityView.style.setProperty("--entity-accent", entry.accent);
    else entityView.style.removeProperty("--entity-accent");

    next.classList.add("entity-page");
    next.classList.add("is-enter");
    next.style.removeProperty("position");
    next.style.removeProperty("inset");
    next.style.pointerEvents = "auto";

    if (!next.isConnected) entityView.appendChild(next);

    // Animate old page out without affecting layout height.
    if (prev) {
      const prevLeaveTimer = entityLeaveTimers.get(prev);
      if (prevLeaveTimer) {
        clearTimeout(prevLeaveTimer);
        entityLeaveTimers.delete(prev);
      }
      prev.classList.add("is-leaving");
      prev.classList.remove("is-active");
      prev.style.position = "absolute";
      prev.style.inset = "0";
      prev.style.pointerEvents = "none";
      const t = setTimeout(() => {
        try {
          // If this page became active again, don’t tear it down.
          if (activeEntityEntry?.root === prev) return;
          prev.classList.remove("is-leaving");
          prev.classList.remove("is-enter");
          prev.style.removeProperty("position");
          prev.style.removeProperty("inset");
          prev.style.removeProperty("pointerEvents");
          prev.remove();
        } catch {}
      }, 190);
      entityLeaveTimers.set(prev, t);
    }

    requestAnimationFrame(() => {
      next.classList.remove("is-enter");
      next.classList.add("is-active");
    });

    entry.lastUsedAt = Date.now();
    activeEntityEntry = entry;
    evictEntityCacheIfNeeded();
  };

  const entityDownloadAction = (() => {
    const getDownloadedTracks = () => {
      const st = lib.load?.() || {};
      return st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
    };

    const isTrackDownloaded = (trackId, downloadedTracks) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return false;
      const entry =
        downloadedTracks[String(id)] && typeof downloadedTracks[String(id)] === "object" ? downloadedTracks[String(id)] : null;
      const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
      return Boolean(fileUrl);
    };

    const computeStats = (trackIds, downloadedTracks) => {
      const ids = Array.isArray(trackIds) ? trackIds : [];
      const total = ids.length;
      if (total === 0) return { total: 0, downloaded: 0, remaining: 0 };
      let downloaded = 0;
      for (const tid of ids) {
        if (isTrackDownloaded(tid, downloadedTracks)) downloaded++;
      }
      return { total, downloaded, remaining: Math.max(0, total - downloaded) };
    };

    const applyToEntry = (entry) => {
      const e = entry && typeof entry === "object" ? entry : null;
      const st = e?.downloadAction && typeof e.downloadAction === "object" ? e.downloadAction : null;
      if (!e || !st) return;

      const btn = st.btn && st.btn.nodeType === 1 ? st.btn : null;
      if (!btn) return;

      const label = String(st.label || "").trim();
      const trackIds = Array.isArray(st.trackIds) ? st.trackIds : [];
      const downloadedTracks = getDownloadedTracks();
      const stats = computeStats(trackIds, downloadedTracks);
      const disabled = stats.total > 0 && stats.remaining === 0;

      btn.classList.toggle("is-disabled", disabled);
      btn.setAttribute("aria-disabled", disabled ? "true" : "false");
      btn.dataset.downloadRemaining = String(stats.remaining);
      btn.dataset.downloadTotal = String(stats.total);

      const suffix =
        stats.total === 0
          ? ""
          : disabled
            ? "Downloaded"
            : `${stats.remaining} song${stats.remaining === 1 ? "" : "s"} left`;
      const tooltip = suffix ? `${label} • ${suffix}` : label;
      try {
        btn.dataset.tooltip = tooltip;
        btn.setAttribute("aria-label", tooltip);
      } catch {}

      const icon = btn.querySelector("i");
      if (icon) icon.className = disabled ? "ri-download-2-fill" : "ri-download-2-line";
    };

    const applyActive = () => applyToEntry(activeEntityEntry);

    const schedule = (() => {
      let raf = 0;
      return () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          applyActive();
        });
      };
    })();

    window.addEventListener("local-library:changed", () => schedule());
    window.addEventListener("nav:viewChanged", () => schedule());

    schedule();

    const bind = (entry, btn, { label, trackIds } = {}) => {
      const e = entry && typeof entry === "object" ? entry : null;
      const b = btn && btn.nodeType === 1 ? btn : null;
      if (!e || !b) return;

      e.downloadAction = {
        btn: b,
        label: String(label || "").trim(),
        trackIds: Array.isArray(trackIds) ? trackIds : [],
      };
      applyToEntry(e);
    };

    return { bind, schedule };
  })();

  const views = {
    home: homeView,
    search: searchView,
    entity: entityWrap,
    settings: settingsView,
  };

  const viewHideTimers = new WeakMap();
  let currentView = "home";

  const cancelPendingHide = (el) => {
    const t = viewHideTimers.get(el);
    if (t) {
      clearTimeout(t);
      viewHideTimers.delete(el);
    }
  };

  const liftedViewState = new WeakMap(); // el -> { parent, nextSibling, ghostEl }
  const liftedViews = new Set(); // Elements currently moved into the transition layer.
  let viewTransitionLayer = null;

  const ensureViewTransitionLayer = () => {
    if (viewTransitionLayer && viewTransitionLayer.isConnected) return viewTransitionLayer;
    viewTransitionLayer = document.createElement("div");
    viewTransitionLayer.className = "view-transition-layer";
    viewTransitionLayer.hidden = true;
    scrollEl.appendChild(viewTransitionLayer);
    return viewTransitionLayer;
  };

  const liftViewForScrollReset = (el, { fromScrollTop, toScrollTop }) => {
    if (!el) return false;
    if (!el.isConnected) return false;

    const layer = ensureViewTransitionLayer();
    if (!layer) return false;

    // Position the overlay in the *target* viewport so it stays visible after we set scrollTop.
    layer.style.top = `${Math.max(0, Number(toScrollTop) || 0)}px`;
    layer.hidden = false;

    const ghost = document.createElement("div");
    ghost.className = "view-transition-layer__ghost";
    const delta = Number(fromScrollTop) - Number(toScrollTop);
    ghost.style.transform = `translateY(${-delta}px)`;
    layer.appendChild(ghost);

    liftedViewState.set(el, { parent: el.parentNode, nextSibling: el.nextSibling, ghostEl: ghost });
    liftedViews.add(el);
    ghost.appendChild(el);
    el.hidden = false;
    el.style.pointerEvents = "none";
    return true;
  };

  const restoreLiftedView = (el) => {
    const st = liftedViewState.get(el);
    if (!st) return;
    liftedViewState.delete(el);
    liftedViews.delete(el);

    try {
      el.style.removeProperty("pointerEvents");
    } catch {}

    try {
      const parent = st.parent;
      if (parent) parent.insertBefore(el, st.nextSibling);
    } catch {}

    try {
      st.ghostEl?.remove?.();
    } catch {}

    if (viewTransitionLayer && viewTransitionLayer.isConnected) {
      if (viewTransitionLayer.childElementCount === 0) {
        viewTransitionLayer.hidden = true;
        viewTransitionLayer.style.removeProperty("top");
      }
    }
  };

  const restoreAllLiftedViews = () => {
    if (liftedViews.size === 0) return;
    // Copy to avoid mutation during iteration.
    for (const el of Array.from(liftedViews)) restoreLiftedView(el);
  };

  const showView = (name, { scrollTop } = {}) => {
    const nextName = String(name || "home");
    const nextEl = views[nextName];
    if (!nextEl) return;
    const emitViewChanged = () => {
      try {
        window.dispatchEvent(new CustomEvent("nav:viewChanged", { detail: { name: nextName } }));
      } catch {}
    };
    // Never leave any view stuck inside the transition layer.
    restoreAllLiftedViews();
    if (currentView === nextName) {
      const wantsScroll = Number.isFinite(Number(scrollTop));
      const toScrollTop = wantsScroll ? Math.max(0, Number(scrollTop)) : null;
      if (wantsScroll && scrollEl) scrollEl.scrollTop = toScrollTop;
      cancelPendingHide(nextEl);
      nextEl.hidden = false;
      nextEl.classList.add("is-view-active");
      nextEl.classList.remove("is-view-hidden");
      emitViewChanged();
      return;
    }

    const prevEl = views[currentView];
    currentView = nextName;

    // If a view was previously "lifted" into the transition layer and then we navigate back to it
    // quickly, put it back before showing it again.
    restoreLiftedView(nextEl);
    if (prevEl) restoreLiftedView(prevEl);

    const wantsScroll = Number.isFinite(Number(scrollTop));
    const fromScrollTop = scrollEl ? Number(scrollEl.scrollTop) : 0;
    const toScrollTop = wantsScroll ? Math.max(0, Number(scrollTop)) : fromScrollTop;

    // Ensure all views have a consistent baseline class.
    for (const el of Object.values(views)) {
      if (!el) continue;
      el.classList.add("view");
    }

    // Fade out previous view (hide after transition).
    if (prevEl) {
      cancelPendingHide(prevEl);
      if (wantsScroll && scrollEl && Math.abs(fromScrollTop - toScrollTop) > 2) {
        liftViewForScrollReset(prevEl, { fromScrollTop, toScrollTop });
      }
      prevEl.classList.add("is-view-hidden");
      prevEl.classList.remove("is-view-active");
      const hideTimer = setTimeout(() => {
        restoreLiftedView(prevEl);
        prevEl.hidden = true;
        viewHideTimers.delete(prevEl);
      }, 170);
      viewHideTimers.set(prevEl, hideTimer);
    }

    if (wantsScroll && scrollEl) {
      scrollEl.scrollTop = toScrollTop;
    }

    // Fade in next view.
    cancelPendingHide(nextEl);
    nextEl.hidden = false;
    nextEl.style.pointerEvents = "auto";
    nextEl.classList.add("is-view-hidden");
    nextEl.classList.remove("is-view-active");
    requestAnimationFrame(() => {
      nextEl.classList.add("is-view-active");
      nextEl.classList.remove("is-view-hidden");
      emitViewChanged();
    });
  };

  // Initialize view classes so the first transition doesn't flash.
  for (const [name, el] of Object.entries(views)) {
    if (!el) continue;
    el.classList.add("view");
    if (el.hidden) el.classList.add("is-view-hidden");
    else {
      currentView = name;
      el.classList.add("is-view-active");
      el.classList.remove("is-view-hidden");
    }
  }

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
    registerTrackList(list, tracks, { pageContext: "search" });

    let idx = 0;
    for (const t of tracks) {
      const trackId = Number(t?.id || t?.SNG_ID);
      const row = document.createElement("div");
      row.className = "search-track";
      row.dataset.trackIndex = String(idx++);
      if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
      const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
      if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
      const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
      if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);

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
      const play = document.createElement("span");
      play.className = "search-track__hoverPlay";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill icon" aria-hidden="true"></i>';
      cover.appendChild(play);

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
      cover.className = "big-card__cover";
      if (kind === "artist") cover.classList.add("big-card__cover--circle");

      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      if (item?.image) img.src = item.image;
      cover.appendChild(img);

      if (kind !== "artist") {
        const play = document.createElement("span");
        play.className = "hover-play hover-play--cover";
        play.setAttribute("aria-hidden", "true");
        play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
        cover.appendChild(play);
      }

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
	      const typeLabel = formatRecordTypeLabel(item?.record_type || item?.recordType, { fallback: "Album" });
	      const artist = item?.artist?.name || "";
	      return {
	        title: item?.title,
	        subtitle: artist ? `${typeLabel} • ${artist}` : typeLabel,
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
  const renderSearch = async ({ q, filter, scrollTop }) => {
    const query = String(q || "").trim();
    if (!query) {
      showView("home", { scrollTop: 0 });
      return;
    }
    if (query.length < 2) {
      showView("home", { scrollTop: 0 });
      return;
    }

    showView("search", { scrollTop });
    searchInput.value = query;
    queryLabel.textContent = `Results for “${query}”`;
    setSearchFilterActive(filter);

    if (!window.dz || typeof window.dz.search !== "function") {
      renderSearchSkeleton("Search is available in Electron only (missing window.dz).");
      return;
    }

    const thisReq = ++searchReq;
    renderSearchResultsSkeleton(searchResults, { kind: String(filter || "all"), metricsEl: searchInput });

    try {
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
        searchResults.innerHTML = "";

        const artistItems = artists.items.map((x) => normalizeSearchItem("artist", x)).filter(Boolean).slice(0, 4);
        if (artistItems.length > 0) renderSection("Artists", artistItems, { kind: "artist" });

        let any = false;
        const trackItems = Array.isArray(tracks.items) ? tracks.items : [];
        if (trackItems.length > 0) {
          any = true;
          renderTracksList("Songs", trackItems);
        }

        const sections = [
          { title: "Albums", kind: "album", items: albums.items },
          { title: "Playlists", kind: "playlist", items: playlists.items },
        ];
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
      searchResults.innerHTML = "";

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

  const renderEntityInto = async (
    container,
    { entityType, id, title: routeTitle, subtitle: routeSubtitle, cover: routeCover },
    entry,
  ) => {
    const type = String(entityType || "").trim();
    const entityId = String(id || "").trim();
    if (!type || !entityId) return true;

    if (!window.dz || typeof window.dz.getTracklist !== "function") {
      container.innerHTML = '<div class="search-empty">Entity views are available in Electron only (missing window.dz).</div>';
      return true;
    }

    const thisReq = (entry.renderReq = Number(entry?.renderReq || 0) + 1);
    if (activeEntityEntry?.key === entry?.key) entityView.style.removeProperty("--entity-accent");
    renderEntitySkeleton(container, { rows: 12, withActions: true });

    try {
      const res = await window.dz.getTracklist({ type, id: entityId });
      if (entry?.renderReq !== thisReq) return false;
      if (!res?.ok || !res?.data) {
        container.innerHTML = `<div class="search-empty">Failed to load (${String(res?.error || "unknown")}).</div>`;
        return true;
      }

      const data = res.data;
      const fallbackCover =
        type === "artist"
          ? data?.picture_medium || data?.picture || ""
          : data?.cover_medium || data?.cover || data?.picture_medium || "";

      const cover =
        String(routeCover || "").trim() ||
        String(fallbackCover || "").trim() ||
        (type === "smarttracklist"
          ? String(data?.tracks?.[0]?.album?.cover_medium || data?.tracks?.[0]?.album?.cover_small || "")
          : "");

	      const title =
	        String(routeTitle || "").trim() ||
	        (type === "artist" ? data?.name || "Artist" : data?.title || "Untitled");
	      const subtitle =
	        type === "album"
	          ? (() => {
	              const artistName = String(data?.artist?.name || "").trim();
	              const label = formatRecordTypeLabel(data?.record_type || data?.recordType, { fallback: "Album" });
	              return artistName ? `${label} • ${artistName}` : label;
	            })()
	          : type === "playlist"
	            ? `Playlist`
	            : type === "smarttracklist"
	              ? String(routeSubtitle || "").trim() || "Discover"
	              : `Artist`;

      const tracks =
        type === "artist"
          ? Array.isArray(data?.topTracks)
            ? data.topTracks
            : []
          : Array.isArray(data?.tracks)
            ? data.tracks
            : [];

      // Some Deezer payloads omit per-track album cover URLs inside album pages.
      // Backfill them from the entity header cover so recents/sidebar always has artwork.
      const coverStr = String(cover || "").trim();
      const entityAlbumId = type === "album" ? Number(entityId) : NaN;
      const tracksWithCover =
        type === "album" && coverStr
          ? tracks.map((t) => {
              const obj = t && typeof t === "object" ? t : null;
              if (!obj) return obj;
              const alb = obj.album && typeof obj.album === "object" ? obj.album : {};
              const nextAlb = { ...alb };
              if (!nextAlb.cover_small) nextAlb.cover_small = coverStr;
              if (!nextAlb.cover_medium) nextAlb.cover_medium = coverStr;
              if (!nextAlb.cover) nextAlb.cover = coverStr;
              if ((!nextAlb.id || Number(nextAlb.id) <= 0) && Number.isFinite(entityAlbumId) && entityAlbumId > 0) nextAlb.id = entityAlbumId;
              return { ...obj, album: nextAlb };
            })
          : tracks;

      if (entry) entry.tracks = tracksWithCover;

      container.innerHTML = "";
      if (activeEntityEntry?.key === entry?.key) entityView.style.removeProperty("--entity-accent");

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

	      const buildActionBtn = ({ icon, tooltip, primary, onClick }) => {
	        const btn = document.createElement("button");
	        btn.type = "button";
	        btn.className = `entity-action-btn${primary ? " is-primary" : ""}`;
	        btn.setAttribute("aria-label", tooltip);
	        btn.dataset.tooltip = tooltip;
	        btn.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
	        if (typeof onClick === "function") {
	          btn.addEventListener("click", (event) => {
	            event.preventDefault();
	            if (btn.getAttribute("aria-disabled") === "true" || btn.classList.contains("is-disabled")) return;
	            onClick();
	          });
	        }
	        return btn;
	      };

      if (type === "album" || type === "playlist" || type === "smarttracklist") {
        const actions = document.createElement("div");
        actions.className = "entity-actions";

        actions.appendChild(
          buildActionBtn({
            icon: "ri-play-fill",
            tooltip: "Play",
            primary: true,
            onClick: async () => {
              if (!window.__player) return;
              const q = Array.isArray(tracksWithCover) ? tracksWithCover : [];
              if (q.length === 0) return;
              await window.__player.setQueueAndPlay(q, 0);
            },
          }),
        );

        if (type === "album" || type === "playlist") {
          const entityIdNum = Number(entityId);

          const getIsSaved = () => {
            if (!Number.isFinite(entityIdNum) || entityIdNum <= 0) return false;
            if (type === "album") return Boolean(lib.isAlbumSaved?.(entityIdNum));
            if (type === "playlist") return Boolean(lib.isPlaylistSaved?.(entityIdNum));
            return false;
          };

	          const buildSavePayload = () => {
	            const base = { id: entityIdNum, title: String(title || "") };
	            if (type === "album") {
	              const artistObj = data?.artist && typeof data.artist === "object" ? data.artist : { name: String(data?.artist?.name || "") };
	              return {
	                ...base,
	                artist: artistObj,
	                record_type: String(data?.record_type || data?.recordType || "").trim() || undefined,
	                cover_medium: String(cover || data?.cover_medium || data?.cover || ""),
	                cover: String(cover || data?.cover || ""),
	              };
	            }
	            const creatorObj = data?.creator && typeof data.creator === "object" ? data.creator : { name: String(data?.creator?.name || "") };
	            return { ...base, creator: creatorObj, picture_medium: String(cover || data?.picture_medium || data?.picture || ""), picture: String(cover || data?.picture || "") };
	          };

          const applySaveButtonUi = (btn) => {
            const saved = getIsSaved();
            const icon = btn?.querySelector?.("i");
            if (icon) {
              icon.classList.toggle("ri-add-line", !saved);
              icon.classList.toggle("ri-check-line", saved);
            }
            const tooltip = saved ? "Remove from Your Library" : "Save to Your Library";
            try {
              btn.dataset.tooltip = tooltip;
              btn.setAttribute("aria-label", tooltip);
            } catch {}
          };

          const saveBtn = buildActionBtn({
            icon: getIsSaved() ? "ri-check-line" : "ri-add-line",
            tooltip: getIsSaved() ? "Remove from Your Library" : "Save to Your Library",
            onClick: () => {
              if (!Number.isFinite(entityIdNum) || entityIdNum <= 0) return;
              const saved = getIsSaved();
              try {
                if (saved) {
                  if (type === "album") lib.removeSavedAlbum?.(entityIdNum);
                  else lib.removeSavedPlaylist?.(entityIdNum);
                } else {
                  const payload = buildSavePayload();
                  if (type === "album") lib.addSavedAlbum?.(payload);
                  else lib.addSavedPlaylist?.(payload);
                }
              } catch {}
              applySaveButtonUi(saveBtn);
            },
          });
          actions.appendChild(saveBtn);

		          const label =
		            type === "playlist"
		              ? "Download playlist"
		              : (() => {
		                  const rt = normalizeRecordType(data?.record_type || data?.recordType);
		                  if (rt === "single") return "Download single";
		                  if (rt === "ep") return "Download EP";
		                  if (rt === "compilation") return "Download compilation";
		                  return "Download album";
		                })();

	          const downloadTrackIds = (() => {
	            const ids = new Set();
	            for (const t of Array.isArray(tracksWithCover) ? tracksWithCover : []) {
	              const tid = Number(t?.id || t?.SNG_ID);
	              if (Number.isFinite(tid) && tid > 0) ids.add(tid);
	            }
	            return Array.from(ids);
	          })();

	          const downloadBtn = buildActionBtn({
	            icon: "ri-download-2-line",
	            tooltip: label,
	            onClick: () => {
	              if (!window.dl?.downloadUrl) return;

	              // Guard against re-triggering when everything is already downloaded.
	              try {
	                const st = lib.load?.() || {};
	                const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
	                let have = 0;
	                for (const tid of downloadTrackIds) {
	                  const entry =
	                    downloaded[String(tid)] && typeof downloaded[String(tid)] === "object" ? downloaded[String(tid)] : null;
	                  const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
	                  if (fileUrl) have++;
	                }
	                if (downloadTrackIds.length > 0 && downloadTrackIds.length - have <= 0) return;
	              } catch {}

	              try {
	                const payload = buildSavePayload();
	                if (type === "album") lib.markAlbumDownloaded?.(payload);
	                else lib.markPlaylistDownloaded?.(payload);
	                applySaveButtonUi(saveBtn);
	              } catch {}
	              const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";
	              void window.dl.downloadUrl({ url: `https://www.deezer.com/${type}/${entityId}`, quality });
	            },
	          });
	          downloadBtn.dataset.action = "entity-download";
	          actions.appendChild(downloadBtn);
	          try {
	            entityDownloadAction.bind(entry, downloadBtn, { label, trackIds: downloadTrackIds });
	          } catch {}
	        }
	        meta.appendChild(actions);
	      } else if (type === "artist") {
        const actions = document.createElement("div");
        actions.className = "entity-actions";

        actions.appendChild(
          buildActionBtn({
            icon: "ri-play-fill",
            tooltip: "Play top tracks",
            primary: true,
            onClick: async () => {
              if (!window.__player) return;
              const q = Array.isArray(tracksWithCover) ? tracksWithCover : [];
              if (q.length === 0) return;
              await window.__player.setQueueAndPlay(q, 0);
            },
          }),
        );

        actions.appendChild(
          buildActionBtn({
            icon: "ri-download-cloud-2-line",
            tooltip: "Download all artist albums",
            onClick: () => {
              if (!window.dl?.downloadUrl) return;
              const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";
              void window.dl.downloadUrl({ url: `https://www.deezer.com/artist/${entityId}`, quality });
            },
          }),
        );

        meta.appendChild(actions);
      }

      header.appendChild(coverEl);
      header.appendChild(meta);
      container.appendChild(header);

      if (cover) {
        extractAverageColorFromImageUrl(cover)
          .then((rgb) => {
            if (!rgb) return;
            const accent = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.72)`;
            if (entry) entry.accent = accent;
            if (activeEntityEntry?.key === entry?.key) entityView.style.setProperty("--entity-accent", accent);
          })
          .catch(() => {});
      }

      const showCovers = type !== "album";
      const showDownloadStatus = type === "album" || type === "playlist";
      const list = document.createElement("div");
      list.className = `entity-tracks${showCovers ? " entity-tracks--with-covers" : ""}${showDownloadStatus ? " entity-tracks--dl" : ""}`;
      registerTrackList(list, tracksWithCover, { pageContext: type });

      const rows = tracksWithCover.slice(0, 200);
      if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "No tracks to display.";
        container.appendChild(empty);
        return true;
      }

      let index = 1;
      for (const t of rows) {
        const row = document.createElement("div");
        row.className = "entity-track";
        row.dataset.trackIndex = String(index - 1);
        const trackId = Number(t?.id || t?.SNG_ID);
        if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
        const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
        if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
        const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
        if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);
        if (!row.dataset.artistId && type === "artist") {
          const fallbackArtistId = Number(entityId);
          if (Number.isFinite(fallbackArtistId) && fallbackArtistId > 0) row.dataset.artistId = String(fallbackArtistId);
        }
        if (!row.dataset.albumId && type === "album") {
          const fallbackAlbumId = Number(entityId);
          if (Number.isFinite(fallbackAlbumId) && fallbackAlbumId > 0) row.dataset.albumId = String(fallbackAlbumId);
        }

        const coverUrl =
          String(
            t?.album?.cover_small ||
              t?.album?.cover_medium ||
              t?.album?.cover ||
              (typeof t?.ALB_PICTURE === "string" && /^[a-f0-9]{32}$/i.test(t.ALB_PICTURE)
                ? `https://cdn-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/100x100-000000-80-0-0.jpg`
                : "") ||
              "",
          ) || "";

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

        if (showCovers) {
          const coverWrap = document.createElement("div");
          coverWrap.className = "entity-track__cover";
          const img3 = document.createElement("img");
          img3.alt = "";
          img3.loading = "lazy";
          if (coverUrl) img3.src = coverUrl;
          coverWrap.appendChild(img3);

          row.appendChild(idx);
          row.appendChild(coverWrap);
        } else {
          row.appendChild(idx);
        }

        const main = document.createElement("div");
        main.className = "entity-track__main";
        const titleText = String(t?.title || t?.SNG_TITLE || "");
        const artistText = String(t?.artist?.name || t?.ART_NAME || "");
        const tt = document.createElement("div");
        tt.className = "entity-track__title";
        tt.textContent = titleText;
        const ta = document.createElement("div");
        ta.className = "entity-track__artist";
        ta.textContent = artistText;
        main.appendChild(tt);
        main.appendChild(ta);
        try {
          downloadBadges.rememberMeta({ trackId, title: titleText, artist: artistText, cover: coverUrl });
        } catch {}

        const dur = document.createElement("div");
        dur.className = "entity-track__duration";
        dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

        row.appendChild(main);
        const like = document.createElement("button");
        like.type = "button";
        like.className = "entity-track__like";
        like.setAttribute("aria-label", "Like");
        like.innerHTML = `<i class="${lib.isTrackSaved(trackId) ? "ri-heart-fill" : "ri-heart-line"}" aria-hidden="true"></i>`;
        row.appendChild(like);
        if (showDownloadStatus) {
          const dl = document.createElement("span");
          dl.className = "entity-track__download";
          dl.setAttribute("aria-hidden", "true");
          dl.innerHTML = '<i class="ri-download-2-line" aria-hidden="true"></i>';
          row.appendChild(dl);
        }
        row.appendChild(dur);
        if (showDownloadStatus) {
          try {
            downloadBadges.applyToRow(row);
          } catch {}
        }
        list.appendChild(row);
      }

      container.appendChild(list);

      if (type === "artist") {
        const albums = Array.isArray(data?.albums) ? data.albums : [];
        const take = albums.slice(0, 18).filter((a) => a && typeof a === "object" && a.id);
        if (take.length > 0) {
          const section = document.createElement("section");
          section.className = "made-for";

          const header2 = document.createElement("div");
          header2.className = "made-for__header";
          const titles2 = document.createElement("div");
          titles2.className = "made-for__titles";
          const h2 = document.createElement("h2");
          h2.className = "h2 h2--small";
          h2.textContent = "Albums";
          titles2.appendChild(h2);
          header2.appendChild(titles2);
          section.appendChild(header2);

          const carousel = document.createElement("div");
          carousel.className = "carousel";
          carousel.setAttribute("role", "list");

          for (const a of take) {
            const card = document.createElement("a");
            card.className = "big-card";
            card.href = "#";
            card.setAttribute("role", "listitem");
            card.dataset.target = `/album/${String(a.id)}`;

            const cover2 = document.createElement("div");
            cover2.className = "big-card__cover";
            const img2 = document.createElement("img");
            img2.alt = "";
            img2.loading = "lazy";
            const src2 = String(a?.cover_medium || a?.cover || "");
            if (src2) img2.src = src2;
            cover2.appendChild(img2);

            const t2 = document.createElement("div");
            t2.className = "big-card__title";
            t2.textContent = String(a?.title || "Album");
	            const st2 = document.createElement("div");
	            st2.className = "big-card__subtitle";
	            st2.textContent = formatRecordTypeLabel(a?.record_type || a?.recordType, { fallback: "Album" });

            card.appendChild(cover2);
            card.appendChild(t2);
            card.appendChild(st2);
            carousel.appendChild(card);
          }

          section.appendChild(carousel);
          container.appendChild(section);
        }
      }
      return true;
    } catch (e) {
      if (entry?.renderReq !== thisReq) return false;
      container.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
      return true;
    }
  };

  const renderLikedInto = async (container, entry) => {
    container.innerHTML = '<div class="search-empty">Loading Liked Songs…</div>';
    if (entry) entry.accent = "rgba(75, 48, 255, 0.78)";
    if (activeEntityEntry?.key === entry?.key) entityView.style.setProperty("--entity-accent", "rgba(75, 48, 255, 0.78)");
    try {
      const lib2 = getLocalLibrary();
      const saved = lib2.listSavedTracks();
      const dlState = lib2.load?.();
      const downloadedById = dlState?.downloadedTracks && typeof dlState.downloadedTracks === "object" ? dlState.downloadedTracks : {};
      const tracks = saved.map((t) => {
        const fromDownloads = downloadedById[String(t?.id)] || null;
        const backfillArtistId =
          Number(t?.artistId) ||
          Number(fromDownloads?.artistId) ||
          (fromDownloads?.trackJson?.artist?.id ? Number(fromDownloads.trackJson.artist.id) : null) ||
          null;
        const base = {
          id: Number(t?.id) || null,
          title: String(t?.title || ""),
          duration: Number(t?.duration) || 0,
          artist: { id: backfillArtistId || null, name: String(t?.artist || "") },
          album: {
            cover_small: String(t?.albumCover || ""),
            cover_medium: String(t?.albumCover || ""),
            cover: String(t?.albumCover || ""),
            title: String(t?.albumTitle || ""),
            id: Number(t?.albumId) || null,
          },
        };
        if (t?.download && typeof t.download === "object") {
          base.download = { ...t.download };
        }
        return base;
      });
      if (entry) entry.tracks = tracks;

      container.innerHTML = "";

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
      container.appendChild(header);

      if (tracks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-callout";
        empty.innerHTML =
          '<div class="empty-callout__icon"><i class="ri-emotion-happy-line" aria-hidden="true"></i></div>' +
          '<div class="empty-callout__text"><strong>Oops — you don’t have any songs yet.</strong><br/>Search, play, and like tracks to download them.</div>';
        container.appendChild(empty);
        return true;
      }

      const list = document.createElement("div");
      list.className = "entity-tracks entity-tracks--with-covers";
      registerTrackList(list, tracks, { pageContext: "liked" });

      let i = 0;
      for (const t of tracks) {
        const row = document.createElement("div");
        row.className = "entity-track";
        row.dataset.trackIndex = String(i);
        const trackId = Number(t?.id || t?.SNG_ID);
        if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
        const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
        if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
        const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
        if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);

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

        const coverWrap = document.createElement("div");
        coverWrap.className = "entity-track__cover";
        const img3 = document.createElement("img");
        img3.alt = "";
        img3.loading = "lazy";
        const coverUrl =
          String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || "") ||
          (typeof t?.ALB_PICTURE === "string" && /^[a-f0-9]{32}$/i.test(t.ALB_PICTURE)
            ? `https://cdn-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/100x100-000000-80-0-0.jpg`
            : "");
        if (coverUrl) img3.src = coverUrl;
        coverWrap.appendChild(img3);

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
        row.appendChild(coverWrap);
        row.appendChild(main);
        const like = document.createElement("button");
        like.type = "button";
        like.className = "entity-track__like";
        like.setAttribute("aria-label", "Unlike");
        like.innerHTML = `<i class="${lib.isTrackSaved(trackId) ? "ri-heart-fill" : "ri-heart-line"}" aria-hidden="true"></i>`;
        row.appendChild(like);
        row.appendChild(dur);
        list.appendChild(row);
        i++;
      }

      container.appendChild(list);
    } catch (e) {
      container.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
    }
    return true;
  };

  const renderDownloadsInto = async (container, entry) => {
    container.innerHTML = '<div class="search-empty">Loading Downloads…</div>';
    if (entry) entry.accent = "rgba(29, 185, 84, 0.58)";
    if (activeEntityEntry?.key === entry?.key) entityView.style.setProperty("--entity-accent", "rgba(29, 185, 84, 0.58)");
    try {
      let tracks = [];
      if (window.dl?.listDownloads) {
        try {
          // Clean up legacy `.session/downloads/track_*` folders if they exist.
          // This avoids the "everything is a track folder" layout and prevents duplicate re-downloads.
          if (window.dl?.migrateLegacy) await window.dl.migrateLegacy();
        } catch {}
        const res = await window.dl.listDownloads();
        const rows = Array.isArray(res?.tracks) ? res.tracks : [];
        tracks = rows
          .map((row) => {
            const raw = row?.track && typeof row.track === "object" ? { ...row.track } : null;
            const trackId = Number(row?.trackId || raw?.id);
            if (!Number.isFinite(trackId) || trackId <= 0) return null;

            const fileUrl = row?.fileUrl ? String(row.fileUrl) : "";
            const bestQuality = row?.bestQuality ? String(row.bestQuality) : "";
            const downloadPath = row?.audioPath ? String(row.audioPath) : "";
            const coverUrl = row?.coverUrl ? String(row.coverUrl) : "";

            const t = raw || { id: trackId };
            t.download = { fileUrl, quality: bestQuality, downloadPath };
            if (coverUrl) {
              t.album = t.album && typeof t.album === "object" ? { ...t.album } : {};
              t.album.cover_small = coverUrl;
              t.album.cover_medium = coverUrl;
              t.album.cover = coverUrl;
            }
            return t;
          })
          .filter(Boolean);
      } else {
        const lib2 = getLocalLibrary();
        const downloaded = lib2.listDownloadedTracks({ requireFile: true });
        tracks = downloaded.map((t) => {
          const cover = String(t?.albumCover || "");
          const artistId = Number(t?.artistId) || (t?.trackJson?.artist?.id ? Number(t.trackJson.artist.id) : null);
          return {
            id: Number(t?.id) || null,
            title: String(t?.title || ""),
            duration: Number(t?.duration) || 0,
            artist: { id: artistId || null, name: String(t?.artist || "") },
            album: {
              cover_small: cover,
              cover_medium: cover,
              cover: cover,
              title: String(t?.albumTitle || ""),
              id: Number(t?.albumId) || null,
            },
            ...(t?.download && typeof t.download === "object" ? { download: { ...t.download } } : {}),
            trackJson: t?.trackJson || null,
          };
        });
      }
      if (entry) entry.tracks = tracks;

      container.innerHTML = "";

      const header = document.createElement("div");
      header.className = "entity-header";

      const coverEl = document.createElement("div");
      coverEl.className = "entity-cover";
      coverEl.style.background =
        "linear-gradient(135deg, rgba(29, 185, 84, 0.92) 0%, rgba(16, 16, 16, 0.92) 78%)";
      coverEl.innerHTML =
        '<div style="height:100%;display:grid;place-items:center;"><i class="ri-download-2-fill" style="font-size:46px;color:rgba(255,255,255,0.94)"></i></div>';

      const meta = document.createElement("div");
      meta.className = "entity-meta";
      const h1 = document.createElement("div");
      h1.className = "entity-title";
      h1.textContent = "Downloads";
      const sub = document.createElement("div");
      sub.className = "entity-subtitle";
      sub.textContent = `${tracks.length} songs`;
      meta.appendChild(h1);
      meta.appendChild(sub);

      header.appendChild(coverEl);
      header.appendChild(meta);
      container.appendChild(header);

      if (tracks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-callout";
        empty.innerHTML =
          '<div class="empty-callout__icon"><i class="ri-emotion-happy-line" aria-hidden="true"></i></div>' +
          '<div class="empty-callout__text"><strong>No downloads yet.</strong><br/>Search, play, and download tracks to see them here.</div>';
        container.appendChild(empty);
        return true;
      }

      const list = document.createElement("div");
      list.className = "entity-tracks entity-tracks--with-covers";
      registerTrackList(list, tracks, { pageContext: "downloads" });

      // Smooth in-place mutations (no full rerender / no scroll jumps).
      try {
        window.__downloadsUI = {
          removeTrack: (trackId) => {
            const tid = Number(trackId);
            if (!Number.isFinite(tid) || tid <= 0) return false;
            if (!document.contains(list)) return false;

            const rows = Array.from(list.querySelectorAll(".entity-track"));
            const target = rows.find((r) => Number(r?.dataset?.trackId) === tid);
            if (!target) return false;

            const before = new Map();
            for (const r of rows) before.set(r, r.getBoundingClientRect());
            const tRect = before.get(target);

            // Animate the removed row using a fixed-position clone so the list can reflow immediately.
            if (tRect) {
              const clone = target.cloneNode(true);
              clone.style.position = "fixed";
              clone.style.left = `${Math.round(tRect.left)}px`;
              clone.style.top = `${Math.round(tRect.top)}px`;
              clone.style.width = `${Math.round(tRect.width)}px`;
              clone.style.height = `${Math.round(tRect.height)}px`;
              clone.style.margin = "0";
              clone.style.zIndex = "9999";
              clone.style.pointerEvents = "none";
              clone.style.transition = "opacity 180ms ease, transform 220ms ease";
              document.body.appendChild(clone);
              requestAnimationFrame(() => {
                clone.style.opacity = "0";
                clone.style.transform = "translateY(-6px)";
              });
              setTimeout(() => {
                try {
                  clone.remove();
                } catch {}
              }, 260);
            }

            // Remove from the backing array.
            const idx = tracks.findIndex((t) => Number(t?.id || t?.SNG_ID) === tid);
            if (idx >= 0) tracks.splice(idx, 1);

            // Remove the real row and then FLIP-animate remaining rows.
            try {
              target.remove();
            } catch {}

            const remaining = Array.from(list.querySelectorAll(".entity-track"));
            const afterRects = new Map();
            for (const r of remaining) afterRects.set(r, r.getBoundingClientRect());

            for (const r of remaining) {
              const b = before.get(r);
              const a = afterRects.get(r);
              if (!b || !a) continue;
              const dy = b.top - a.top;
              if (Math.abs(dy) < 0.5) continue;
              r.style.transition = "none";
              r.style.transform = `translateY(${dy}px)`;
            }

            // Force layout, then animate back.
            // eslint-disable-next-line no-unused-expressions
            list.offsetHeight;
            requestAnimationFrame(() => {
              for (const r of remaining) {
                if (!r.style.transform) continue;
                r.style.transition = "transform 220ms ease";
                r.style.transform = "";
                setTimeout(() => {
                  r.style.transition = "";
                }, 260);
              }
            });

            // Reindex row datasets + labels for click-to-play.
            for (let i = 0; i < remaining.length; i++) {
              const r = remaining[i];
              r.dataset.trackIndex = String(i);
              const num = r.querySelector(".entity-track__num");
              if (num) num.textContent = String(i + 1);
            }
            registerTrackList(list, tracks, { pageContext: "downloads" });

            // Update header count.
            sub.textContent = `${tracks.length} songs`;

            // Empty state.
            if (tracks.length === 0) {
              try {
                list.remove();
              } catch {}
              const empty = document.createElement("div");
              empty.className = "empty-callout";
              empty.innerHTML =
                '<div class="empty-callout__icon"><i class="ri-emotion-happy-line" aria-hidden="true"></i></div>' +
                '<div class="empty-callout__text"><strong>No downloads yet.</strong><br/>Search, play, and download tracks to see them here.</div>';
              container.appendChild(empty);
            }

            return true;
          },
        };
      } catch {}

      let i = 0;
      for (const t of tracks) {
        const row = document.createElement("div");
        row.className = "entity-track";
        row.dataset.trackIndex = String(i);
        const trackId = Number(t?.id || t?.SNG_ID);
        if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
        const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
        if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
        const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
        if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);

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

        const coverWrap = document.createElement("div");
        coverWrap.className = "entity-track__cover";
        const img3 = document.createElement("img");
        img3.alt = "";
        img3.loading = "lazy";
        const coverUrl =
          String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || "") ||
          (typeof t?.ALB_PICTURE === "string" && /^[a-f0-9]{32}$/i.test(t.ALB_PICTURE)
            ? `https://cdn-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/100x100-000000-80-0-0.jpg`
            : "");
        if (coverUrl) img3.src = coverUrl;
        coverWrap.appendChild(img3);

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
        row.appendChild(coverWrap);
        row.appendChild(main);
        const like = document.createElement("button");
        like.type = "button";
        like.className = "entity-track__like";
        like.setAttribute("aria-label", "Like");
        like.innerHTML = `<i class="${lib.isTrackSaved(trackId) ? "ri-heart-fill" : "ri-heart-line"}" aria-hidden="true"></i>`;
        row.appendChild(like);
        row.appendChild(dur);
        list.appendChild(row);
        i++;
      }

      container.appendChild(list);
    } catch (e) {
      container.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
    }
    return true;
  };

  const renderPageInto = async (container, route, entry) => {
    container.innerHTML = "";
    renderPageSkeleton(container, { sections: 3, cardsPerSection: 10 });
    if (activeEntityEntry?.key === entry?.key) entityView.style.removeProperty("--entity-accent");

    const page = cleanTargetToPage(route?.page);
    const title = String(route?.title || page || "Page");
    if (!page) {
      container.innerHTML = '<div class="search-empty">Invalid page.</div>';
      return true;
    }

    if (!window.dz?.getPage) {
      container.innerHTML = '<div class="search-empty">Page views are available in Electron only (missing window.dz).</div>';
      return true;
    }

    const thisReq = (entry.renderReq = Number(entry?.renderReq || 0) + 1);
    try {
      const res = await window.dz.getPage({ page });
      if (entry?.renderReq !== thisReq) return false;
      if (!res?.ok) {
        const e = res?.error ? `${String(res.error)}${res?.message ? `: ${String(res.message)}` : ""}` : String(res?.message || "unknown");
        container.innerHTML = `<div class="search-empty">Failed to load (${e}).</div>`;
        return true;
      }

      const gw = res.result && typeof res.result === "object" ? res.result : {};
      const results =
        gw?.results && typeof gw.results === "object"
          ? gw.results
          : gw?.RESULTS && typeof gw.RESULTS === "object"
            ? gw.RESULTS
            : gw;
      const sections =
        (Array.isArray(results?.sections) && results.sections) ||
        (Array.isArray(results?.SECTIONS) && results.SECTIONS) ||
        (Array.isArray(gw?.sections) && gw.sections) ||
        (Array.isArray(gw?.SECTIONS) && gw.SECTIONS) ||
        [];

      container.innerHTML = "";

      const header = document.createElement("div");
      header.className = "entity-header";

      const coverEl = document.createElement("div");
      coverEl.className = "entity-cover";
      coverEl.style.background = "rgba(255, 255, 255, 0.08)";
      coverEl.innerHTML =
        '<div style="height:100%;display:grid;place-items:center;"><i class="ri-compass-3-line" style="font-size:44px;color:rgba(255,255,255,0.84)"></i></div>';

      const meta = document.createElement("div");
      meta.className = "entity-meta";
      const h1 = document.createElement("div");
      h1.className = "entity-title";
      h1.textContent = title || "Explore";
      const sub = document.createElement("div");
      sub.className = "entity-subtitle";
      sub.textContent = "Explore";
      meta.appendChild(h1);
      meta.appendChild(sub);

      header.appendChild(coverEl);
      header.appendChild(meta);
      container.appendChild(header);

      const pickItems = (sec) => {
        if (!sec || typeof sec !== "object") return [];
        if (Array.isArray(sec.items)) return sec.items;
        if (Array.isArray(sec.ITEMS)) return sec.ITEMS;
        const data = sec.data && typeof sec.data === "object" ? sec.data : null;
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data?.ITEMS)) return data.ITEMS;
        return [];
      };

      const renderPageSection = (sec) => {
        const secTitle = String(sec?.title || sec?.TITLE || "").trim();
        if (secTitle && isFlowSectionTitle(secTitle)) return;
        const items = pickItems(sec);
        if (items.length === 0) return;

        const section = document.createElement("section");
        section.className = "made-for";

        const header = document.createElement("div");
        header.className = "made-for__header";

        const titles = document.createElement("div");
        titles.className = "made-for__titles";
        const h2 = document.createElement("h2");
        h2.className = "h2 h2--small";
        h2.textContent = secTitle || "Explore";
        titles.appendChild(h2);
        header.appendChild(titles);
        section.appendChild(header);

        const carousel = document.createElement("div");
        carousel.className = "carousel";
        carousel.setAttribute("role", "list");

        for (const item of items.slice(0, 18)) {
          const a = document.createElement("a");
          a.className = "big-card";
          a.href = "#";
          a.setAttribute("role", "listitem");
          a.dataset.target = String(item?.target || item?.TARGET || item?.data?.target || item?.data?.TARGET || "");

          const cover = document.createElement("div");
          cover.className = "big-card__cover";

          const img = document.createElement("img");
          img.alt = "";
          img.loading = "lazy";
          const src = buildDeezerImageUrl(item, { size: 256 });
          if (src) img.src = src;
          cover.appendChild(img);

          const play = document.createElement("span");
          play.className = "hover-play hover-play--cover";
          play.setAttribute("aria-hidden", "true");
          play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
          cover.appendChild(play);

          const t = document.createElement("div");
          t.className = "big-card__title";
          t.textContent = String(
            item?.title ||
              item?.TITLE ||
              item?.data?.SNG_TITLE ||
              item?.data?.ALB_TITLE ||
              item?.data?.title ||
              item?.data?.name ||
              ""
          );

          const subtitle = document.createElement("div");
          subtitle.className = "big-card__subtitle";
          subtitle.textContent = formatFansCountText(String(item?.subtitle || item?.SUBTITLE || item?.data?.ART_NAME || item?.data?.artist || ""));

          a.appendChild(cover);
          a.appendChild(t);
          a.appendChild(subtitle);
          carousel.appendChild(a);
        }

        section.appendChild(carousel);
        container.appendChild(section);
      };

      for (const s of sections) renderPageSection(s);

      if (container.querySelectorAll(".made-for").length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "Nothing to show here yet.";
        container.appendChild(empty);
      }

      if (entry) entry.tracks = [];
      return true;
    } catch (e) {
      if (entry?.renderReq !== thisReq) return false;
      container.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
      return true;
    }
  };

  const ensureEntityEntry = (key) => {
    const existing = entityPageCache.get(key);
    if (existing) return existing;
    const root = document.createElement("div");
    const entry = { key, root, tracks: [], accent: null, lastUsedAt: Date.now(), renderedAt: 0, renderReq: 0 };
    entityPageCache.set(key, entry);
    evictEntityCacheIfNeeded();
    return entry;
  };

  const showEntityRoute = async (route, { forceRefresh = false } = {}) => {
    const key = getRouteKey(route);
    const entry = ensureEntityEntry(key);
    mountEntityEntry(entry);
    const shouldRefresh = forceRefresh || route?.name === "liked" || route?.name === "downloads" || !entry.renderedAt;
    if (shouldRefresh) {
      const ok =
        route?.name === "liked"
          ? await renderLikedInto(entry.root, entry)
          : route?.name === "downloads"
            ? await renderDownloadsInto(entry.root, entry)
          : route?.name === "page"
            ? await renderPageInto(entry.root, route, entry)
            : await renderEntityInto(entry.root, route, entry);
      entry.renderedAt = ok ? Date.now() : 0;
    }
    return entry;
  };

  const renderRoute = async (route) => {
    try {
      window.__navRoute = route && typeof route === "object" ? { ...route } : { name: "home" };
    } catch {}
    const name = route?.name;
    if (name === "home") {
      showView("home", { scrollTop: route?.scrollTop });
      if (route?.refresh) {
        window.__deezerSectionsRefresh?.();
        if (scrollEl) scrollEl.scrollTop = 0;
      }
      setNavButtons();
      return;
    }

    if (name === "search") {
      await renderSearch({ q: route.q, filter: route.filter || "all", scrollTop: route?.scrollTop });
      setNavButtons();
      return;
    }

    if (name === "entity" || name === "liked" || name === "downloads" || name === "page") {
      showView("entity", { scrollTop: route?.scrollTop });
      await showEntityRoute(route);
      setNavButtons();
      return;
    }

    /*
      Legacy route rendering (kept temporarily for reference). Replaced by `showEntityRoute(route)` above,
      which caches per-route DOM and crossfades between cached containers.

    if (name === "entity") {
      await renderEntity({
        entityType: route.entityType,
        id: route.id,
        title: route.title,
        subtitle: route.subtitle,
        cover: route.cover,
      });
      setNavButtons();
      return;
    }

    if (name === "liked") {
      showView("entity");
      entityView.innerHTML = '<div class="search-empty">Loading Liked Songs…</div>';
      try {
        const lib = getLocalLibrary();
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
        list.className = "entity-tracks entity-tracks--with-covers";
        let i = 0;
        for (const t of tracks) {
          const row = document.createElement("div");
          row.className = "entity-track";
          row.dataset.trackIndex = String(i);
          const trackId = Number(t?.id || t?.SNG_ID);
          if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
          const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
          if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);

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

          const coverWrap = document.createElement("div");
          coverWrap.className = "entity-track__cover";
          const img3 = document.createElement("img");
          img3.alt = "";
          img3.loading = "lazy";
          const coverUrl =
            String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || "") ||
            (typeof t?.ALB_PICTURE === "string" && /^[a-f0-9]{32}$/i.test(t.ALB_PICTURE)
              ? `https://cdn-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/100x100-000000-80-0-0.jpg`
              : "");
          if (coverUrl) img3.src = coverUrl;
          coverWrap.appendChild(img3);

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
          row.appendChild(coverWrap);
          row.appendChild(main);
          const like = document.createElement("button");
          like.type = "button";
          like.className = "entity-track__like";
          like.setAttribute("aria-label", "Unlike");
          like.innerHTML = `<i class="${lib.isTrackSaved(trackId) ? "ri-heart-fill" : "ri-heart-line"}" aria-hidden="true"></i>`;
          row.appendChild(like);
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

    if (name === "page") {
      showView("entity");
      renderPageSkeleton(entityView, { sections: 3, cardsPerSection: 10 });
      entityView.style.removeProperty("--entity-accent");

      const page = cleanTargetToPage(route?.page);
      const title = String(route?.title || page || "Page");
      if (!page) {
        entityView.innerHTML = '<div class="search-empty">Invalid page.</div>';
        setNavButtons();
        return;
      }

      if (!window.dz?.getPage) {
        entityView.innerHTML = '<div class="search-empty">Page views are available in Electron only (missing window.dz).</div>';
        setNavButtons();
        return;
      }

      try {
        const res = await window.dz.getPage({ page });
        if (!res?.ok) {
          const e = res?.error ? `${String(res.error)}${res?.message ? `: ${String(res.message)}` : ""}` : String(res?.message || "unknown");
          entityView.innerHTML = `<div class="search-empty">Failed to load (${e}).</div>`;
          setNavButtons();
          return;
        }

        const gw = res.result && typeof res.result === "object" ? res.result : {};
        const results =
          gw?.results && typeof gw.results === "object"
            ? gw.results
            : gw?.RESULTS && typeof gw.RESULTS === "object"
              ? gw.RESULTS
              : gw;
        const sections =
          (Array.isArray(results?.sections) && results.sections) ||
          (Array.isArray(results?.SECTIONS) && results.SECTIONS) ||
          (Array.isArray(gw?.sections) && gw.sections) ||
          (Array.isArray(gw?.SECTIONS) && gw.SECTIONS) ||
          [];

        entityView.innerHTML = "";

        const header = document.createElement("div");
        header.className = "entity-header";

        const coverEl = document.createElement("div");
        coverEl.className = "entity-cover";
        coverEl.style.background = "rgba(255, 255, 255, 0.08)";
        coverEl.innerHTML =
          '<div style="height:100%;display:grid;place-items:center;"><i class="ri-compass-3-line" style="font-size:44px;color:rgba(255,255,255,0.84)"></i></div>';

        const meta = document.createElement("div");
        meta.className = "entity-meta";
        const h1 = document.createElement("div");
        h1.className = "entity-title";
        h1.textContent = String(results?.title || results?.TITLE || title || "Explore");
        const sub = document.createElement("div");
        sub.className = "entity-subtitle";
        sub.textContent = "Explore";
        meta.appendChild(h1);
        meta.appendChild(sub);

        header.appendChild(coverEl);
        header.appendChild(meta);
        entityView.appendChild(header);

        const pickItems = (sec) => {
          if (!sec || typeof sec !== "object") return [];
          if (Array.isArray(sec.items)) return sec.items;
          if (Array.isArray(sec.ITEMS)) return sec.ITEMS;
          const data = sec.data && typeof sec.data === "object" ? sec.data : null;
          if (Array.isArray(data?.items)) return data.items;
          if (Array.isArray(data?.ITEMS)) return data.ITEMS;
          return [];
        };

        const renderPageSection = (sec) => {
          const secTitle = String(sec?.title || sec?.TITLE || "").trim();
          if (secTitle && isFlowSectionTitle(secTitle)) return;
          const items = pickItems(sec);
          if (items.length === 0) return;

          const section = document.createElement("section");
          section.className = "made-for";

          const header = document.createElement("div");
          header.className = "made-for__header";

          const titles = document.createElement("div");
          titles.className = "made-for__titles";
          const h2 = document.createElement("h2");
          h2.className = "h2 h2--small";
          h2.textContent = secTitle || "Explore";
          titles.appendChild(h2);
          header.appendChild(titles);
          section.appendChild(header);

          const carousel = document.createElement("div");
          carousel.className = "carousel";
          carousel.setAttribute("role", "list");

          for (const item of items.slice(0, 18)) {
            const a = document.createElement("a");
            a.className = "big-card";
            a.href = "#";
            a.setAttribute("role", "listitem");
            a.dataset.target = String(item?.target || item?.TARGET || item?.data?.target || item?.data?.TARGET || "");

            const cover = document.createElement("div");
            cover.className = "big-card__cover";

            const img = document.createElement("img");
            img.alt = "";
            img.loading = "lazy";
            const src = buildDeezerImageUrl(item, { size: 256 });
            if (src) img.src = src;
            cover.appendChild(img);

            const play = document.createElement("span");
            play.className = "hover-play hover-play--cover";
            play.setAttribute("aria-hidden", "true");
            play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
            cover.appendChild(play);

            const t = document.createElement("div");
            t.className = "big-card__title";
            t.textContent = String(
              item?.title ||
                item?.TITLE ||
                item?.data?.SNG_TITLE ||
                item?.data?.ALB_TITLE ||
                item?.data?.title ||
                item?.data?.name ||
                ""
            );

            const subtitle = document.createElement("div");
            subtitle.className = "big-card__subtitle";
            subtitle.textContent = formatFansCountText(
              String(item?.subtitle || item?.SUBTITLE || item?.data?.ART_NAME || item?.data?.artist || ""),
            );

            a.appendChild(cover);
            a.appendChild(t);
            a.appendChild(subtitle);
            carousel.appendChild(a);
          }

          section.appendChild(carousel);
          entityView.appendChild(section);
        };

        for (const s of sections) renderPageSection(s);

        if (entityView.querySelectorAll(".made-for").length === 0) {
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = "Nothing to show here yet.";
          entityView.appendChild(empty);
        }
      } catch (e) {
        entityView.innerHTML = `<div class="search-empty">${String(e?.message || e || "Failed to load")}</div>`;
      }

      setNavButtons();
      return;
    }

    */
    if (name === "settings") {
      showView("settings", { scrollTop: route?.scrollTop });
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

        // Lock out qualities based on Deezer account entitlements.
        try {
          const res = await window.dz?.getCapabilities?.();
          const caps = res?.ok && res?.capabilities && typeof res.capabilities === "object" ? res.capabilities : null;
          const canHQ = Boolean(caps?.can_stream_hq);
          const canLossless = Boolean(caps?.can_stream_lossless);

          const normalize = (q) => {
            const v = String(q || "").toLowerCase();
            if (v === "flac" || v === "mp3_320" || v === "mp3_128") return v;
            return "mp3_128";
          };
          const clamp = (q) => {
            const v = normalize(q);
            if (v === "flac" && !canLossless) return canHQ ? "mp3_320" : "mp3_128";
            if (v === "mp3_320" && !canHQ) return "mp3_128";
            return v;
          };

          const options = Array.from(qualityEl.querySelectorAll("option"));
          for (const opt of options) {
            const v = normalize(opt.value);
            const disabled = (v === "mp3_320" && !canHQ) || (v === "flac" && !canLossless);
            opt.disabled = disabled;
          }

          const desired = normalize(qualityEl.value);
          const effective = clamp(desired);
          if (desired !== effective) {
            qualityEl.value = effective;
            localStorage.setItem(key, effective);
          }
        } catch {}

        qualityEl.addEventListener("change", () => {
          localStorage.setItem(key, qualityEl.value);
        });
      }

      if (dirEl) {
        dirEl.textContent = "Session downloads (.session/downloads)";
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
    if (scrollEl) {
      history[historyIndex] = { ...history[historyIndex], scrollTop: scrollEl.scrollTop };
    }

    const routeKey = getRouteKey;

    const current = history[historyIndex];
    const nextRaw = route || { name: "home" };
    const next = { ...nextRaw };
    const nextKey = routeKey(next);
    const curKey = routeKey(current);
    const hasScroll = Number.isFinite(Number(next?.scrollTop));
    if (!hasScroll) {
      const keep = replace && nextKey === curKey && Number.isFinite(Number(current?.scrollTop));
      next.scrollTop = keep ? Number(current.scrollTop) : 0;
    }

    if (replace) {
      history[historyIndex] = next;
    } else {
      history.splice(historyIndex + 1);
      history.push(next);
      historyIndex = history.length - 1;
    }

    await renderRoute(next);
    // Safety: never leave the app in a state where a view is still "lifted" (visible but unclickable).
    restoreAllLiftedViews();
    if (scrollEl) {
      const st = Number(next?.scrollTop);
      if (Number.isFinite(st) && st >= 0 && !(next?.refresh && next?.name === "home")) {
        // Route changes should never leave the next page "halfway down".
        scrollEl.scrollTop = st;
        requestAnimationFrame(() => {
          if (scrollEl.scrollTop !== st) scrollEl.scrollTop = st;
        });
      }
    }
  };

  const goBack = async () => {
    if (historyIndex <= 0) return;
    if (scrollEl) history[historyIndex] = { ...history[historyIndex], scrollTop: scrollEl.scrollTop };
    historyIndex -= 1;
    await renderRoute(history[historyIndex]);
    if (scrollEl) {
      const st = Number(history[historyIndex]?.scrollTop);
      if (Number.isFinite(st) && st >= 0) requestAnimationFrame(() => (scrollEl.scrollTop = st));
    }
  };

  const goForward = async () => {
    if (historyIndex >= history.length - 1) return;
    if (scrollEl) history[historyIndex] = { ...history[historyIndex], scrollTop: scrollEl.scrollTop };
    historyIndex += 1;
    await renderRoute(history[historyIndex]);
    if (scrollEl) {
      const st = Number(history[historyIndex]?.scrollTop);
      if (Number.isFinite(st) && st >= 0) requestAnimationFrame(() => (scrollEl.scrollTop = st));
    }
  };

  backBtn.addEventListener("click", () => void goBack());
  forwardBtn.addEventListener("click", () => void goForward());
  homeBtn.addEventListener("click", () => void navigate({ name: "home", refresh: true, scrollTop: 0 }));

  window.__spotifyNav = { navigate: (route, options) => navigate(route, options) };

  const openSearchPage = (q) => {
    const term = String(q || "").trim();
    if (term.length < 2) return;
    void navigate({ name: "search", q: term, filter: "all", scrollTop: 0 }, { replace: false });
  };

  const searchPopover = wireSearchPopover({
    searchInput,
    popoverEl: searchPopoverEl,
    listEl: searchPopoverList,
    getDz: () => window.dz,
    onOpenSearchPage: (q) => openSearchPage(q),
    onNavigateEntity: ({ entityType, id }) => void navigate({ name: "entity", entityType, id, scrollTop: 0 }),
    onPlayTrack: (t) => {
      if (!window.__player) return;
      void window.__player.setQueueAndPlay([t], 0);
      const albumId = t?.album?.id || t?.ALB_ID;
      if (albumId) void navigate({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
    },
    minChars: 2,
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (searchInput.value) {
        searchInput.value = "";
        searchClearBtn.hidden = true;
        searchPopover.close();
      }
      return;
    }
    if (event.key === "Enter") {
      const q = String(searchInput.value || "").trim();
      if (q.length < 2) return;
      searchPopover.close();
      openSearchPage(q);
    }
  });

  const syncSearchClear = () => {
    searchClearBtn.hidden = !String(searchInput.value || "").trim();
  };

  searchInput.addEventListener("input", () => {
    syncSearchClear();
  });
  syncSearchClear();

  searchClearBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!searchInput.value) return;
    searchInput.value = "";
    syncSearchClear();
    searchPopover.close();
    try {
      searchInput.focus();
    } catch {}
    // Keep history clean; clearing should feel instantaneous.
    void navigate({ name: "home", scrollTop: 0 }, { replace: true });
  });

  searchSubmitBtn.addEventListener("click", () => {
    const q = String(searchInput.value || "").trim();
    if (q.length < 2) {
      searchInput.focus();
      return;
    }
    searchPopover.close();
    openSearchPage(q);
  });

  for (const btn of searchFilterButtons) {
    btn.addEventListener("click", () => {
      const filter = String(btn.dataset.searchFilter || "all");
      const q = String(searchInput.value || "").trim();
      if (q.length < 2) return;
      void navigate({ name: "search", q, filter, scrollTop: 0 }, { replace: true });
    });
  }

  searchResults.addEventListener("click", (event) => {
    const row = event.target?.closest?.(".search-track");
    if (row) {
      event.preventDefault();
      if (!window.__player) return;
      const { tracks, index } = resolveTrackListFromRow(row);
      if (!Array.isArray(tracks) || tracks.length === 0) return;
      if (!Number.isFinite(index) || index < 0) return;
      void window.__player.setQueueAndPlay(tracks, index);
      const t = tracks[index];
      const albumId = t?.album?.id || t?.ALB_ID;
      if (albumId) void navigate({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
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

  // Handle big cards inside "page" views.
  entityView.addEventListener("click", (event) => {
    const card = event.target?.closest?.("a.big-card");
    if (!card) return;
    const target = card.dataset.target;
    if (!target) return;
    const parsed = parseTarget(target);
    if (!parsed) return;
    event.preventDefault();

    if (parsed.kind === "album" || parsed.kind === "artist" || parsed.kind === "playlist") {
      void navigate({ name: "entity", entityType: parsed.kind, id: parsed.id });
      return;
    }
    if (parsed.kind === "track") {
      if (!window.__player) return;
      const id = Number(parsed.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const title = card.querySelector(".big-card__title")?.textContent || "";
      const subtitle = card.querySelector(".big-card__subtitle")?.textContent || "";
      const cover = card.querySelector(".big-card__cover img")?.getAttribute?.("src") || "";
      const artistId = Number(card.dataset.artistId || 0);
      const albumId = Number(card.dataset.albumId || 0);
      void window.__player.setQueueAndPlay(
        [
          {
            id,
            title,
            artist: { id: Number.isFinite(artistId) && artistId > 0 ? artistId : null, name: subtitle },
            album: {
              id: Number.isFinite(albumId) && albumId > 0 ? albumId : null,
              cover_medium: cover,
              cover_small: cover,
            },
          },
        ],
        0,
      );
      return;
    }
    if (parsed.kind === "smarttracklist") {
      const title = card.querySelector(".big-card__title")?.textContent || "";
      const subtitle = card.querySelector(".big-card__subtitle")?.textContent || "";
      const cover = card.querySelector(".big-card__cover img")?.getAttribute?.("src") || "";
      void navigate({ name: "entity", entityType: "smarttracklist", id: parsed.id, title, subtitle, cover });
      return;
    }
    if (parsed.kind === "channel") {
      void navigate({ name: "page", page: parsed.page, title: card.querySelector(".big-card__title")?.textContent || "" });
      return;
    }
    if (parsed.kind === "page") {
      void navigate({ name: "page", page: parsed.page, title: card.querySelector(".big-card__title")?.textContent || "" });
    }
  });

  entityView.addEventListener("click", (event) => {
    const likeBtn = event.target?.closest?.(".entity-track__like");
    if (likeBtn) {
      event.preventDefault();
      event.stopPropagation();

      const row = likeBtn.closest(".entity-track");
      const idx = Number(row?.dataset?.trackIndex);
      const trackId = Number(row?.dataset?.trackId);
      if (!Number.isFinite(trackId) || trackId <= 0) return;

      const source = Array.isArray(activeEntityEntry?.tracks) ? activeEntityEntry.tracks : [];
      const trackObj = Number.isFinite(idx) && idx >= 0 ? source[idx] : null;

      const isSaved = lib.isTrackSaved(trackId);
      if (isSaved) {
        lib.removeSavedTrack(trackId);
      } else {
        lib.addSavedTrack(trackObj || { id: trackId });
        if (window.dl?.downloadTrack) {
          const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";
          const uuid = `dl_${trackId}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
          // Persist enough metadata so Downloads can show art + track info once the file is ready.
          try {
            lib.upsertDownloadedTrack?.({
              track: trackObj || { id: trackId },
              fileUrl: "",
              downloadPath: "",
              quality,
              uuid,
            });
          } catch {}
          const t = trackObj && typeof trackObj === "object" ? trackObj : null;
          const album = t?.album && typeof t.album === "object" ? t.album : null;
          void window.dl.downloadTrack({ id: trackId, quality, uuid, ...(t ? { track: t, album: album || null } : {}) });
        }
      }

      const icon = likeBtn.querySelector("i");
      if (icon) {
        icon.classList.toggle("ri-heart-fill", !isSaved);
        icon.classList.toggle("ri-heart-line", isSaved);
      }
      return;
    }

    const row = event.target?.closest?.(".entity-track");
    if (!row) return;
    const idx = Number(row.dataset.trackIndex);
    if (!Number.isFinite(idx) || idx < 0) return;
    if (!window.__player) return;

    const tracks = Array.isArray(activeEntityEntry?.tracks) ? activeEntityEntry.tracks : [];
    if (tracks.length > 0) void window.__player.setQueueAndPlay(tracks, idx);
  });

  setNavButtons();
  void renderRoute(history[historyIndex]);

  const refreshLikeButtons = () => {
    const rows = Array.from(entityView.querySelectorAll(".entity-track"));
    if (rows.length === 0) return;
    for (const row of rows) {
      const trackId = Number(row.dataset.trackId);
      if (!Number.isFinite(trackId) || trackId <= 0) continue;
      const btn = row.querySelector(".entity-track__like");
      const icon = btn?.querySelector?.("i");
      if (!icon) continue;
      const saved = lib.isTrackSaved(trackId);
      icon.classList.toggle("ri-heart-fill", saved);
      icon.classList.toggle("ri-heart-line", !saved);
    }
  };

  window.addEventListener("local-library:changed", refreshLikeButtons);

  // If the user is currently viewing Liked Songs, keep the list in sync with any library changes
  // (e.g. liking from the player, context menu, etc.). We use replace=true so history doesn't grow.
  window.addEventListener("local-library:changed", () => {
    try {
      const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
      if (route?.name !== "liked") return;
      const st = scrollEl ? scrollEl.scrollTop : 0;
      void navigate({ name: "liked", refresh: true, scrollTop: st }, { replace: true });
    } catch {}
  });
}

export function wireNowPlayingHighlights() {
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

  const refreshFromPlayer = () => {
    const st = window.__player?.getState?.() || {};
    const tid = Number(st?.track?.id ?? st?.trackId);
    const state = { trackId: Number.isFinite(tid) ? tid : null, isPlaying: Boolean(st?.isPlaying) };
    applyToContainer(document.getElementById("entityView"), state);
    applyToContainer(document.getElementById("searchResults"), state);
  };

  window.addEventListener("player:change", (event) => {
    const detail = event?.detail || {};
    const trackId = Number(detail.trackId);
    const state = { trackId: Number.isFinite(trackId) ? trackId : null, isPlaying: Boolean(detail.isPlaying) };
    applyToContainer(document.getElementById("entityView"), state);
    applyToContainer(document.getElementById("searchResults"), state);
  });

  window.addEventListener("nav:viewChanged", () => requestAnimationFrame(() => refreshFromPlayer()));

  const schedule = (() => {
    let raf = 0;
    return () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        refreshFromPlayer();
      });
    };
  })();

  const watch = (el) => {
    if (!el || typeof MutationObserver !== "function") return null;
    const obs = new MutationObserver(() => schedule());
    obs.observe(el, { childList: true, subtree: true });
    return obs;
  };

  watch(document.getElementById("entityView"));
  watch(document.getElementById("searchResults"));
  refreshFromPlayer();
}
