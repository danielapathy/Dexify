import { createEntitySections } from "./entitySections.js";
import { createEntityHeaderRenderer } from "./entityHeader.js";

export function createEntityRenderer({
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
}) {
  const { buildTrackList, renderTrackSection, renderCarouselSection } = createEntitySections({
    registerTrackList,
    downloadBadges,
    formatDuration,
    lib,
    formatRecordTypeLabel,
    formatFansCountText,
  });
  const renderEntityHeader = createEntityHeaderRenderer({
    lib,
    getDownloadQualityRaw,
    entityDownloadAction,
    normalizeRecordType,
  });

  const renderEntityInto = async (
    container,
    { entityType, id, title: routeTitle, subtitle: routeSubtitle, cover: routeCover, refresh: routeRefresh },
    entry,
  ) => {
    const type = String(entityType || "").trim();
    const entityId = String(id || "").trim();
    if (!type || !entityId) return true;

    const isAuthed = Boolean(window.__authHasARL);
    const canUseDz = isAuthed && window.dz && typeof window.dz.getTracklist === "function";
    const canUseOffline = window.dl && typeof window.dl.getOfflineTracklist === "function";
    // Offline snapshots are first-class for album/playlist pages and artist fallback.
    const canShowOffline = canUseOffline && (type === "album" || type === "playlist" || (type === "artist" && !canUseDz));
    if (!canUseDz && !canShowOffline) {
      renderEmptyText(
        container,
        isAuthed
          ? "Entity views are available in Electron only (missing window.dz)."
          : "Log in to view this.",
      );
      return true;
    }

    const thisReq = (entry.renderReq = Number(entry?.renderReq || 0) + 1);
    entityCache.setAccent(entry, null);
    renderEntitySkeleton(container, { rows: 12, withActions: true });

    const renderEntityData = (data, { fromCache = false } = {}) => {
      if (entry?.renderReq !== thisReq) return false;

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
              : type === "artist"
                ? (() => {
                    const fans = Number(data?.nb_fan || 0);
                    const albumsCount = Array.isArray(data?.albums)
                      ? data.albums.length
                      : Array.isArray(data?.albums?.data)
                        ? data.albums.data.length
                        : 0;
                    const parts = [];
                    if (fans > 0) parts.push(formatFansCountText(`${fans} fans`));
                    if (albumsCount > 0) parts.push(`${albumsCount} releases`);
                    return parts.join(" • ") || "Artist";
                  })()
                : `Artist`;

      const tracks =
        type === "artist"
          ? Array.isArray(data?.topTracks)
            ? data.topTracks
            : []
          : Array.isArray(data?.tracks)
            ? data.tracks
            : [];

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
      entityCache.setAccent(entry, null);

      renderEntityHeader({
        container,
        type,
        entityId,
        title,
        subtitle,
        cover,
        data,
        tracksWithCover,
        entry,
      });

      if (cover) {
        extractAverageColorFromImageUrl(cover)
          .then((rgb) => {
            if (!rgb) return;
            const accent = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.72)`;
            entityCache.setAccent(entry, accent);
          })
          .catch(() => {});
      }

      const showCovers = type !== "album";
      const showDownloadStatus = type === "album" || type === "playlist";

      if (type === "artist") {
        let renderedAny = false;
        renderedAny = renderTrackSection({
          container,
          type,
          entityId,
          title: "Popular",
          tracks: tracksWithCover,
          pageContext: "artist-top",
          showCovers: true,
          showDownloadStatus: false,
          limit: 25,
        }) || renderedAny;

        const radioTracks = Array.isArray(data?.radio) ? data.radio : Array.isArray(data?.radio?.data) ? data.radio.data : [];
        renderedAny = renderTrackSection({
          container,
          type,
          entityId,
          title: "Artist Radio",
          tracks: radioTracks,
          pageContext: "artist-radio",
          showCovers: true,
          showDownloadStatus: false,
          limit: 20,
        }) || renderedAny;

        const albums = Array.isArray(data?.albums) ? data.albums : Array.isArray(data?.albums?.data) ? data.albums.data : [];
        const singles = [];
        const eps = [];
        const compilations = [];
        const fullAlbums = [];
        const otherAlbums = [];
        for (const a of albums) {
          const rt = normalizeRecordType(a?.record_type || a?.recordType);
          if (rt === "single") singles.push(a);
          else if (rt === "ep") eps.push(a);
          else if (rt === "compilation") compilations.push(a);
          else if (rt === "album") fullAlbums.push(a);
          else otherAlbums.push(a);
        }

        renderedAny = renderCarouselSection({ container, title: "Albums", items: fullAlbums, kind: "album" }) || renderedAny;
        renderedAny = renderCarouselSection({
          container,
          title: "Singles & EPs",
          items: [...singles, ...eps],
          kind: "album",
        }) || renderedAny;
        renderedAny = renderCarouselSection({ container, title: "Compilations", items: compilations, kind: "album" }) || renderedAny;
        renderedAny = renderCarouselSection({ container, title: "More Releases", items: otherAlbums, kind: "album" }) || renderedAny;

        const playlists = Array.isArray(data?.playlists) ? data.playlists : Array.isArray(data?.playlists?.data) ? data.playlists.data : [];
        renderedAny = renderCarouselSection({ container, title: "Playlists", items: playlists, kind: "playlist" }) || renderedAny;

        const related = Array.isArray(data?.related) ? data.related : Array.isArray(data?.related?.data) ? data.related.data : [];
        renderedAny = renderCarouselSection({ container, title: "Fans Also Like", items: related, kind: "artist" }) || renderedAny;

        if (!renderedAny) {
          const empty = document.createElement("div");
          empty.className = "search-empty";
          empty.textContent = fromCache ? "Artist data is still loading." : "No tracks to display.";
          container.appendChild(empty);
        }
        return true;
      }

      const list = buildTrackList({
        type,
        entityId,
        tracks: tracksWithCover,
        pageContext: type,
        showCovers,
        showDownloadStatus,
        limit: 200,
      });

      if (!list) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "No tracks to display.";
        container.appendChild(empty);
        return true;
      }

      container.appendChild(list);
      return true;
    };

    try {
      let res = null;
      let usedDz = false;
      let renderedFromCache = false;
      const cachedArtist = type === "artist" && !routeRefresh ? readArtistCache(entityId) : null;

      // Prefer the local snapshot first for consistency and resilience; fall back to Deezer.
      let offlineRes = null;
      if (canShowOffline) {
        try {
          offlineRes = await window.dl.getOfflineTracklist({ type, id: entityId });
        } catch {
          offlineRes = null;
        }
      }
      res = offlineRes?.ok ? offlineRes : null;

      if (!res?.ok && cachedArtist?.data) {
        const ok = renderEntityData(cachedArtist.data, { fromCache: true });
        renderedFromCache = Boolean(ok);
        if (ok && cachedArtist.fresh && !routeRefresh && !canUseDz) return true;
        if (ok && cachedArtist.fresh && !routeRefresh && !canShowOffline) return true;
      }

      // When the offline snapshot is incomplete (missing title/cover, or we simply
      // have Deezer available), fetch from Deezer for the full metadata and merge
      // the offline download-status annotations into the Deezer track list.
      const offlineData = offlineRes?.ok && offlineRes?.data ? offlineRes.data : null;
      const offlineLooksIncomplete = offlineData && (
        !String(offlineData.title || "").trim() ||
        (!String(offlineData.cover_medium || offlineData.cover || offlineData.picture_medium || offlineData.picture || "").trim())
      );

      if (canUseDz && (!res?.ok || offlineLooksIncomplete)) {
        try {
          const dzRes = await window.dz.getTracklist({ type, id: entityId });
          usedDz = Boolean(dzRes?.ok && dzRes?.data);
          if (usedDz && offlineData) {
            // Merge: use Deezer data as the base, annotate tracks with offline
            // download status (__missing = false means downloaded).
            const offlineTrackIds = new Set();
            for (const t of Array.isArray(offlineData.tracks) ? offlineData.tracks : []) {
              const tid = Number(t?.id || t?.SNG_ID);
              if (Number.isFinite(tid) && tid > 0 && !t.__missing) offlineTrackIds.add(tid);
            }
            const dzData = dzRes.data;
            const dzTracks = Array.isArray(dzData.tracks) ? dzData.tracks : [];
            const mergedTracks = dzTracks.map((t) => {
              const tid = Number(t?.id || t?.SNG_ID);
              const isDownloaded = Number.isFinite(tid) && tid > 0 && offlineTrackIds.has(tid);
              return isDownloaded ? t : { ...t, __missing: true };
            });
            res = { ok: true, data: { ...dzData, tracks: mergedTracks } };
          } else if (usedDz) {
            res = dzRes;
          }
        } catch {
          // Keep whatever we had from offline.
        }
      }

      if (entry?.renderReq !== thisReq) return false;
      if (!res?.ok || !res?.data) {
        if (renderedFromCache) return true;
        renderEmptyText(container, "Failed to load (" + String(res?.error || "unknown") + ").");
        return true;
      }

      const ok = renderEntityData(res.data);
      if (ok && type === "artist" && usedDz) {
        try {
          writeArtistCache(entityId, res.data);
        } catch {}
      }
      return ok;
    } catch (e) {
      if (entry?.renderReq !== thisReq) return false;
      renderEmptyText(container, String(e?.message || e || "Failed to load"));
      return true;
    }
  };

  return { renderEntityInto };
}
