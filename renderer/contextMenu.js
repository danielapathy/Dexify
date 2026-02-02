import { parseTarget } from "./deezerImages.js";
import { getLocalLibrary } from "./localLibrary.js";
import { normalizeRecordType } from "./utils.js";

const TRACKLISTS = new WeakMap();
const TRACK_META_CACHE = new Map();

function splitBulletParts(text) {
  return String(text || "")
    .split("•")
    .map((p) => String(p || "").trim())
    .filter(Boolean);
}

function isDownloadStatusPart(part) {
  const s = String(part || "").trim();
  if (!s) return false;
  if (/^downloaded$/i.test(s)) return true;
  if (/^\d+\s*\/\s*\d+\s+downloaded$/i.test(s)) return true;
  return false;
}

export function registerTrackList(listEl, tracks, { pageContext } = {}) {
  const el = listEl && listEl.nodeType === 1 ? listEl : null;
  if (!el) return;
  const rows = Array.isArray(tracks) ? tracks : [];
  TRACKLISTS.set(el, { tracks: rows, pageContext: String(pageContext || "") });
  el.dataset.cmTracklist = "1";
}

async function fetchTrackMeta(trackId) {
  const id = Number(trackId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const key = String(id);
  const cached = TRACK_META_CACHE.get(key);
  if (cached && typeof cached === "object" && cached.track && Date.now() - (cached.at || 0) < 10 * 60 * 1000) {
    return cached.track;
  }
  if (!window.dz?.getTrack) return null;
  try {
    const res = await window.dz.getTrack({ id });
    const track = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
    if (track) TRACK_META_CACHE.set(key, { at: Date.now(), track });
    return track;
  } catch {
    return null;
  }
}

function getTrackListInfoFromRow(row) {
  const r = row && row.nodeType === 1 ? row : null;
  if (!r) return null;
  const listEl = r.closest?.('[data-cm-tracklist="1"]');
  if (!listEl) return null;
  return TRACKLISTS.get(listEl) || null;
}

export function resolveTrackListFromRow(row) {
  const info = getTrackListInfoFromRow(row);
  const idx = Number(row?.dataset?.trackIndex);
  const tracks = Array.isArray(info?.tracks) ? info.tracks : [];
  const index = Number.isFinite(idx) && idx >= 0 ? idx : -1;
  return { tracks, index, pageContext: String(info?.pageContext || "") };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function buildItem({ label, icon, rightIcon, disabled, danger, onClick }) {
  return { label, icon, rightIcon, disabled: Boolean(disabled), danger: Boolean(danger), onClick };
}

function createMenuRoot() {
  const root = document.createElement("div");
  root.id = "contextMenu";
  root.className = "context-menu";
  root.hidden = true;
  root.tabIndex = -1;
  document.body.appendChild(root);
  return root;
}

function renderMenu(root, items) {
  const rows = Array.isArray(items) ? items : [];
  root.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "context-menu__panel";

  for (const it of rows) {
    if (!it) continue;
    if (it.kind === "sep") {
      const sep = document.createElement("div");
      sep.className = "context-menu__sep";
      panel.appendChild(sep);
      continue;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `context-menu__item${it.danger ? " is-danger" : ""}`;
    btn.disabled = Boolean(it.disabled);

    btn.innerHTML = `
      <span class="context-menu__icon">${it.icon ? `<i class="${it.icon}" aria-hidden="true"></i>` : ""}</span>
      <span class="context-menu__label">${String(it.label || "")}</span>
      <span class="context-menu__right">${it.rightIcon ? `<i class="${it.rightIcon}" aria-hidden="true"></i>` : ""}</span>
    `;

    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof it.onClick === "function") await it.onClick();
      hideMenu(root);
    });

    panel.appendChild(btn);
  }

  root.appendChild(panel);
}

