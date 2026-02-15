import { clamp } from "../utils.js";
import { getLocalLibrary } from "../localLibrary.js";
import {
  applyLibraryViewMode,
  getLibraryViewMode,
  isLibraryGridViewMode,
  LIBRARY_VIEW_STORAGE_KEY,
} from "../library/viewMode.js";
import { clearLibraryMotionStyles } from "../library/motion.js";
import { wireLibraryRecentsMenu } from "./recentsMenu.js";
import { createLibraryLocalRenderer } from "./libraryLocalRenderer.js";

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
  const VIEW_KEY = LIBRARY_VIEW_STORAGE_KEY;
  const FILTER_KEY = "spotify.libraryFilter";

  const norm = (s) =>
    String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const getText = (el) => String(el?.textContent || "").trim().toLowerCase();
  const { renderLibraryLocal } = createLibraryLocalRenderer({ list, norm });

  const applySearchFilter = () => {
    const q = norm(searchInput.value);
    list.dataset.searchActive = q ? "1" : "";
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
  let wasSearchActive = false;
  searchInput.addEventListener("input", () => {
    const isActive = Boolean(norm(searchInput.value));
    applySearchFilter();
    if (isActive !== wasSearchActive) {
      wasSearchActive = isActive;
      scheduleRefresh(0);
    }
  });
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
    event.stopPropagation();

    const all = Array.from(list.querySelectorAll(".library-item"));
    for (const it of all) it.classList.toggle("is-active", it === item);

    const clickedCover = (() => {
      const coverEl = item.querySelector?.(".cover");
      const x = Number(event?.clientX);
      const y = Number(event?.clientY);
      if (
        coverEl &&
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        typeof coverEl.getBoundingClientRect === "function"
      ) {
        const rect = coverEl.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        }
      }
      return Boolean(event.target?.closest?.(".cover"));
    })();

    const toggleOrPlayTrack = (track) => {
      if (!track || !window.__player) return;
      const tid = Number(track?.id || track?.SNG_ID || 0);
      const st = window.__player?.getState?.() || {};
      const curId = Number(st?.track?.id || st?.trackId || 0);
      if (Number.isFinite(tid) && tid > 0 && Number.isFinite(curId) && curId === tid && typeof window.__player.togglePlayPause === "function") {
        void window.__player.togglePlayPause();
        return;
      }
      if (window.__player?.setQueueAndPlay) void window.__player.setQueueAndPlay([track], 0);
    };

    if (item.dataset.route === "liked") {
      window.__spotifyNav?.navigate?.({ name: "liked" });
      return;
    }
    if (item.dataset.route === "downloads") {
      window.__spotifyNav?.navigate?.({ name: "downloads" });
      return;
    }
    if (item.dataset.route === "customPlaylist" && item.dataset.customPlaylistId) {
      window.__spotifyNav?.navigate?.({ name: "customPlaylist", id: item.dataset.customPlaylistId });
      return;
    }
    if (item.dataset.route === "folder" && item.dataset.folderId) {
      window.__spotifyNav?.navigate?.({ name: "folder", id: item.dataset.folderId });
      return;
    }
    if (item.dataset.route === "saved-track") {
      const trackId = Number(item.dataset.trackId);
      const lib = getLocalLibrary();
      const t = lib.getSavedTrack?.(trackId);
      if (!t) return;

      if (clickedCover) {
        toggleOrPlayTrack(t);
        return;
      }

      const albumId = Number(t?.album?.id || t?.ALB_ID || t?.album_id || 0);
      if (Number.isFinite(albumId) && albumId > 0) {
        window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
        return;
      }

      // Last-resort: fetch track metadata to recover album id.
      if (window.dz?.getTrack && typeof window.dz.getTrack === "function" && Number.isFinite(trackId) && trackId > 0) {
        window.dz
          .getTrack({ id: trackId })
          .then((res) => {
            const t2 = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
            const n = Number(t2?.album?.id || t2?.ALB_ID || t2?.album_id || t2?.data?.ALB_ID || 0);
            if (!Number.isFinite(n) || n <= 0) return;
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(n), scrollTop: 0 });
          })
          .catch(() => {});
      }
      return;
    }
    if (item.dataset.route === "downloaded-track") {
      const trackId = Number(item.dataset.trackId);
      if (!Number.isFinite(trackId) || trackId <= 0) return;
      const lib = getLocalLibrary();
      const st = lib.load?.() || {};
      const downloaded = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      const row = downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;
      if (!row) return;
      const fileUrl = String(row?.download?.fileUrl || "").trim();
      if (!fileUrl) return;
      const cover = String(row?.albumCover || "").trim();
      const artistId = Number(row?.artistId) || (row?.trackJson?.artist?.id ? Number(row.trackJson.artist.id) : null);
      const albumId = Number(row?.albumId) || (row?.trackJson?.album?.id ? Number(row.trackJson.album.id) : null);
      const t = {
        id: trackId,
        title: String(row?.title || ""),
        duration: Number(row?.duration) || 0,
        explicit_lyrics: Boolean(row?.explicit),
        artist: { id: artistId || null, name: String(row?.artist || "") },
        album: {
          id: albumId || null,
          title: String(row?.albumTitle || ""),
          cover_small: cover,
          cover_medium: cover,
          cover: cover,
        },
        ...(cover ? { cover } : {}),
        ...(row?.download && typeof row.download === "object" ? { download: { ...row.download } } : {}),
        trackJson: row?.trackJson || null,
      };
      if (clickedCover) {
        toggleOrPlayTrack(t);
        return;
      }

      if (Number.isFinite(albumId) && albumId > 0) {
        window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
        return;
      }

      // Last-resort: fetch track metadata to recover album id.
      if (window.dz?.getTrack && typeof window.dz.getTrack === "function") {
        window.dz
          .getTrack({ id: trackId })
          .then((res) => {
            const t2 = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
            const n = Number(t2?.album?.id || t2?.ALB_ID || t2?.album_id || t2?.data?.ALB_ID || 0);
            if (!Number.isFinite(n) || n <= 0) return;
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(n), scrollTop: 0 });
          })
          .catch(() => {});
      }
      return;
    }

    const entityType = item.dataset.entityType;
    const entityId = item.dataset.entityId;
    if (entityType && entityId) {
      if (clickedCover && window.__player && window.__player?.setQueueAndPlay && (entityType === "album" || entityType === "playlist" || entityType === "smarttracklist")) {
        if (entityType === "album") {
          const st = window.__player?.getState?.() || {};
          const curTrack = st?.track && typeof st.track === "object" ? st.track : null;
          const curAlbumId = Number(
            curTrack?.album?.id ||
              curTrack?.albumId ||
              curTrack?.ALB_ID ||
              curTrack?.album_id ||
              curTrack?.raw?.album?.id ||
              curTrack?.raw?.albumId ||
              curTrack?.raw?.ALB_ID ||
              0,
          );
          const thisAlbumId = Number(entityId);
          const sameAlbum = Number.isFinite(curAlbumId) && Number.isFinite(thisAlbumId) && curAlbumId > 0 && curAlbumId === thisAlbumId;
          if (sameAlbum && typeof window.__player.togglePlayPause === "function") {
            void window.__player.togglePlayPause();
            return;
          }
        }

        const fetchTracklist = async () => {
          const type = String(entityType || "").trim();
          const id = String(entityId || "").trim();
          if (!type || !id) return null;

          // Prefer local/offline tracklists first so we can play the first available downloaded track.
          if (window.dl?.getOfflineTracklist) {
            try {
              const r = await window.dl.getOfflineTracklist({ type, id });
              const data = r?.data && typeof r.data === "object" ? r.data : null;
              const tracks = type === "artist" ? data?.topTracks : data?.tracks;
              if (r?.ok && data && Array.isArray(tracks) && tracks.length > 0) return r;
            } catch {}
          }

          if (window.__authHasARL && window.dz?.getTracklist) {
            try {
              const r = await window.dz.getTracklist({ type, id });
              if (r?.ok && r?.data) return r;
            } catch {}
          }

          return null;
        };

        void fetchTracklist().then((res) => {
          const data = res?.data && typeof res.data === "object" ? res.data : null;
          const tracks =
            entityType === "artist"
              ? Array.isArray(data?.topTracks)
                ? data.topTracks
                : []
              : Array.isArray(data?.tracks)
                ? data.tracks
                : [];
          if (tracks.length === 0) return;
          const eId = Number(entityId);
          const canContext = (entityType === "playlist" || entityType === "album") && Number.isFinite(eId) && eId > 0;
          const context = canContext
            ? { type: entityType, id: eId, title: String(data?.title || ""), cover: String(data?.cover_medium || data?.picture_medium || data?.cover || data?.picture || "") }
            : null;
          void window.__player.setQueueAndPlay(tracks, 0, context ? { context } : undefined);
        });
        return;
      }

      window.__spotifyNav?.navigate?.({ name: "entity", entityType, id: entityId });
    }
  });

  const getSortMode = () => String(localStorage.getItem(SORT_KEY) || "recent");
  const applyLibraryView = () => applyLibraryViewMode({ contentRoot, list, mode: getLibraryViewMode() });

  const applyLibrarySort = () => {
    const mode = getSortMode();
    const items = Array.from(list.querySelectorAll(".library-item"));
    if (items.length <= 1) return;

    const pinnedRoutes = new Set(["liked", "downloads"]);
    const pinned = items.filter((it) => pinnedRoutes.has(String(it.dataset.route || "")));

    // Separate folder children from sortable top-level items
    const folderChildren = items.filter((it) => it.classList.contains("is-folder-child"));
    const topLevel = items.filter((it) => !pinnedRoutes.has(String(it.dataset.route || "")) && !it.classList.contains("is-folder-child"));

    // Group folder children by parent folder ID
    const childrenByFolder = new Map();
    for (const ch of folderChildren) {
      const pid = ch.dataset.parentFolderId || "";
      if (!pid) continue;
      if (!childrenByFolder.has(pid)) childrenByFolder.set(pid, []);
      childrenByFolder.get(pid).push(ch);
    }

    const num = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    // Rebuild list: pinned → sorted top-level (with folder children inserted after their parent)
    const rebuildList = (sorted) => {
      list.innerHTML = "";
      for (const it of pinned) list.appendChild(it);
      for (const it of sorted) {
        list.appendChild(it);
        // If this is a folder, append its children right after
        const fid = it.dataset.folderId || "";
        if (fid && childrenByFolder.has(fid)) {
          for (const ch of childrenByFolder.get(fid)) list.appendChild(ch);
        }
      }
    };

    if (mode === "recent" || mode === "recently-added") {
      const key = mode === "recent" ? "sortRecent" : "sortAdded";
      topLevel.sort((a, b) => num(b.dataset[key]) - num(a.dataset[key]));
      rebuildList(topLevel);
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
      topLevel.sort((a, b) => keyFor(a).localeCompare(keyFor(b)));
      rebuildList(topLevel);
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

  wireLibraryRecentsMenu({
    recentsBtn,
    getSortMode,
    getLibraryViewMode,
    applySortAndView,
    sortKey: SORT_KEY,
    viewKey: VIEW_KEY,
  });
  applySortAndView();


  const refresh = async () => {
    clearLibraryMotionStyles(list);

    // Grid views use a different layout model (rows/cols). The sidebar FLIP animation is tuned for a single-column list
    // and can cause brief-but-confusing overlap while transforms are active, so we skip it for grid modes.
    const viewMode = getLibraryViewMode();
    if (isLibraryGridViewMode(viewMode)) {
      await renderLibraryLocal();
      applySortAndView();
      return;
    }

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

  let refreshTimer = 0;
  const scheduleRefresh = (delayMs = 90) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      refreshTimer = 0;
      void refresh();
    }, Math.max(0, Number(delayMs) || 0));
  };

  // ── Folder collapse/expand ─────────────────────────────────────
  const lib = getLocalLibrary();
  const FOLDER_EXPAND_KEY = "spotify.folderExpandState";

  const toggleFolderExpand = (folderId) => {
    try {
      const raw = localStorage.getItem(FOLDER_EXPAND_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed[folderId] = !parsed[folderId];
      localStorage.setItem(FOLDER_EXPAND_KEY, JSON.stringify(parsed));
    } catch {}
    scheduleRefresh(0);
  };

  list.addEventListener("click", (e) => {
    const chevron = e.target?.closest?.(".library-item__chevron");
    if (!chevron) return;
    e.preventDefault();
    e.stopPropagation();
    const item = chevron.closest(".library-item");
    const folderId = item?.dataset?.folderId;
    if (folderId) toggleFolderExpand(folderId);
  });

  // ── Drag-and-drop into/out-of folders ─────────────────────────
  const libraryDropZone = list;

  const isDraggableItem = (item) => {
    const route = String(item?.dataset?.route || "");
    if (route === "customPlaylist" && item.dataset.customPlaylistId) return true;
    const et = String(item?.dataset?.entityType || "");
    return et === "playlist" || et === "album";
  };

  const getDragPayload = (item) => {
    const route = String(item?.dataset?.route || "");
    if (route === "customPlaylist" && item.dataset.customPlaylistId) {
      return { type: "customPlaylist", id: String(item.dataset.customPlaylistId) };
    }
    const et = String(item?.dataset?.entityType || "");
    const eid = String(item?.dataset?.entityId || "");
    if ((et === "playlist" || et === "album") && eid) {
      return { type: et, id: eid };
    }
    return null;
  };

  const isFolderItem = (item) => {
    return String(item?.dataset?.route || "") === "folder" && Boolean(item?.dataset?.folderId);
  };

  let draggingFromFolder = "";

  const clearDragClasses = () => {
    for (const it of list.querySelectorAll(".library-item")) {
      it.classList.remove("is-dragging", "is-drag-over");
    }
    libraryDropZone?.classList?.remove?.("is-drag-over");
    draggingFromFolder = "";
  };

  list.addEventListener("dragstart", (e) => {
    const item = e.target?.closest?.(".library-item");
    if (!item || !isDraggableItem(item)) { e.preventDefault(); return; }
    const payload = getDragPayload(item);
    if (!payload) { e.preventDefault(); return; }
    // Include source folder if dragging out of a folder
    const fromFolderId = item.dataset.parentFolderId || "";
    if (fromFolderId) {
      payload.fromFolderId = fromFolderId;
      draggingFromFolder = fromFolderId;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(payload));
    item.classList.add("is-dragging");
  });

  list.addEventListener("dragend", () => clearDragClasses());

  list.addEventListener("dragover", (e) => {
    const item = e.target?.closest?.(".library-item");
    if (!item || !isFolderItem(item)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    for (const it of list.querySelectorAll(".library-item.is-drag-over")) {
      if (it !== item) it.classList.remove("is-drag-over");
    }
    libraryDropZone?.classList?.remove?.("is-drag-over");
    item.classList.add("is-drag-over");
  });

  list.addEventListener("dragleave", (e) => {
    const item = e.target?.closest?.(".library-item");
    if (!item) return;
    const rect = item.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      item.classList.remove("is-drag-over");
    }
  });

  list.addEventListener("drop", (e) => {
    e.preventDefault();
    const folderItem = e.target?.closest?.(".library-item");
    if (!folderItem || !isFolderItem(folderItem)) return;
    const targetFolderId = String(folderItem.dataset.folderId);
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
    if (!payload?.type || !payload?.id) return;
    // If moving from one folder to another, remove from source first
    if (payload.fromFolderId && payload.fromFolderId !== targetFolderId) {
      lib.removeChildFromFolder?.(payload.fromFolderId, { type: payload.type, id: payload.id });
    }
    lib.addChildToFolder?.(targetFolderId, { type: payload.type, id: payload.id });
    clearDragClasses();
    // Live-refresh the folder page if it's currently being viewed
    try {
      const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
      if (String(route?.name || "") === "folder" && String(route?.id || "") === targetFolderId) {
        window.__spotifyNav?.navigate?.({ name: "folder", id: targetFolderId, refresh: true }, { replace: true });
      }
    } catch {}
  });

  // Library list itself as drop zone (drag out of folder → top-level)
  const isInSourceFolder = (item) => {
    if (!item || !draggingFromFolder) return false;
    return item.dataset.parentFolderId === draggingFromFolder || item.dataset.folderId === draggingFromFolder;
  };

  list.addEventListener("dragover", (e) => {
    if (!draggingFromFolder) return;
    const item = e.target?.closest?.(".library-item");
    // Skip if hovering a folder target or a sibling inside the same source folder
    if (item && (isFolderItem(item) || isInSourceFolder(item))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    for (const it of list.querySelectorAll(".library-item.is-drag-over")) {
      it.classList.remove("is-drag-over");
    }
    libraryDropZone.classList.add("is-drag-over");
  });
  list.addEventListener("dragleave", (e) => {
    const rect = list.getBoundingClientRect();
    const x = e.clientX, y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      libraryDropZone.classList.remove("is-drag-over");
    }
  });
  list.addEventListener("drop", (e) => {
    if (!draggingFromFolder) return;
    const folderItem = e.target?.closest?.(".library-item");
    if (folderItem && (isFolderItem(folderItem) || isInSourceFolder(folderItem))) return;
    e.preventDefault();
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); } catch {}
    if (!payload?.type || !payload?.id) return;
    if (payload.fromFolderId) {
      lib.removeChildFromFolder?.(payload.fromFolderId, { type: payload.type, id: payload.id });
    }
    clearDragClasses();
  });

  // Make items draggable via mutation observer (new items added dynamically)
  const setDraggable = () => {
    for (const item of list.querySelectorAll(".library-item")) {
      item.draggable = isDraggableItem(item);
    }
  };
  setDraggable();
  const dragObserver = new MutationObserver(() => setDraggable());
  dragObserver.observe(list, { childList: true, subtree: false });

  void refresh();
  window.addEventListener("local-library:changed", () => scheduleRefresh());
  if (window.dl?.onEvent) {
    window.dl.onEvent((payload) => {
      const event = String(payload?.event || "");
      if (event === "downloadFinished" || event === "downloadFailed" || event === "downloadCancelled") scheduleRefresh(40);
    });
  }
}
