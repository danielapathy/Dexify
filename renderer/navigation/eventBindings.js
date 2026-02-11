export function wireNavigationEventBindings({
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
  getHomeRoute,
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
}) {
  backBtn.addEventListener("click", () => void goBack());
  forwardBtn.addEventListener("click", () => void goForward());
  homeBtn.addEventListener("click", () => {
    void navigate(getHomeRoute({ refresh: true, scrollTop: 0 }));
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
      event.preventDefault();
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

  try {
    window.auth?.onSessionChanged?.(() => refreshAuthChrome());
  } catch {}
  refreshAuthChrome();

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

    const card = event.target?.closest?.("a.big-card");
    if (!card) return;
    event.preventDefault();

    const entityType = card.dataset.entityType;
    const entityId = card.dataset.entityId;
    if (!entityType || !entityId) return;
    void navigate({ name: "entity", entityType, id: entityId });
  });

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
    const multiSelect = window.__trackMultiSelect;
    const rowForSelect = event.target?.closest?.(".entity-track");
    if (multiSelect?.isActive?.()) {
      if (multiSelect?.consumeSuppressClick?.()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (rowForSelect) {
        event.preventDefault();
        event.stopPropagation();
        const tid = Number(rowForSelect?.dataset?.trackId);
        if (Number.isFinite(tid) && tid > 0) multiSelect?.toggle?.(tid);
        return;
      }
    } else if (multiSelect?.consumeSuppressClick?.()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const likeBtn = event.target?.closest?.(".entity-track__like");
    if (likeBtn) {
      event.preventDefault();
      event.stopPropagation();

      const row = likeBtn.closest(".entity-track");
      const idx = Number(row?.dataset?.trackIndex);
      const trackId = Number(row?.dataset?.trackId);
      if (!Number.isFinite(trackId) || trackId <= 0) return;

      const listInfo = resolveTrackListFromRow(row);
      const activeEntry = entityCache.getActiveEntry();
      const fallbackTracks = Array.isArray(activeEntry?.tracks) ? activeEntry.tracks : [];
      const source = Array.isArray(listInfo?.tracks) && listInfo.tracks.length > 0 ? listInfo.tracks : fallbackTracks;
      const index = Number.isFinite(listInfo?.index) && listInfo.index >= 0 ? listInfo.index : idx;
      const trackObj = Number.isFinite(index) && index >= 0 ? source[index] : null;

      const isSaved = lib.isTrackSaved(trackId);
      if (isSaved) {
        lib.removeSavedTrack(trackId);
      } else {
        lib.addSavedTrack(trackObj || { id: trackId });
        if (window.dl?.downloadTrack) {
          const quality = getDownloadQualityRaw();
          const uuid = `dl_${trackId}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
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

    const row = rowForSelect || event.target?.closest?.(".entity-track");
    if (!row) return;
    const idx = Number(row.dataset.trackIndex);
    if (!Number.isFinite(idx) || idx < 0) return;
    if (!window.__player) return;

	    const listInfo = resolveTrackListFromRow(row);
	    const activeEntry = entityCache.getActiveEntry();
	    const fallbackTracks = Array.isArray(activeEntry?.tracks) ? activeEntry.tracks : [];
	    const source = Array.isArray(listInfo?.tracks) && listInfo.tracks.length > 0 ? listInfo.tracks : fallbackTracks;
	    const index = Number.isFinite(listInfo?.index) && listInfo.index >= 0 ? listInfo.index : idx;
	    if (source.length === 0 || !Number.isFinite(index) || index < 0) return;

    const clamped = Math.max(0, Math.min(index, source.length - 1));
    const context = (() => {
      const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
      if (String(route?.name || "") !== "entity") return null;
      const entityType = String(route?.entityType || "").trim();
      const idNum = Number(route?.id);
      if ((entityType !== "playlist" && entityType !== "album") || !Number.isFinite(idNum) || idNum <= 0) return null;
      const header = entityView?.querySelector?.(".entity-header") || null;
      const title = String(header?.querySelector?.(".entity-title")?.textContent || "").trim();
      const cover = String(header?.querySelector?.(".entity-cover img")?.getAttribute?.("src") || "").trim();
      return { type: entityType, id: idNum, title, cover };
    })();
    void window.__player.setQueueAndPlay(source, clamped, context ? { context } : undefined);
  });

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

  let _likedRefreshTimer = 0;
  let _downloadsRefreshTimer = 0;
  let _lastLikedCount = -1;
  let _lastDownloadsCount = -1;

  window.addEventListener("local-library:changed", () => {
    try {
      const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
      if (route?.name === "liked") {
        if (_likedRefreshTimer) clearTimeout(_likedRefreshTimer);
        _likedRefreshTimer = setTimeout(() => {
          _likedRefreshTimer = 0;
          try {
            const count = lib.listSavedTracks?.()?.length ?? -1;
            if (count === _lastLikedCount && _lastLikedCount >= 0) return;
            _lastLikedCount = count;
          } catch {}
          const st = scrollEl ? scrollEl.scrollTop : 0;
          void navigate({ name: "liked", refresh: true, scrollTop: st }, { replace: true });
        }, 250);
        return;
      }
      if (route?.name === "downloads") {
        if (_downloadsRefreshTimer) clearTimeout(_downloadsRefreshTimer);
        _downloadsRefreshTimer = setTimeout(() => {
          _downloadsRefreshTimer = 0;
          try {
            const count = lib.listDownloadedTracks?.({ requireFile: true })?.length ?? -1;
            if (count === _lastDownloadsCount && _lastDownloadsCount >= 0) return;
            _lastDownloadsCount = count;
          } catch {}
          const st = scrollEl ? scrollEl.scrollTop : 0;
          void navigate({ name: "downloads", refresh: true, scrollTop: st }, { replace: true });
        }, 250);
        return;
      }
    } catch {}
  });

  window.addEventListener("nav:viewChanged", () => {
    _lastLikedCount = -1;
    _lastDownloadsCount = -1;
  });
}
