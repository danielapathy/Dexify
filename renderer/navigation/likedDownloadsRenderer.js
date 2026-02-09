import { buildLibraryTrackList, renderLibraryEmptyCallout, renderLibraryHeader } from "./libraryTracksView.js";

export function createLikedDownloadsRenderer({
  lib,
  entityCache,
  renderEmptyText,
  formatDuration,
  registerTrackList,
  getLocalLibrary,
}) {
  const renderLikedInto = async (container, entry) => {
    renderEmptyText(container, "Loading Liked Songs…");
    entityCache.setAccent(entry, "rgba(75, 48, 255, 0.78)");
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
        const downloadFromLocal =
          (t?.download && typeof t.download === "object" ? t.download : null) ||
          (fromDownloads?.download && typeof fromDownloads.download === "object" ? fromDownloads.download : null);
        const albumCover =
          String(t?.albumCover || "").trim() ||
          String(fromDownloads?.albumCover || "") ||
          String(fromDownloads?.trackJson?.album?.cover_medium || fromDownloads?.trackJson?.album?.cover_small || "") ||
          "";
        const base = {
          id: Number(t?.id) || null,
          title: String(t?.title || ""),
          duration: Number(t?.duration) || 0,
          artist: { id: backfillArtistId || null, name: String(t?.artist || "") },
          album: {
            cover_small: albumCover,
            cover_medium: albumCover,
            cover: albumCover,
            title: String(t?.albumTitle || ""),
            id: Number(t?.albumId) || null,
          },
        };
        if (downloadFromLocal) {
          base.download = { ...downloadFromLocal };
        }
        return base;
      });
      if (entry) entry.tracks = tracks;

      container.innerHTML = "";
      renderLibraryHeader({
        container,
        title: "Liked Songs",
        subtitleText: `${tracks.length} songs`,
        gradientCss: "linear-gradient(135deg, rgba(75, 48, 255, 1) 0%, rgba(180, 170, 255, 1) 60%, rgba(235, 235, 235, 0.95) 100%)",
        iconClass: "ri-heart-fill",
      });

      if (tracks.length === 0) {
        renderLibraryEmptyCallout({
          container,
          title: "Oops — you don’t have any songs yet.",
          description: "Search, play, and like tracks to download them.",
        });
        return true;
      }

      const list = buildLibraryTrackList({
        tracks,
        pageContext: "liked",
        formatDuration,
        lib,
        registerTrackList,
        likeAriaLabel: "Unlike",
      });
      container.appendChild(list);
    } catch (e) {
      renderEmptyText(container, String(e?.message || e || "Failed to load"));
    }
    return true;
  };

  const renderDownloadsInto = async (container, entry) => {
    renderEmptyText(container, "Loading Downloads…");
    entityCache.setAccent(entry, "rgba(29, 185, 84, 0.58)");
    try {
      let tracks = [];
      let usedDl = false;
      if (window.dl?.listDownloads) {
        try {
          if (window.dl?.migrateLegacy) await window.dl.migrateLegacy();
        } catch {}
        try {
          const res = await window.dl.listDownloads();
          if (res?.ok === false) throw new Error("list_downloads_failed");
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
          usedDl = true;
        } catch {
          usedDl = false;
        }
      }
      if (!usedDl) {
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
      const { subtitleEl } = renderLibraryHeader({
        container,
        title: "Downloads",
        subtitleText: `${tracks.length} songs`,
        gradientCss: "linear-gradient(135deg, rgba(29, 185, 84, 0.92) 0%, rgba(16, 16, 16, 0.92) 78%)",
        iconClass: "ri-download-2-fill",
      });

      if (tracks.length === 0) {
        renderLibraryEmptyCallout({
          container,
          title: "No downloads yet.",
          description: "Search, play, and download tracks to see them here.",
        });
        return true;
      }

      const list = buildLibraryTrackList({
        tracks,
        pageContext: "downloads",
        formatDuration,
        lib,
        registerTrackList,
        likeAriaLabel: "Like",
      });

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

            const idx = tracks.findIndex((t) => Number(t?.id || t?.SNG_ID) === tid);
            if (idx >= 0) tracks.splice(idx, 1);

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

            for (let i = 0; i < remaining.length; i++) {
              const r = remaining[i];
              r.dataset.trackIndex = String(i);
              const num = r.querySelector(".entity-track__num");
              if (num) num.textContent = String(i + 1);
            }
            registerTrackList(list, tracks, { pageContext: "downloads" });

            if (subtitleEl) subtitleEl.textContent = `${tracks.length} songs`;

            if (tracks.length === 0) {
              try {
                list.remove();
              } catch {}
              renderLibraryEmptyCallout({
                container,
                title: "No downloads yet.",
                description: "Search, play, and download tracks to see them here.",
              });
            }

            return true;
          },
        };
      } catch {}

      container.appendChild(list);
    } catch (e) {
      renderEmptyText(container, String(e?.message || e || "Failed to load"));
    }
    return true;
  };

  return { renderLikedInto, renderDownloadsInto };
}
