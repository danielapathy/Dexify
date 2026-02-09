import { getLocalLibrary } from "../localLibrary.js";
import { createNotificationsStore } from "./store.mjs";
import { createNotificationsView } from "./view.mjs";

function resolvePlayerTrackId() {
  try {
    const st = window.__player?.getState?.();
    const raw = st?.track;
    const id = Number(raw?.id || raw?.SNG_ID);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function wireNotifications() {
  const btn = document.getElementById("notificationsBtn");
  const icon = btn?.querySelector?.("i");
  const viewRoot = document.getElementById("notificationsView");
  if (!btn || !viewRoot) return;

  const lib = getLocalLibrary();
  const store = createNotificationsStore({ lib });
  let downloadedSnapshot = null;
  let displayedByUuid = new Map();
  const playlistMetaById = new Map(); // playlistId -> { title, cover }
  const playlistMetaInFlight = new Set();
  const playlistMetaFailed = new Set();

  const readDownloadedSnapshot = () => {
    if (downloadedSnapshot) return downloadedSnapshot;
    try {
      const state = lib.load?.() || {};
      downloadedSnapshot =
        state?.downloadedTracks && typeof state.downloadedTracks === "object" ? state.downloadedTracks : {};
    } catch {
      downloadedSnapshot = {};
    }
    return downloadedSnapshot;
  };
  const parsePlaylistIdFromUuid = (uuidRaw) => {
    const uuid = String(uuidRaw || "").trim();
    const m = uuid.match(/^playlist_(\d+)_track_/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const countDownloadedForAlbum = (albumId) => {
    const idNum = Number(albumId);
    if (!Number.isFinite(idNum) || idNum <= 0) return 0;
    try {
      const st = lib.load?.() || {};
      const downloaded = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      let count = 0;
      for (const row of Object.values(downloaded)) {
        const entry = row && typeof row === "object" ? row : null;
        if (!entry) continue;
        const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
        if (!fileUrl) continue;
        if (Number(entry?.albumId) === idNum) count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  };
  const countDownloadedForPlaylist = (playlistId) => {
    const idNum = Number(playlistId);
    if (!Number.isFinite(idNum) || idNum <= 0) return 0;
    try {
      const st = lib.load?.() || {};
      const downloaded = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      let count = 0;
      for (const row of Object.values(downloaded)) {
        const entry = row && typeof row === "object" ? row : null;
        if (!entry) continue;
        const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
        if (!fileUrl) continue;
        const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
        if (uuid.startsWith(`playlist_${idNum}_track_`)) count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  };
  const reconcileSavedEntitiesAfterTrackDelete = ({ albumId, playlistIds }) => {
    const aid = Number(albumId);
    if (Number.isFinite(aid) && aid > 0) {
      const remaining = countDownloadedForAlbum(aid);
      if (remaining <= 0) {
        try {
          if (lib.isAlbumSaved?.(aid)) lib.removeSavedAlbum?.(aid);
        } catch {}
      }
    }
    for (const pid0 of Array.isArray(playlistIds) ? playlistIds : []) {
      const pid = Number(pid0);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const remaining = countDownloadedForPlaylist(pid);
      if (remaining > 0) continue;
      try {
        if (lib.isPlaylistSaved?.(pid)) lib.removeSavedPlaylist?.(pid);
      } catch {}
    }
  };

  const resolveMediaState = (item) => {
    const trackId = Number(item?.trackId);
    const downloaded = readDownloadedSnapshot();
    const entry =
      Number.isFinite(trackId) && trackId > 0 && downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object"
        ? downloaded[String(trackId)]
        : null;
    const fileUrl = String(entry?.download?.fileUrl || "").trim();
    const coverUrl = String(entry?.albumCover || "").trim();
    const fileSize = Number(entry?.fileSize) || 0;
    return { hasLocalTrack: Boolean(fileUrl), coverUrl, fileSize };
  };

  const isViewActive = () => String(window.__navRoute?.name || "") === "notifications";

  const updateBellActive = () => {
    const routeName = String(window.__navRoute?.name || "");
    const active = routeName === "notifications";
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
    if (icon) {
      icon.classList.toggle("ri-notification-3-fill", active);
      icon.classList.toggle("ri-notification-3-line", !active);
    }
  };

  const setBadge = () => {
    if (isViewActive()) {
      btn.dataset.badge = "";
      return;
    }
    const active = store.getBadgeCount();
    btn.dataset.badge = active > 0 ? String(active) : "";
  };

  const formatMeta = (item) => {
    const status = String(item?.status || "");
    const statusPrefix = status === "failed" ? "Failed" : status === "cancelled" ? "Cancelled" : "";
    const kind = store.kindLabelFor(item);
    const when = store.formatRelativeTime(item?.updatedAt);
    return [statusPrefix || null, kind, when].filter(Boolean).join(" \u2022 ");
  };

  const view = createNotificationsView({
    rootEl: viewRoot,
    callbacks: {
      formatMeta,
      resolveMediaState,
      isLiked: (trackId) => Boolean(lib.isTrackSaved?.(trackId)),
      resolveOpenTarget: (item) => {
        const albumId = Number(item?.albumId);
        const playlistId = Number(item?.playlistId);
        const artistId = Number(item?.artistId);
        if (Number.isFinite(albumId) && albumId > 0) return { type: "album", id: albumId };
        if (Number.isFinite(playlistId) && playlistId > 0) return { type: "playlist", id: playlistId };
        if (Number.isFinite(artistId) && artistId > 0) return { type: "artist", id: artistId };

        // Best-effort fallback: derive albumId from local library cache when the notification payload is sparse.
        const trackId = Number(item?.trackId);
        if (!Number.isFinite(trackId) || trackId <= 0) return null;
        try {
          const st = lib.load?.() || {};
          const saved = st?.savedTracks && typeof st.savedTracks === "object" ? st.savedTracks[String(trackId)] : null;
          const dl = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks[String(trackId)] : null;
          const rawAlbumId = Number(saved?.album?.id || saved?.raw?.album?.id || dl?.albumId || dl?.trackJson?.album?.id);
          if (Number.isFinite(rawAlbumId) && rawAlbumId > 0) return { type: "album", id: rawAlbumId };
        } catch {}
        return null;
      },
      onClearAll: () => {
        try {
          store.clearHistory();
        } catch {}
        store.prune();
        setBadge();
        scheduleRender("fast");
      },
      onAction: async (payload) => {
        const action = String(payload?.action || "");
        const uuid = String(payload?.uuid || "");

        if (action === "open") {
          const type = String(payload?.type || "").trim();
          const id = String(payload?.id || "").trim();
          if (type && id) window.__spotifyNav?.navigate?.({ name: "entity", entityType: type, id, scrollTop: 0 });
          return;
        }

        const item = uuid ? displayedByUuid.get(uuid) || store.downloads.get(uuid) : null;
        if (!item) return;

        if (action === "dismiss") {
          const status = String(item.status || "");
          const isActive = store.isActiveStatus(status);

          if (isActive && typeof window.dl?.cancelDownload === "function") {
            const uuidPrefix = String(item.groupPrefix || "").trim();
            try {
              void window.dl.cancelDownload({
                ...(uuidPrefix ? { uuidPrefix } : {}),
                ...(!uuidPrefix && uuid ? { uuid } : {}),
              });
            } catch {}
            scheduleRender("slow");
            return;
          }

          const groupUuids = Array.isArray(item?.groupUuids) ? item.groupUuids : null;
          if (groupUuids && groupUuids.length > 0) {
            for (const u of groupUuids) store.remove(u);
          } else {
            store.remove(uuid);
          }
          store.prune();
          setBadge();
          scheduleRender("fast");
          return;
        }

        if (action === "play") {
          const trackId = Number(item.trackId);
          const canPlay = String(item.status) === "done" && Number.isFinite(trackId) && trackId > 0 && Boolean(window.__player?.setQueueAndPlay);
          if (!canPlay) return;
          try {
            const curTrackId = resolvePlayerTrackId();
            const isCurrent = curTrackId && curTrackId === trackId;
            if (isCurrent && typeof window.__player?.togglePlayPause === "function") {
              void window.__player.togglePlayPause();
            } else {
              const mediaState = resolveMediaState(item);
              const coverUrl = String(mediaState?.coverUrl || item?.cover || "").trim();
              const albumId = Number(item?.albumId);
              const artistId = Number(item?.artistId);
              const stub = {
                id: trackId,
                title: String(item.title || `Track #${trackId}`),
                artist: { id: Number.isFinite(artistId) && artistId > 0 ? artistId : null, name: String(item.artist || "") },
                album: { id: Number.isFinite(albumId) && albumId > 0 ? albumId : null, title: String(item.albumTitle || ""), cover_medium: coverUrl, cover: coverUrl },
                cover: coverUrl,
              };
              void window.__player.setQueueAndPlay([stub], 0);
            }
          } catch {}
          return;
        }

        if (action === "like") {
          const trackId = Number(item.trackId);
          if (!Number.isFinite(trackId) || trackId <= 0) return;
          const liked = Boolean(lib.isTrackSaved?.(trackId));
          try {
            if (liked) lib.removeSavedTrack?.(trackId);
            else {
              const stub = { id: trackId, title: String(item.title || `Track #${trackId}`), artist: { name: String(item.artist || "") }, album: { title: String(item.albumTitle || "") } };
              lib.addSavedTrack?.(stub);
            }
          } catch {}
          scheduleRender("slow");
          return;
        }

        if (action === "delete") {
          const trackId = Number(item.trackId);
          const isDone = String(item.status) === "done";
          const canDeleteFromDisk = isDone && Number.isFinite(trackId) && trackId > 0 && Boolean(window.dl?.deleteFromDisk);

          if (!canDeleteFromDisk) {
            store.remove(uuid);
            store.prune();
            setBadge();
            scheduleRender("fast");
            return;
          }

          const pre = (() => {
            try {
              const st = lib.load?.() || {};
              const downloaded = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
              return downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;
            } catch {
              return null;
            }
          })();
          const reconcileAlbumId = Number(item?.albumId || pre?.albumId || 0);
          const playlistIds = (() => {
            const out = new Set();
            const itemPid = Number(item?.playlistId);
            if (Number.isFinite(itemPid) && itemPid > 0) out.add(itemPid);
            const uuidPid = parsePlaylistIdFromUuid(pre?.download?.uuid);
            if (Number.isFinite(uuidPid) && uuidPid > 0) out.add(uuidPid);
            return Array.from(out);
          })();

          try {
            await window.dl.deleteFromDisk({ id: trackId });
          } catch {}
          try {
            await window.dl?.scanLibrary?.();
          } catch {}
          try {
            lib.removeDownloadedTrack?.(trackId);
          } catch {}
          try {
            reconcileSavedEntitiesAfterTrackDelete({
              albumId: reconcileAlbumId,
              playlistIds,
            });
          } catch {}
          scheduleRender("slow");
        }
      },
    },
  });

  let raf = 0;
  let slowTimer = 0;
  let lastProgressRenderAt = 0;

  const render = () => {
    if (!isViewActive()) return;
    downloadedSnapshot = null;
    const items = store.getGroupedItems ? store.getGroupedItems() : store.getItems();

    // Enrich playlist group cards with better title/cover when possible.
    for (const it of items) {
      const kind = String(it?.kind || "");
      const playlistId = Number(it?.playlistId);
      if (kind !== "playlist" || !Number.isFinite(playlistId) || playlistId <= 0) continue;

      const cached = playlistMetaById.get(playlistId) || null;
      if (cached) {
        const t = String(it?.title || "").trim();
        const shouldReplaceTitle = !t || t === "Playlist" || t === `Playlist #${playlistId}`;
        if (shouldReplaceTitle && cached.title) it.title = cached.title;
        if (cached.cover) it.cover = cached.cover;
        continue;
      }

      // Try local library first (fast, no IPC).
      try {
        const st = lib.load?.() || {};
        const row = st?.playlists && typeof st.playlists === "object" ? st.playlists[String(playlistId)] : null;
        const title = String(row?.title || "").trim();
        const cover = String(row?.cover || "").trim();
        if (title || cover) {
          playlistMetaById.set(playlistId, { title, cover });
          if (title) it.title = title;
          if (cover) it.cover = cover;
          continue;
        }
      } catch {}

      // Best-effort: load offline playlist metadata from disk (may be large; cache results).
      if (playlistMetaInFlight.has(playlistId) || playlistMetaFailed.has(playlistId)) continue;
      if (!window.dl?.getOfflineTracklist) continue;
      playlistMetaInFlight.add(playlistId);
      void window.dl
        .getOfflineTracklist({ type: "playlist", id: String(playlistId) })
        .then((r) => {
          const data = r?.data && typeof r.data === "object" ? r.data : null;
          if (!r?.ok || !data) throw new Error("not_ok");
          const title = String(data?.title || "").trim();
          const cover = String(data?.picture_medium || data?.picture || "").trim();
          if (!title && !cover) throw new Error("no_meta");
          playlistMetaById.set(playlistId, { title, cover });
          scheduleRender("fast");
        })
        .catch(() => {
          playlistMetaFailed.add(playlistId);
        })
        .finally(() => {
          playlistMetaInFlight.delete(playlistId);
        });
    }

    const recentsCount = store.getRecentsCount();
    const player = {
      canPlay: Boolean(window.__player?.setQueueAndPlay),
      trackId: resolvePlayerTrackId(),
      isPlaying: Boolean(window.__player?.getState?.()?.isPlaying),
    };
    displayedByUuid = new Map();
    for (const it of items) {
      const k = String(it?.uuid || "");
      if (k) displayedByUuid.set(k, it);
    }
    view.render({ items, recentsCount, player });
  };

  const scheduleRender = (mode = "fast") => {
    if (mode === "slow") {
      if (slowTimer) return;
      slowTimer = window.setTimeout(() => {
        slowTimer = 0;
        scheduleRender("fast");
      }, 120);
      return;
    }

    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  };

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isViewActive()) {
      window.__spotifyNav?.navigate?.({ name: "home", scrollTop: 0 });
    } else {
      window.__spotifyNav?.navigate?.({ name: "notifications", scrollTop: 0 });
    }
  });

  window.addEventListener("nav:viewChanged", () => {
    updateBellActive();
    setBadge();
    if (isViewActive()) scheduleRender("fast");
  });

  window.addEventListener("local-library:changed", () => {
    downloadedSnapshot = null;
    if (isViewActive()) scheduleRender("slow");
  });

  window.addEventListener("player:change", () => {
    if (isViewActive()) scheduleRender("slow");
  });

  if (window.dl?.onEvent) {
    window.dl.onEvent((payload) => {
      const { changed, event } = store.upsertFromEvent(payload);
      if (!changed) return;
      store.prune();
      setBadge();
      if (!isViewActive()) return;

      if (event === "updateQueue") {
        const now = performance.now();
        if (now - lastProgressRenderAt < 120) return;
        lastProgressRenderAt = now;
        scheduleRender("slow");
        return;
      }

      scheduleRender("fast");
    });
  }

  try {
    store.loadPersistedHistory();
  } catch {}
  void store.hydrateCompletedDownloads().then(() => {
    store.prune();
    setBadge();
    if (isViewActive()) scheduleRender("fast");
  });

  updateBellActive();
  setBadge();
  if (isViewActive()) scheduleRender("fast");
}
