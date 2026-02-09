import { extractAverageColorFromImageUrl, formatDuration, formatFansCountText, formatRecordTypeLabel, normalizeRecordType } from "./utils.js";
import { getLocalLibrary } from "./localLibrary.js";
import { parseTarget } from "./deezerImages.js";
import { renderEntitySkeleton } from "./skeletons.js";
import { wireSearchPopover } from "./searchPopover.js";
import { registerTrackList, resolveTrackListFromRow } from "./contextMenu.js";
import {
  DOWNLOAD_QUALITY_KEY,
  clampDownloadQualityForCapabilities,
  getDownloadQualityRaw,
  normalizeDownloadQuality,
  setDownloadQualityRaw,
} from "./settings.js";
import { createArtistCache } from "./navigation/artistCache.js";
import { createDownloadBadges } from "./navigation/downloadBadges.js";
import { createEntityDownloadAction } from "./navigation/entityDownloadAction.js";
import { createEntityRenderer } from "./navigation/entityRenderer.js";
import { createEntityPageCache } from "./navigation/entityPageCache.js";
import { wireNavigationEventBindings } from "./navigation/eventBindings.js";
import { createLikedDownloadsRenderer } from "./navigation/likedDownloadsRenderer.js";
import { createPageRenderer } from "./navigation/pageRenderer.js";
import { createSettingsRouteRenderer } from "./navigation/settingsRouteRenderer.js";
import { createSearchRenderer } from "./navigation/searchRenderer.js";
import { createHomeRoute, getInitialRouteName, getRouteKey } from "./navigation/routeState.js";
import { createViewController } from "./navigation/viewController.js";

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
  const signedOutView = document.getElementById("mainViewSignedOut");
  const searchView = document.getElementById("mainViewSearch");
  const entityWrap = document.getElementById("mainViewEntity");
  const notificationsView = document.getElementById("mainViewNotifications");
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
    !scrollEl ||
    !homeView ||
    !signedOutView ||
    !searchView ||
    !entityWrap ||
    !notificationsView ||
    !settingsView ||
    !queryLabel ||
    !searchResults ||
    !entityView
  ) {
    return;
  }

  const setSearchEnabled = (enabled) => {
    const ok = Boolean(enabled);
    try {
      searchInput.disabled = !ok;
    } catch {}
    try {
      searchSubmitBtn.disabled = !ok;
    } catch {}
    try {
      searchEl.setAttribute("aria-disabled", ok ? "false" : "true");
    } catch {}
    try {
      searchInput.placeholder = ok ? "What do you want to play?" : "Log in to search";
    } catch {}
    if (!ok) {
      try {
        searchInput.value = "";
      } catch {}
      try {
        searchClearBtn.hidden = true;
      } catch {}
      try {
        searchPopoverEl.hidden = true;
      } catch {}
    }
  };

  const refreshAuthChrome = () => setSearchEnabled(Boolean(window.__authHasARL));

  const { readArtistCache, writeArtistCache } = createArtistCache();
  const downloadBadges = createDownloadBadges({ lib, entityView });

  const entityCache = createEntityPageCache({ entityView, maxEntries: 12 });

  const entityDownloadAction = createEntityDownloadAction({
    lib,
    getActiveEntry: () => entityCache.getActiveEntry(),
  });

  const views = {
    home: homeView,
    signedOut: signedOutView,
    search: searchView,
    entity: entityWrap,
    notifications: notificationsView,
    settings: settingsView,
  };

  // Ensure first paint reflects the initial route (avoid a "home flash" before we render history[0]).
  const initialViewName = getInitialRouteName({ hasAuth: window.__authHasARL, offlineMode: window.__offlineMode });
  const { showView, restoreAllLiftedViews } = createViewController({ views, scrollEl, refreshAuthChrome, initialViewName });

  const history = [createHomeRoute({ hasAuth: window.__authHasARL, offlineMode: window.__offlineMode })];
  let historyIndex = 0;

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

  const renderEmptyText = (container, message) => {
    const el = container && container.nodeType === 1 ? container : null;
    if (!el) return;
    el.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = String(message || "");
    el.appendChild(empty);
  };

  const { renderPageInto } = createPageRenderer({ entityCache, renderEmptyText });

  const { renderSearch } = createSearchRenderer({
    showView,
    searchInput,
    queryLabel,
    searchResults,
    setSearchFilterActive,
  });

  const renderSettingsRoute = createSettingsRouteRenderer({
    showView,
    setNavButtons,
    getDownloadQualityRaw,
    normalizeDownloadQuality,
    setDownloadQualityRaw,
    clampDownloadQualityForCapabilities,
    downloadQualityKey: DOWNLOAD_QUALITY_KEY,
  });

  const { renderLikedInto, renderDownloadsInto } = createLikedDownloadsRenderer({
    lib,
    entityCache,
    renderEmptyText,
    formatDuration,
    registerTrackList,
    getLocalLibrary,
  });

  const { renderEntityInto } = createEntityRenderer({
    renderEmptyText,
    entityCache,
    renderEntitySkeleton,
    formatRecordTypeLabel,
    formatFansCountText,
    normalizeRecordType,
    lib,
    getDownloadQualityRaw,
    entityDownloadAction,
    extractAverageColorFromImageUrl,
    downloadBadges,
    formatDuration,
    registerTrackList,
    readArtistCache,
    writeArtistCache,
  });

  const showEntityRoute = async (route, { forceRefresh = false } = {}) => {
    const key = getRouteKey(route);
    const entry = entityCache.ensureEntry(key);
    if (!entry) return null;
    entityCache.mountEntry(entry);
    const shouldRefresh =
      forceRefresh || Boolean(route?.refresh) || route?.name === "liked" || route?.name === "downloads" || !entry.renderedAt;
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
    if (name === "signedOut") {
      showView("signedOut", { scrollTop: route?.scrollTop });
      setNavButtons();
      return;
    }
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

    if (name === "notifications") {
      showView("notifications", { scrollTop: route?.scrollTop });
      setNavButtons();
      return;
    }

    if (name === "settings") {
      await renderSettingsRoute(route);
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

  const resetHistory = async (route) => {
    const nextRaw = route || { name: "home" };
    const next = { ...nextRaw };
    const hasScroll = Number.isFinite(Number(next?.scrollTop));
    if (!hasScroll) next.scrollTop = 0;
    history.splice(0);
    history.push(next);
    historyIndex = 0;
    setNavButtons();
    await renderRoute(next);
    restoreAllLiftedViews();
    try {
      if (scrollEl) scrollEl.scrollTop = Math.max(0, Number(next.scrollTop) || 0);
    } catch {}
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

  window.__spotifyNav = { navigate: (route, options) => navigate(route, options), reset: (route) => resetHistory(route) };

  const openSearchPage = (q) => {
    const term = String(q || "").trim();
    if (term.length < 2) return;
    if (!window.__authHasARL) {
      void navigate({ name: "signedOut", scrollTop: 0 }, { replace: true });
      return;
    }
    void navigate({ name: "search", q: term, filter: "all", scrollTop: 0 }, { replace: false });
  };

  const searchPopover = wireSearchPopover({
    searchInput,
    popoverEl: searchPopoverEl,
    listEl: searchPopoverList,
    getDz: () => (window.__authHasARL ? window.dz : null),
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

  wireNavigationEventBindings({
    backBtn,
    forwardBtn,
    homeBtn,
    searchInput,
    searchClearBtn,
    searchSubmitBtn,
    searchResults,
    searchFilterButtons,
    searchPopover,
    openSearchPage,
    navigate,
    getHomeRoute: ({ refresh = false, scrollTop = 0 } = {}) =>
      createHomeRoute({ hasAuth: window.__authHasARL, offlineMode: window.__offlineMode, refresh, scrollTop }),
    resolveTrackListFromRow,
    entityCache,
    lib,
    getDownloadQualityRaw,
    parseTarget,
    entityView,
    refreshAuthChrome,
    scrollEl,
    goBack,
    goForward,
  });

  setNavButtons();
  void renderRoute(history[historyIndex]);
}

export { wireNowPlayingHighlights } from "./navigation/nowPlayingHighlights.js";
