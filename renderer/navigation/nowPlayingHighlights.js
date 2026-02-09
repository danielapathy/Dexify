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

  const resolveAlbumIdFromPlayerState = (st) => {
    try {
      const t0 = st?.track && typeof st.track === "object" ? st.track : null;
      if (!t0) return null;
      let raw = t0?.raw && typeof t0.raw === "object" ? t0.raw : null;
      for (let i = 0; i < 3; i++) {
        if (!raw || typeof raw !== "object") break;
        const next = raw.raw && typeof raw.raw === "object" ? raw.raw : null;
        if (!next) break;
        raw = next;
      }
      const n = Number(
        t0?.album?.id ||
          t0?.albumId ||
          t0?.ALB_ID ||
          t0?.album_id ||
          t0?.data?.ALB_ID ||
          t0?.data?.album?.id ||
          raw?.album?.id ||
          raw?.albumId ||
          raw?.album_id ||
          raw?.ALB_ID ||
          raw?.data?.ALB_ID ||
          raw?.data?.album?.id ||
          0,
      );
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };

  const applyToLibrary = (container, { trackId, albumId, isPlaying }) => {
    if (!container) return;
    const rows = Array.from(container.querySelectorAll(".library-item"));
    if (rows.length === 0) return;
    for (const row of rows) {
      const tid = Number(row.dataset.trackId);
      const isTrackCurrent = Number.isFinite(tid) && Number.isFinite(trackId) && tid === trackId;

      const et = String(row.dataset.entityType || "");
      const eid = Number(row.dataset.entityId);
      const isAlbumRow = et === "album" && Number.isFinite(eid) && eid > 0;
      const isAlbumCurrent = isAlbumRow && Number.isFinite(albumId) && eid === albumId;

      const isCurrent = isTrackCurrent || isAlbumCurrent;
      row.classList.toggle("is-current", isCurrent);
      row.classList.toggle("is-playing", isCurrent && Boolean(isPlaying));
    }
  };

  const refreshFromPlayer = () => {
    const st = window.__player?.getState?.() || {};
    const tid = Number(st?.track?.id ?? st?.trackId);
    const state = {
      trackId: Number.isFinite(tid) ? tid : null,
      albumId: resolveAlbumIdFromPlayerState(st),
      isPlaying: Boolean(st?.isPlaying),
    };
    applyToContainer(document.getElementById("entityView"), state);
    applyToContainer(document.getElementById("searchResults"), state);
    applyToLibrary(document.getElementById("libraryList"), state);
  };

  window.addEventListener("player:change", (event) => {
    const detail = event?.detail || {};
    const trackId = Number(detail.trackId);
    const st = window.__player?.getState?.() || {};
    const state = {
      trackId: Number.isFinite(trackId) ? trackId : null,
      albumId: resolveAlbumIdFromPlayerState(st),
      isPlaying: Boolean(detail.isPlaying),
    };
    applyToContainer(document.getElementById("entityView"), state);
    applyToContainer(document.getElementById("searchResults"), state);
    applyToLibrary(document.getElementById("libraryList"), state);
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
  watch(document.getElementById("libraryList"));
  refreshFromPlayer();
}
