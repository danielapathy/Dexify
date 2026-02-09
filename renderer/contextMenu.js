import { getLocalLibrary } from "./localLibrary.js";
import { createMenuRoot, hideMenu, isOpen, positionMenu, renderMenu } from "./contextMenu/menuDom.js";
import { resolvePageContext } from "./contextMenu/pageContext.js";
import { createContextMenuBuilders } from "./contextMenu/menuBuilders.js";
import { registerTrackList as registerTrackListInStore, resolveTrackListFromRow as resolveTrackListFromRowInStore, getTrackListInfoFromRow } from "./contextMenu/tracklistStore.js";
import {
  extractTrackMetaFromRow,
  resolveTrackFromRow as resolveTrackFromRowWithInfo,
} from "./contextMenu/trackResolver.js";

export function registerTrackList(listEl, tracks, options) {
  return registerTrackListInStore(listEl, tracks, options);
}

export function resolveTrackListFromRow(row) {
  return resolveTrackListFromRowInStore(row);
}

export function resolveTrackFromRow(row) {
  return resolveTrackFromRowWithInfo(row, { getTrackListInfoFromRow });
}

export function wireContextMenus() {
  const root = createMenuRoot();
  const lib = getLocalLibrary();

  // Register with global dropdown system
  if (!window.__dropdownMenus) window.__dropdownMenus = new Set();

  const closeAllDropdowns = (except) => {
    for (const closeFunc of window.__dropdownMenus) {
      if (closeFunc !== except) closeFunc();
    }
  };

  const close = () => hideMenu(root);
  window.__dropdownMenus.add(close);

  document.addEventListener("click", (event) => {
    if (!isOpen(root)) return;
    if (root.contains(event.target)) return;
    close();
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen(root)) return;
    if (event.key === "Escape") close();
  });

  window.addEventListener(
    "scroll",
    () => {
      if (isOpen(root)) close();
    },
    true,
  );

  window.addEventListener("blur", () => {
    if (isOpen(root)) close();
  });

  // Close context menu on ANY navigation event
  window.addEventListener("nav:viewChanged", () => {
    if (isOpen(root)) close();
  });

  // Close on mousedown anywhere outside (fires before click, catches navigation buttons)
  document.addEventListener("mousedown", (event) => {
    if (!isOpen(root)) return;
    if (root.contains(event.target)) return;
    close();
  }, true);

  const show = ({ x, y, items }) => {
    closeAllDropdowns(close);
    renderMenu(root, items);
    positionMenu(root, { x, y });
    try {
      root.focus();
    } catch {}
  };

  const { buildTrackMenu, buildCardMenu } = createContextMenuBuilders({ lib });

  try {
    window.__contextMenu = {
      openTrackMenu: async ({ track, x, y, context } = {}) => {
        const items = await buildTrackMenu({ track, context: String(context || resolvePageContext()) });
        if (items.length > 0) show({ x: Number(x) || 0, y: Number(y) || 0, items });
      },
      openEntityMenu: async ({ entityType, id, x, y } = {}) => {
        const et = String(entityType || "").trim();
        const eid = String(id || "").trim();
        if (!et || !eid) return;
        const items = await buildCardMenu({ card: { dataset: { entityType: et, entityId: eid } } });
        if (items.length > 0) show({ x: Number(x) || 0, y: Number(y) || 0, items });
      },
      close: () => close(),
    };
  } catch {}

  document.addEventListener(
    "contextmenu",
    async (event) => {
      const row = event.target?.closest?.(".entity-track, .search-track");
      const suggest = event.target?.closest?.(".search-suggest");
      const quick = event.target?.closest?.(".quick-card");
      const libItem = event.target?.closest?.(".library-item");
      const card = event.target?.closest?.(".big-card");
      const downloadCard = event.target?.closest?.(".download-card");

      if (!row && !suggest && !quick && !libItem && !card && !downloadCard) return;
      
      // Don't handle context menu on buttons within download cards
      if (downloadCard && event.target?.closest?.("button")) return;
      
      event.preventDefault();
      event.stopPropagation();

      if (row) {
        const track = resolveTrackFromRow(row);
        const route = resolvePageContext();
        const context = route === "downloads" ? "downloads" : route === "liked" ? "liked" : route;
        const items = await buildTrackMenu({ track, context });
        if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        return;
      }

      if (quick) {
        const t = quick.__payload || extractTrackMetaFromRow(quick) || null;
        const context = resolvePageContext();
        const items = await buildTrackMenu({ track: t, context });
        if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        return;
      }

      if (suggest) {
        const kind = String(suggest.dataset.kind || "");
        if (kind === "track") {
          const t = suggest.__payload;
          const items = await buildTrackMenu({ track: t, context: "searchPopover" });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        } else if (kind === "album" || kind === "artist" || kind === "playlist") {
          const payload = suggest.__payload;
          const id = String(payload?.id || "").trim();
          const nextEntityType = String(payload?.entityType || kind).trim();
          if (id && nextEntityType) {
            const items = await buildCardMenu({ card: { dataset: { entityType: nextEntityType, entityId: id } } });
            if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
          }
        }
        return;
      }

      if (libItem) {
        const route = String(libItem.dataset.route || "");
        if (route === "saved-track") {
          const trackId = Number(libItem.dataset.trackId);
          const t = lib.getSavedTrack?.(trackId);
          const items = await buildTrackMenu({ track: t || { id: trackId }, context: "library" });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        }

        const nextEntityType = String(libItem.dataset.entityType || "").trim();
        const nextEntityId = String(libItem.dataset.entityId || "").trim();
        if (nextEntityType && nextEntityId) {
          const items = await buildCardMenu({ card: libItem });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        }
        return;
      }

      if (card) {
        const items = await buildCardMenu({ card });
        if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        return;
      }

      if (downloadCard) {
        const trackId = Number(downloadCard.dataset.trackId);
        const albumId = Number(downloadCard.dataset.albumId);
        const playlistId = Number(downloadCard.dataset.playlistId);
        const artistId = Number(downloadCard.dataset.artistId);
        const title = String(downloadCard.dataset.title || "");
        const artist = String(downloadCard.dataset.artist || "");
        const albumTitle = String(downloadCard.dataset.albumTitle || "");

        const hasTrackId = Number.isFinite(trackId) && trackId > 0;
        const hasAlbumId = Number.isFinite(albumId) && albumId > 0;
        const hasPlaylistId = Number.isFinite(playlistId) && playlistId > 0;
        const hasArtistId = Number.isFinite(artistId) && artistId > 0;

        // DOM-based context: notifications cards should never get downloads/liked multi-select behavior
        const isInNotificationsView = Boolean(downloadCard.closest("#mainViewNotifications"));
        const actualContext = isInNotificationsView ? "notifications" : resolvePageContext();

        if (hasTrackId) {
          const track = {
            id: trackId,
            title,
            artist: { id: hasArtistId ? artistId : null, name: artist },
            album: { id: hasAlbumId ? albumId : null, title: albumTitle },
          };
          const items = await buildTrackMenu({ track, context: actualContext });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        } else if (hasAlbumId) {
          const items = await buildCardMenu({ card: { dataset: { entityType: "album", entityId: String(albumId) } } });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        } else if (hasPlaylistId) {
          const items = await buildCardMenu({ card: { dataset: { entityType: "playlist", entityId: String(playlistId) } } });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        } else if (hasArtistId) {
          const items = await buildCardMenu({ card: { dataset: { entityType: "artist", entityId: String(artistId) } } });
          if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
        }
      }
    },
    true,
  );
}
