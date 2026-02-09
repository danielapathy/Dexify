import { getLocalLibrary } from "../localLibrary.js";
import {
  applyRipple,
  ensureBar,
  ensureDockPosition,
  ensureRowCheckbox,
  findActiveTrackList,
  getActiveContext,
  getMainScrollEl,
  num,
  setCheckboxState,
  updateHeaderCount,
} from "./trackMultiSelectDom.js";

export function wireTrackMultiSelect() {
  const entityView = document.getElementById("entityView");
  if (!entityView) return null;

  const lib = getLocalLibrary();
  const state = {
    active: false,
    context: null,
    list: null,
    selected: new Set(),
    suppressNextClick: false,
  };

  const dock = ensureBar(entityView);

  const isSelectableRow = (row) => String(row?.dataset?.selectDisabled || "0") !== "1";
  const canSelectTrack = (trackId) => {
    const tid = num(trackId);
    if (!tid || !state.list) return false;
    const row = state.list.querySelector(`.entity-track[data-track-id="${tid}"]`);
    if (!row) return false;
    return isSelectableRow(row);
  };
  const isDownloadedFromState = (trackId, downloadedState) => {
    const tid = Number(trackId);
    if (!Number.isFinite(tid) || tid <= 0) return false;
    const row =
      downloadedState[String(tid)] && typeof downloadedState[String(tid)] === "object"
        ? downloadedState[String(tid)]
        : null;
    const fileUrl = row?.download?.fileUrl ? String(row.download.fileUrl) : "";
    return Boolean(fileUrl);
  };
  const parsePlaylistIdFromUuid = (uuid) => {
    const raw = String(uuid || "");
    const m = /^playlist_(\d+)_track_/i.exec(raw);
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  };
  const readDownloadedTrackRefs = (trackId) => {
    const tid = Number(trackId);
    if (!Number.isFinite(tid) || tid <= 0) return { albumId: null, playlistId: null };
    try {
      const st = lib.load?.() || {};
      const downloadedState = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      const row =
        downloadedState[String(tid)] && typeof downloadedState[String(tid)] === "object"
          ? downloadedState[String(tid)]
          : null;
      if (!row) return { albumId: null, playlistId: null };
      const albumIdRaw = Number(row?.albumId || row?.track?.album?.id || row?.album?.id);
      const albumId = Number.isFinite(albumIdRaw) && albumIdRaw > 0 ? albumIdRaw : null;
      const playlistRaw = Number(row?.playlistId);
      const uuid = String(row?.download?.uuid || "");
      const playlistFromUuid = parsePlaylistIdFromUuid(uuid);
      const playlistId =
        Number.isFinite(playlistRaw) && playlistRaw > 0 ? playlistRaw : Number.isFinite(playlistFromUuid) ? playlistFromUuid : null;
      return { albumId, playlistId };
    } catch {
      return { albumId: null, playlistId: null };
    }
  };
  const reconcileSavedEntitiesByIds = ({ albumIds, playlistIds } = {}) => {
    const albumSet = albumIds instanceof Set ? albumIds : new Set();
    const playlistSet = playlistIds instanceof Set ? playlistIds : new Set();
    if (albumSet.size === 0 && playlistSet.size === 0) return;
    try {
      const st = lib.load?.() || {};
      const downloadedState = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      const downloadedRows = Object.values(downloadedState).filter((row) => {
        const entry = row && typeof row === "object" ? row : null;
        const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
        return Boolean(fileUrl);
      });

      for (const aid of albumSet) {
        const albumId = Number(aid);
        if (!Number.isFinite(albumId) || albumId <= 0) continue;
        const hasRemaining = downloadedRows.some((row) => Number(row?.albumId || row?.track?.album?.id || row?.album?.id) === albumId);
        if (!hasRemaining && lib.isAlbumSaved?.(albumId)) lib.removeSavedAlbum?.(albumId);
      }

      for (const pid of playlistSet) {
        const playlistId = Number(pid);
        if (!Number.isFinite(playlistId) || playlistId <= 0) continue;
        const hasRemaining = downloadedRows.some((row) => {
          const pRaw = Number(row?.playlistId);
          if (Number.isFinite(pRaw) && pRaw > 0) return pRaw === playlistId;
          const pFromUuid = parsePlaylistIdFromUuid(row?.download?.uuid);
          return Number.isFinite(pFromUuid) && pFromUuid === playlistId;
        });
        if (!hasRemaining && lib.isPlaylistSaved?.(playlistId)) lib.removeSavedPlaylist?.(playlistId);
      }
    } catch {}
  };
  const countEntityDownloadedTracks = async ({ entityType, entityId }) => {
    const type = String(entityType || "");
    const idNum = Number(entityId);
    if ((type !== "album" && type !== "playlist") || !Number.isFinite(idNum) || idNum <= 0) return 0;

    const st = lib.load?.() || {};
    const downloadedState = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};

    const ids = new Set();
    if (window.dl?.getOfflineTracklist) {
      try {
        const r = await window.dl.getOfflineTracklist({ type, id: String(idNum) });
        const tracks = Array.isArray(r?.data?.tracks) ? r.data.tracks : [];
        for (const t of tracks) {
          const tid = Number(t?.id || t?.SNG_ID);
          if (Number.isFinite(tid) && tid > 0) ids.add(tid);
        }
      } catch {}
    }

    if (ids.size > 0) {
      let downloadedCount = 0;
      for (const tid of ids) {
        if (isDownloadedFromState(tid, downloadedState)) downloadedCount += 1;
      }
      return downloadedCount;
    }

    // Fallback for sparse metadata.
    let downloadedCount = 0;
    for (const row of Object.values(downloadedState)) {
      const entry = row && typeof row === "object" ? row : null;
      if (!entry) continue;
      const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
      if (!fileUrl) continue;
      if (type === "album") {
        if (Number(entry?.albumId) === idNum) downloadedCount += 1;
      } else {
        const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
        if (uuid.startsWith(`playlist_${idNum}_track_`)) downloadedCount += 1;
      }
    }
    return downloadedCount;
  };
  const reconcileEntitySavedStateAfterDelete = async () => {
    const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
    if (String(route?.name || "") !== "entity") return;
    const entityType = String(route?.entityType || "");
    const entityId = Number(route?.id);
    if ((entityType !== "album" && entityType !== "playlist") || !Number.isFinite(entityId) || entityId <= 0) return;

    const remainingDownloaded = await countEntityDownloadedTracks({ entityType, entityId });
    if (remainingDownloaded > 0) return;

    try {
      if (entityType === "album") {
        if (lib.isAlbumSaved?.(entityId)) lib.removeSavedAlbum?.(entityId);
      } else if (entityType === "playlist") {
        if (lib.isPlaylistSaved?.(entityId)) lib.removeSavedPlaylist?.(entityId);
      }
    } catch {}
  };

  const setDockActive = (active) => {
    const on = Boolean(active);
    try {
      dock.setAttribute("aria-hidden", on ? "false" : "true");
    } catch {}
    try {
      dock.inert = !on;
    } catch {}
    try {
      dock.classList.toggle("is-active", on);
    } catch {}
  };

  const updateBar = () => {
    const count = state.selected.size;
    const countEl = dock.querySelector(".track-select-bar__count");
    if (countEl) countEl.textContent = `${count} selected`;

    const primaryBtn = dock.querySelector('[data-action="primary"]');
    if (primaryBtn) {
      if (state.context === "downloads") {
        primaryBtn.textContent = count === 1 ? "Delete download" : "Delete downloads";
        primaryBtn.dataset.kind = "downloads";
      } else if (state.context === "playlist" || state.context === "album") {
        primaryBtn.textContent = count === 1 ? "Delete track from library" : `Delete ${count} tracks from library`;
        primaryBtn.dataset.kind = state.context;
      } else {
        primaryBtn.textContent = count === 1 ? "Remove from Liked" : "Remove from Liked";
        primaryBtn.dataset.kind = "liked";
      }
      primaryBtn.disabled = count === 0;
    }
  };

  const syncSelectionToDom = () => {
    const list = state.list;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll(".entity-track"));
    for (const r of rows) {
      ensureRowCheckbox(r);
      const tid = Number(r?.dataset?.trackId);
      const selectable = isSelectableRow(r);
      const key = Number.isFinite(tid) ? String(tid) : "";
      if (!selectable && key) state.selected.delete(key);
      const selected = selectable && Number.isFinite(tid) && state.selected.has(key);
      const check = r.querySelector(".entity-track__check");
      if (check) {
        check.disabled = !selectable;
        check.setAttribute("aria-disabled", selectable ? "false" : "true");
      }
      r.classList.toggle("is-select-disabled", !selectable);
      setCheckboxState(r, selected);
    }
  };

  const exit = () => {
    if (!state.active) return;
    state.active = false;
    state.context = null;
    state.selected.clear();
    setDockActive(false);
    try {
      entityView.classList.remove("is-track-selecting");
    } catch {}
    try {
      state.list?.classList?.remove?.("is-selecting");
    } catch {}
    try {
      const rows = Array.from(state.list?.querySelectorAll?.(".entity-track.is-selected") || []);
      for (const r of rows) setCheckboxState(r, false);
    } catch {}
    state.list = null;
  };

  const enter = ({ trackId } = {}) => {
    const context = getActiveContext();
    if (!context) return false;

    const list = findActiveTrackList(entityView);
    if (!list) return false;

    ensureDockPosition(entityView, dock);
    state.active = true;
    state.context = context;
    state.list = list;
    entityView.classList.add("is-track-selecting");
    setDockActive(true);
    list.classList.add("is-selecting");

    if (trackId) {
      const tid = num(trackId);
      if (tid) state.selected.add(String(tid));
    }

    syncSelectionToDom();
    updateBar();

    return true;
  };

  const toggle = (trackId) => {
    if (!state.active) return false;
    const tid = num(trackId);
    if (!tid) return false;
    if (!canSelectTrack(tid)) return false;
    const key = String(tid);
    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.add(key);
    syncSelectionToDom();
    updateBar();
    return true;
  };

  const select = (trackId) => {
    const tid = num(trackId);
    if (!tid) return false;
    if (!state.active) {
      const list = findActiveTrackList(entityView);
      const row = list?.querySelector?.(`.entity-track[data-track-id="${tid}"]`);
      if (!row || !isSelectableRow(row)) return false;
      const ok = enter({ trackId: tid });
      return ok;
    }
    if (!canSelectTrack(tid)) return false;
    state.selected.add(String(tid));
    syncSelectionToDom();
    updateBar();
    return true;
  };

  const isActive = () => state.active;
  const consumeSuppressClick = () => {
    const v = state.suppressNextClick;
    state.suppressNextClick = false;
    return v;
  };

  dock.addEventListener("click", async (event) => {
    const btn = event.target?.closest?.("button");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "cancel") {
      exit();
      return;
    }
    if (action !== "primary") return;

    const ids = Array.from(state.selected).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return;

    if (state.context === "downloads") {
      const affectedAlbumIds = new Set();
      const affectedPlaylistIds = new Set();
      const failures = [];
      for (const id of ids) {
        const refs = readDownloadedTrackRefs(id);
        if (Number.isFinite(refs.albumId) && refs.albumId > 0) affectedAlbumIds.add(refs.albumId);
        if (Number.isFinite(refs.playlistId) && refs.playlistId > 0) affectedPlaylistIds.add(refs.playlistId);
        try {
          if (window.dl?.deleteFromDisk) {
            const res = await window.dl.deleteFromDisk({ id });
            if (!res?.ok) failures.push(id);
          } else {
            failures.push(id);
          }
        } catch {
          failures.push(id);
        }
        try {
          lib.removeDownloadedTrack?.(id);
        } catch {}
        try {
          window.__downloadsUI?.removeTrack?.(id);
        } catch {}
      }
      try {
        await window.dl?.scanLibrary?.();
      } catch {}
      try {
        reconcileSavedEntitiesByIds({ albumIds: affectedAlbumIds, playlistIds: affectedPlaylistIds });
      } catch {}

      try {
        const remaining = state.list ? state.list.querySelectorAll(".entity-track").length : null;
        if (Number.isFinite(remaining)) updateHeaderCount(entityView, remaining);
      } catch {}

      if (failures.length > 0) {
        try {
          const scrollEl = getMainScrollEl();
          const st = scrollEl ? Number(scrollEl.scrollTop) : 0;
          window.__spotifyNav?.navigate?.({ name: "downloads", refresh: true, scrollTop: st }, { replace: true });
        } catch {}
      }
      exit();
      return;
    }

    if (state.context === "playlist" || state.context === "album") {
      const affectedAlbumIds = new Set();
      const affectedPlaylistIds = new Set();
      const failures = [];
      for (const id of ids) {
        const refs = readDownloadedTrackRefs(id);
        if (Number.isFinite(refs.albumId) && refs.albumId > 0) affectedAlbumIds.add(refs.albumId);
        if (Number.isFinite(refs.playlistId) && refs.playlistId > 0) affectedPlaylistIds.add(refs.playlistId);
        try {
          if (window.dl?.deleteFromDisk) {
            const res = await window.dl.deleteFromDisk({ id });
            if (!res?.ok) failures.push(id);
          } else {
            failures.push(id);
          }
        } catch {
          failures.push(id);
        }
        try {
          lib.removeDownloadedTrack?.(id);
        } catch {}
      }
      try {
        await window.dl?.scanLibrary?.();
      } catch {}
      try {
        reconcileSavedEntitiesByIds({ albumIds: affectedAlbumIds, playlistIds: affectedPlaylistIds });
      } catch {}
      try {
        await reconcileEntitySavedStateAfterDelete();
      } catch {}
      try {
        const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
        const routeType = String(route?.entityType || "");
        const isEntityType = String(route?.name || "") === "entity" && (routeType === "playlist" || routeType === "album");
        if (isEntityType) {
          const scrollEl = getMainScrollEl();
          const st = scrollEl ? Number(scrollEl.scrollTop) : 0;
          window.__spotifyNav?.navigate?.(
            { name: "entity", entityType: routeType, id: String(route?.id || ""), refresh: true, scrollTop: st },
            { replace: true },
          );
        }
      } catch {}
      if (failures.length > 0) {
        try {
          const scrollEl = getMainScrollEl();
          const st = scrollEl ? Number(scrollEl.scrollTop) : 0;
          const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
          const routeType = String(route?.entityType || "");
          if (String(route?.name || "") === "entity" && (routeType === "playlist" || routeType === "album")) {
            window.__spotifyNav?.navigate?.(
              { name: "entity", entityType: routeType, id: String(route?.id || ""), refresh: true, scrollTop: st },
              { replace: true },
            );
          }
        } catch {}
      }
      exit();
      return;
    }

    // liked
    for (const id of ids) {
      try {
        lib.removeSavedTrack?.(id);
      } catch {}
    }
    exit();
  });

  // Escape to exit selection mode.
  document.addEventListener("keydown", (event) => {
    if (!state.active) return;
    if (event.key === "Escape") exit();
  });

  // Reset when navigating away.
  window.addEventListener("nav:viewChanged", () => {
    if (!state.active) return;
    // Selection mode is scoped to the current rendered surface. Never let it
    // "leak" across route/view changes (e.g. Downloads -> Liked).
    exit();
  });

  // Ripple + long-press selection gesture.
  const longPress = { timer: 0, pointerId: null, x: 0, y: 0, row: null };
  const clearLongPress = () => {
    if (longPress.timer) clearTimeout(longPress.timer);
    longPress.timer = 0;
    longPress.pointerId = null;
    longPress.row = null;
  };

  entityView.addEventListener(
    "pointerdown",
    (event) => {
      const row = event.target?.closest?.(".entity-track");
      if (!row) return;

      const ctx = getActiveContext();
      // Visual feedback for the requested lists.
      if (ctx && event.button === 0) applyRipple(row, event);
      if (!ctx) return;
      if (state.active) return;
      if (event.button !== 0) return;

      longPress.pointerId = event.pointerId;
      longPress.x = Number(event.clientX) || 0;
      longPress.y = Number(event.clientY) || 0;
      longPress.row = row;

      longPress.timer = window.setTimeout(() => {
        longPress.timer = 0;
        const tid = Number(longPress.row?.dataset?.trackId);
        if (!Number.isFinite(tid) || tid <= 0) return;
        if (!isSelectableRow(longPress.row)) return;
        const ok = enter({ trackId: tid });
        if (ok) state.suppressNextClick = true;
      }, 420);
    },
    true,
  );

  entityView.addEventListener(
    "pointermove",
    (event) => {
      if (!longPress.timer) return;
      if (longPress.pointerId !== event.pointerId) return;
      const dx = (Number(event.clientX) || 0) - longPress.x;
      const dy = (Number(event.clientY) || 0) - longPress.y;
      if (Math.hypot(dx, dy) > 8) clearLongPress();
    },
    true,
  );

  entityView.addEventListener(
    "pointerup",
    (event) => {
      if (!longPress.timer) return;
      if (longPress.pointerId !== event.pointerId) return;
      clearLongPress();
    },
    true,
  );

  entityView.addEventListener(
    "pointercancel",
    () => {
      clearLongPress();
    },
    true,
  );

  const api = { enter, exit, toggle, select, isActive, consumeSuppressClick };
  window.__trackMultiSelect = api;
  return api;
}