function positionMenu(root, { x, y }) {
  const pad = 10;
  root.style.left = "0px";
  root.style.top = "0px";
  root.hidden = false;

  const panel = root.querySelector(".context-menu__panel");
  const rect = panel?.getBoundingClientRect?.();
  const w = rect?.width || 280;
  const h = rect?.height || 200;

  const vw = window.innerWidth || 800;
  const vh = window.innerHeight || 600;

  const left = clamp(Math.round(x), pad, Math.max(pad, vw - w - pad));
  const top = clamp(Math.round(y), pad, Math.max(pad, vh - h - pad));
  root.style.left = `${left}px`;
  root.style.top = `${top}px`;
}

function hideMenu(root) {
  root.hidden = true;
  root.style.removeProperty("left");
  root.style.removeProperty("top");
  root.innerHTML = "";
}

function isOpen(root) {
  return !root.hidden;
}

function normalizeTrackFromAny(source) {
  const t = source && typeof source === "object" ? source : null;
  if (!t) return null;
  const id = Number(t?.id || t?.SNG_ID);
  if (!Number.isFinite(id) || id <= 0) return null;
  return t;
}

function getAlbumIdFromTrack(t) {
  const track = normalizeTrackFromAny(t);
  if (!track) return null;
  const id =
    track?.album?.id ||
    track?.ALB_ID ||
    track?.ALBUM_ID ||
    track?.album_id ||
    track?.data?.ALB_ID ||
    null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getArtistIdFromTrack(t) {
  const track = normalizeTrackFromAny(t);
  if (!track) return null;
  const id = track?.artist?.id || track?.ART_ID || track?.artist_id || track?.data?.ART_ID || null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractTrackMetaFromRow(row) {
  const root = row && row.nodeType === 1 ? row : null;
  if (!root) return null;
  const trackId = Number(root.dataset.trackId);
  if (!Number.isFinite(trackId) || trackId <= 0) return null;

  const title =
    String(root.querySelector(".entity-track__title")?.textContent || root.querySelector(".search-track__title")?.textContent || "").trim() ||
    "Track";
  const artist =
    String(root.querySelector(".entity-track__artist")?.textContent || root.querySelector(".search-track__subtitle")?.textContent || "").trim();
  const coverSrc =
    root.querySelector(".entity-track__cover img")?.getAttribute?.("src") ||
    root.querySelector(".search-track__cover img")?.getAttribute?.("src") ||
    "";

  const albumId = Number(root.dataset.albumId);
  const cleanAlbumId = Number.isFinite(albumId) && albumId > 0 ? albumId : null;
  const artistId = Number(root.dataset.artistId);
  const cleanArtistId = Number.isFinite(artistId) && artistId > 0 ? artistId : null;

  const t = {
    id: trackId,
    title,
    artist: { id: cleanArtistId, name: artist },
    album: cleanAlbumId || coverSrc ? { id: cleanAlbumId, cover_medium: coverSrc, cover_small: coverSrc, cover: coverSrc } : undefined,
  };
  return t;
}

export function resolveTrackFromRow(row) {
  const fromDom = extractTrackMetaFromRow(row);
  const idx = Number(row?.dataset?.trackIndex);
  const info = getTrackListInfoFromRow(row);
  const list = Array.isArray(info?.tracks) ? info.tracks : [];
  const fromList = Number.isFinite(idx) && idx >= 0 ? normalizeTrackFromAny(list[idx]) : null;

  if (!fromDom) return fromList;
  if (!fromList) return fromDom;

  const albumId = getAlbumIdFromTrack(fromList) || getAlbumIdFromTrack(fromDom);
  const artistId = getArtistIdFromTrack(fromList) || getArtistIdFromTrack(fromDom);

  const merged = { ...fromList };
  if (artistId) merged.artist = { ...(merged.artist || {}), id: artistId };
  if (albumId) merged.album = { ...(merged.album || {}), id: albumId };
  const cover = fromDom?.album?.cover_medium || fromDom?.album?.cover || "";
  if (cover) {
    merged.album = {
      ...(merged.album || {}),
      cover_medium: merged.album?.cover_medium || cover,
      cover_small: merged.album?.cover_small || cover,
      cover: merged.album?.cover || cover,
    };
  }
  return merged;
}

function resolvePageContext() {
  const r = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
  const name = String(r?.name || "").trim();
  if (name === "entity") {
    const et = String(r?.entityType || "").trim();
    return et || "entity";
  }
  if (name === "page") {
    const p = String(r?.page || "").trim();
    return p ? `page:${p}` : "page";
  }
  if (name) return name;
  return "unknown";
}

function refreshDownloadsIfVisible() {
  try {
    if (String(window.__navRoute?.name || "") !== "downloads") return;
    window.__spotifyNav?.navigate?.({ name: "downloads", refresh: true, scrollTop: 0 }, { replace: true });
  } catch {}
}

function refreshLikedIfVisible() {
  try {
    if (String(window.__navRoute?.name || "") !== "liked") return;
    window.__spotifyNav?.navigate?.({ name: "liked", refresh: true, scrollTop: 0 }, { replace: true });
  } catch {}
}

export function wireContextMenus() {
  const root = createMenuRoot();
  const lib = getLocalLibrary();

  const close = () => hideMenu(root);

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

  const show = ({ x, y, items }) => {
    renderMenu(root, items);
    positionMenu(root, { x, y });
    try {
      root.focus();
    } catch {}
  };

  const buildTrackMenu = async ({ track, context }) => {
    let t = normalizeTrackFromAny(track);
    if (!t) return [];
    const trackId = Number(t?.id || t?.SNG_ID);
    let albumId = getAlbumIdFromTrack(t);
    let artistId = getArtistIdFromTrack(t);

    // Some UI surfaces only have partial track objects (especially after navigating back to cached pages).
    // If we have an ID but are missing critical context like artist/album IDs, fetch it once and cache.
    if ((albumId == null || artistId == null) && window.dz?.getTrack) {
      const fetched = await fetchTrackMeta(trackId);
      if (fetched && typeof fetched === "object") {
        const merged = { ...fetched, ...t };

        const fetchedArtist =
          fetched?.artist && typeof fetched.artist === "object"
            ? fetched.artist
            : fetched?.ART_ID
              ? { id: Number(fetched.ART_ID) || null }
              : null;
        const fetchedAlbum =
          fetched?.album && typeof fetched.album === "object"
            ? fetched.album
            : fetched?.ALB_ID
              ? { id: Number(fetched.ALB_ID) || null }
              : null;

        if (t?.artist && typeof t.artist === "object") merged.artist = { ...(fetchedArtist || {}), ...t.artist };
        else if (fetchedArtist) merged.artist = fetchedArtist;

        if (t?.album && typeof t.album === "object") merged.album = { ...(fetchedAlbum || {}), ...t.album };
        else if (fetchedAlbum) merged.album = fetchedAlbum;

        t = merged;
        albumId = getAlbumIdFromTrack(t);
        artistId = getArtistIdFromTrack(t);
      }
    }
    const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";

    const resolved = window.dl?.resolveTrack ? await window.dl.resolveTrack({ id: trackId, quality }) : null;
    const gotQuality = resolved?.quality ? String(resolved.quality) : "";
    const isDownloadedAny = Boolean(resolved?.ok && resolved?.exists && resolved?.fileUrl);
    const isDownloadedPreferred = isDownloadedAny && gotQuality && String(gotQuality) === String(quality);

    const items = [];

    items.push(
      buildItem({
        label: "Add to queue",
        icon: "ri-add-line",
        onClick: async () => {
          try {
            window.__player?.enqueue?.([t]);
          } catch {}
        },
      }),
    );

    const liked = Boolean(lib.isTrackSaved?.(trackId));
    items.push(
      buildItem({
        label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: liked ? "ri-heart-fill" : "ri-heart-line",
        onClick: async () => {
          try {
            if (liked) lib.removeSavedTrack(trackId);
            else lib.addSavedTrack(t);
          } catch {}
          refreshLikedIfVisible();
        },
      }),
    );

    items.push({ kind: "sep" });

    if (albumId) {
      items.push(
        buildItem({
          label: "Go to album",
          icon: "ri-album-line",
          onClick: async () => {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
          },
        }),
      );
    }

    if (artistId) {
      items.push(
        buildItem({
          label: "Go to artist",
          icon: "ri-user-3-line",
          onClick: async () => {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "artist", id: String(artistId), scrollTop: 0 });
          },
        }),
      );
    }

    items.push(
      buildItem({
        label: isDownloadedPreferred ? "Downloaded" : "Download song",
        icon: "ri-download-2-line",
        disabled: isDownloadedPreferred,
        onClick: async () => {
          if (!window.dl?.downloadTrack) return;
          const uuid = `dl_${trackId}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
          const payload = { id: trackId, quality, uuid, ...(t && typeof t === "object" ? { track: t, album: t?.album || null } : {}) };
          await window.dl.downloadTrack(payload);
          try {
            await window.dl?.scanLibrary?.();
          } catch {}
          refreshDownloadsIfVisible();
        },
      }),
    );

    if (context === "downloads") {
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Delete download",
          icon: "ri-delete-bin-6-line",
          danger: true,
          disabled: !isDownloadedAny,
          onClick: async () => {
            if (!window.dl?.deleteFromDisk) return;
            const ok = await window.dl.deleteFromDisk({ id: trackId });
            try {
              await window.dl?.scanLibrary?.();
            } catch {}
            try {
              lib.removeDownloadedTrack?.(trackId);
            } catch {}
            try {
              window.__downloadsUI?.removeTrack?.(trackId);
            } catch {}
            if (!ok?.ok) refreshDownloadsIfVisible();
          },
        }),
      );
    }

    if (context === "recents") {
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Remove from Recents",
          icon: "ri-eye-off-line",
          onClick: async () => {
            try {
              lib.removeRecentTrack?.(trackId);
            } catch {}
          },
        }),
      );
    }

    return items;
  };

  const buildCardMenu = async ({ card }) => {
    const target = String(card?.dataset?.target || "");
    const entityType = String(card?.dataset?.entityType || "");
    const entityId = String(card?.dataset?.entityId || "");
    const parsed = target ? parseTarget(target) : null;

    const quality = localStorage.getItem("spotify.downloadQuality") || "mp3_128";

    const asEntityType = parsed?.kind || (entityType ? entityType : "");
    const asEntityId = parsed?.id || (entityId ? entityId : "");

    if (asEntityType === "album" || asEntityType === "playlist" || asEntityType === "artist" || asEntityType === "smarttracklist") {
      const rootEl = card && card.nodeType === 1 ? card : null;
      const metaTitle = String(rootEl?.querySelector?.(".big-card__title, .library-item__title")?.textContent || "").trim();
      const metaSubtitle = String(rootEl?.querySelector?.(".big-card__subtitle, .library-item__subtitle")?.textContent || "").trim();
      const metaCover = String(rootEl?.querySelector?.(".big-card__cover img, img.cover--img")?.getAttribute?.("src") || "").trim();

	      const toSavedPayload = () => {
	        const idNum = Number(asEntityId);
	        if (!Number.isFinite(idNum) || idNum <= 0) return null;
	        if (asEntityType === "album") {
	          const parts = splitBulletParts(metaSubtitle);
	          const rt0 = normalizeRecordType(parts[0]);
	          const recordType = rt0 === "album" || rt0 === "single" || rt0 === "ep" || rt0 === "compilation" ? rt0 : "";
	          const filtered = parts.filter((p, i) => !(i === 0 && recordType) && !isDownloadStatusPart(p));
	          const artist = filtered.length > 0 ? filtered[filtered.length - 1] : "";
	          return {
	            id: idNum,
	            title: metaTitle,
	            artist: artist ? { name: artist } : undefined,
	            record_type: recordType || undefined,
	            cover_medium: metaCover,
	            cover: metaCover,
	          };
	        }
	        if (asEntityType === "playlist") {
	          const parts = splitBulletParts(metaSubtitle);
	          const filtered = parts.filter((p) => !isDownloadStatusPart(p));
	          const creator = filtered.length > 0 ? filtered[filtered.length - 1] : "";
	          return { id: idNum, title: metaTitle, creator: creator ? { name: creator } : undefined, picture_medium: metaCover, picture: metaCover };
	        }
	        return null;
	      };

      const items = [];
      const kindLabel =
        asEntityType === "artist"
          ? "artist"
          : asEntityType === "album"
            ? "album"
            : asEntityType === "playlist"
              ? "playlist"
              : "item";
      items.push(
        buildItem({
          label:
            asEntityType === "artist"
              ? "Go to artist"
              : asEntityType === "album"
                ? "Go to album"
                : asEntityType === "playlist"
                  ? "Go to playlist"
                  : `Open ${kindLabel}`,
          icon: asEntityType === "artist" ? "ri-user-3-line" : asEntityType === "album" ? "ri-album-line" : "ri-external-link-line",
          onClick: async () => {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: asEntityType, id: String(asEntityId), scrollTop: 0 });
          },
        }),
      );

      if (asEntityType === "album" || asEntityType === "playlist") {
        items.push({ kind: "sep" });
        const idNum = Number(asEntityId);
        const isSaved =
          Number.isFinite(idNum) && idNum > 0
            ? asEntityType === "album"
              ? Boolean(lib.isAlbumSaved?.(idNum))
              : Boolean(lib.isPlaylistSaved?.(idNum))
            : false;
        items.push(
          buildItem({
            label: isSaved ? "Remove from Your Library" : "Save to Your Library",
            icon: isSaved ? "ri-check-line" : "ri-add-line",
            onClick: async () => {
              const payload = toSavedPayload();
              if (!payload) return;
              try {
                if (isSaved) {
                  if (asEntityType === "album") lib.removeSavedAlbum?.(payload.id);
                  else lib.removeSavedPlaylist?.(payload.id);
                } else {
                  if (asEntityType === "album") lib.addSavedAlbum?.(payload);
                  else lib.addSavedPlaylist?.(payload);
                }
              } catch {}
            },
          }),
        );
        items.push({ kind: "sep" });
        items.push(
          buildItem({
            label: "Download",
            icon: "ri-download-2-line",
            onClick: async () => {
              if (!window.dl?.downloadUrl) return;
              try {
                const payload = toSavedPayload();
                if (payload) {
                  if (asEntityType === "album") lib.markAlbumDownloaded?.(payload);
                  else lib.markPlaylistDownloaded?.(payload);
                }
              } catch {}
              await window.dl.downloadUrl({ url: `https://www.deezer.com/${asEntityType}/${asEntityId}`, quality });
            },
          }),
        );
      }
      return items;
    }

    if (parsed?.kind === "track") {
      const id = Number(parsed.id);
      if (!Number.isFinite(id) || id <= 0) return [];
      const title = String(card.querySelector(".big-card__title")?.textContent || "").trim();
      const artist = String(card.querySelector(".big-card__subtitle")?.textContent || "").trim();
      const cover = String(card.querySelector(".big-card__cover img")?.getAttribute?.("src") || "").trim();
      const artistId = Number(card?.dataset?.artistId || 0);
      const albumId = Number(card?.dataset?.albumId || 0);
      return buildTrackMenu({
        track: {
          id,
          title,
          artist: { id: Number.isFinite(artistId) && artistId > 0 ? artistId : null, name: artist },
          album: cover
            ? { id: Number.isFinite(albumId) && albumId > 0 ? albumId : null, cover_medium: cover, cover_small: cover, cover: cover }
            : undefined,
        },
        context: resolvePageContext(),
      });
    }

    return [];
  };

  // Centralized API for callers that already have the JSON context and just want the
  // correct menu for that element type.
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

      if (!row && !suggest && !quick && !libItem && !card) return;
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
        const entityType = String(payload?.entityType || kind).trim();
        if (id && entityType) {
          const items = await buildCardMenu({ card: { dataset: { entityType, entityId: id } } });
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
      const entityType = String(libItem.dataset.entityType || "").trim();
      const entityId = String(libItem.dataset.entityId || "").trim();
      if (entityType && entityId) {
        const items = await buildCardMenu({ card: libItem });
        if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
      }
      return;
    }

    if (card) {
      const items = await buildCardMenu({ card });
      if (items.length > 0) show({ x: event.clientX, y: event.clientY, items });
    }
    },
    true,
  );
}
