export function createEntityHeaderRenderer({ lib, getDownloadQualityRaw, entityDownloadAction, normalizeRecordType }) {
  return function renderEntityHeader({ container, type, entityId, title, subtitle, cover, data, tracksWithCover, entry }) {
    const header = document.createElement("div");
    header.className = "entity-header";

    const coverEl = document.createElement("div");
    coverEl.className = "entity-cover";
    const img = document.createElement("img");
    img.alt = "";
    if (cover) img.src = cover;
    coverEl.appendChild(img);

    const meta = document.createElement("div");
    meta.className = "entity-meta";
    const h1 = document.createElement("div");
    h1.className = "entity-title";
    h1.textContent = String(title);
    const sub = document.createElement("div");
    sub.className = "entity-subtitle";
    sub.textContent = subtitle;
    meta.appendChild(h1);
    meta.appendChild(sub);

    const buildActionBtn = ({ icon, tooltip, primary, onClick }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `entity-action-btn${primary ? " is-primary" : ""}`;
      btn.setAttribute("aria-label", tooltip);
      btn.dataset.tooltip = tooltip;
      btn.innerHTML = `<i class="${icon}" aria-hidden="true"></i>`;
      if (typeof onClick === "function") {
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          if (btn.getAttribute("aria-disabled") === "true" || btn.classList.contains("is-disabled")) return;
          onClick();
        });
      }
      return btn;
    };

    if (type === "album" || type === "playlist" || type === "smarttracklist") {
      const actions = document.createElement("div");
      actions.className = "entity-actions";

	      actions.appendChild(
	        buildActionBtn({
	          icon: "ri-play-fill",
	          tooltip: "Play",
	          primary: true,
          onClick: async () => {
            if (!window.__player) return;
            const q = Array.isArray(tracksWithCover) ? tracksWithCover : [];
            if (q.length === 0) return;
            const entityIdNum = Number(entityId);
            const canContext = (type === "playlist" || type === "album") && Number.isFinite(entityIdNum) && entityIdNum > 0;
            const context = canContext
              ? {
                  type,
                  id: entityIdNum,
                  title: String(title || ""),
                  cover: String(cover || ""),
                }
              : null;
            await window.__player.setQueueAndPlay(q, 0, context ? { context } : undefined);
          },
        }),
	      );

        if (type === "album" || type === "playlist") {
          const entityIdNum = Number(entityId);

        const entityTrackIds = (() => {
          const ids = new Set();
          for (const t of Array.isArray(tracksWithCover) ? tracksWithCover : []) {
            const tid = Number(t?.id || t?.SNG_ID);
            if (Number.isFinite(tid) && tid > 0) ids.add(tid);
          }
          return Array.from(ids);
        })();

        const buildSavePayload = () => {
          const base = { id: entityIdNum, title: String(title || "") };
          if (type === "album") {
            const artistObj = data?.artist && typeof data.artist === "object" ? data.artist : { name: String(data?.artist?.name || "") };
            return {
              ...base,
              artist: artistObj,
              record_type: String(data?.record_type || data?.recordType || "").trim() || undefined,
              cover_medium: String(cover || data?.cover_medium || data?.cover || ""),
              cover: String(cover || data?.cover || ""),
            };
          }
          const creatorObj = data?.creator && typeof data.creator === "object" ? data.creator : { name: String(data?.creator?.name || "") };
          return {
            ...base,
            creator: creatorObj,
            picture_medium: String(cover || data?.picture_medium || data?.picture || ""),
            picture: String(cover || data?.picture || ""),
          };
        };

        if (window.dl?.downloadUrl) {
          const label =
            type === "playlist"
              ? "Download playlist"
	              : (() => {
                  const rt = normalizeRecordType(data?.record_type || data?.recordType);
                  if (rt === "single") return "Download single";
                  if (rt === "ep") return "Download EP";
                  if (rt === "compilation") return "Download compilation";
                  return "Download album";
                })();

          const downloadTrackIds = entityTrackIds;

          const getDownloadedStats = () => {
            try {
              const st = lib.load?.() || {};
              const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
              let have = 0;
              for (const tid of downloadTrackIds) {
                const row = downloaded[String(tid)] && typeof downloaded[String(tid)] === "object" ? downloaded[String(tid)] : null;
                const fileUrl = row?.download?.fileUrl ? String(row.download.fileUrl) : "";
                if (fileUrl) have++;
              }
              return { total: downloadTrackIds.length, downloaded: have };
            } catch {
              return { total: downloadTrackIds.length, downloaded: 0 };
            }
          };

          const isFullyDownloaded = () => {
            const stats = getDownloadedStats();
            return stats.total > 0 && stats.downloaded >= stats.total;
          };

          const hasAnyDownloaded = () => {
            const stats = getDownloadedStats();
            return stats.downloaded > 0;
          };

          const downloadBtn = buildActionBtn({
            icon: "ri-download-2-line",
            tooltip: label,
            onClick: async () => {
              if (isFullyDownloaded()) return;
              if (!window.dl?.downloadUrl) return;
              try {
                const payload = buildSavePayload();
                if (type === "album") lib.addSavedAlbum?.(payload);
                else lib.addSavedPlaylist?.(payload);
              } catch {}
              const quality = getDownloadQualityRaw();
              void window.dl.downloadUrl({ url: `https://www.deezer.com/${type}/${entityId}`, quality });
            },
          });
          downloadBtn.dataset.action = "entity-download";
          actions.appendChild(downloadBtn);

          const removeTooltip = (() => {
            if (type === "playlist") return "Delete playlist";
            const rt = normalizeRecordType(data?.record_type || data?.recordType);
            if (rt === "single") return "Delete single";
            if (rt === "ep") return "Delete EP";
            if (rt === "compilation") return "Delete compilation";
            return "Delete album";
          })();

          const removeBtn = buildActionBtn({
            icon: "ri-delete-bin-6-line",
            tooltip: removeTooltip,
            onClick: async () => {
              try { window.__trackMultiSelect?.exit?.(); } catch {}
              try {
                if (type === "album" && window.dl?.deleteAlbumFromDisk) {
                  await window.dl.deleteAlbumFromDisk({ id: entityIdNum });
                } else if (type === "playlist" && window.dl?.deletePlaylistFromDisk) {
                  await window.dl.deletePlaylistFromDisk({ id: entityIdNum });
                }
                try { await window.dl?.scanLibrary?.(); } catch {}
              } catch {}
              for (const tid of downloadTrackIds) {
                try { lib.removeDownloadedTrack?.(tid); } catch {}
              }
              try {
                if (type === "album") lib.removeSavedAlbum?.(entityIdNum);
                else lib.removeSavedPlaylist?.(entityIdNum);
              } catch {}
              try { entityDownloadAction?.schedule?.(); } catch {}
            },
          });
          removeBtn.classList.add("entity-remove-btn");
          if (!hasAnyDownloaded()) removeBtn.classList.add("is-hidden");
          removeBtn.dataset.action = "entity-remove";
          actions.appendChild(removeBtn);

          try {
            entityDownloadAction.bind(entry, downloadBtn, { label, trackIds: downloadTrackIds, removeBtn });
          } catch {}
        }
        meta.appendChild(actions);
      }
	    } else if (type === "artist") {
      const actions = document.createElement("div");
      actions.className = "entity-actions";

      actions.appendChild(
        buildActionBtn({
          icon: "ri-play-fill",
          tooltip: "Play top tracks",
          primary: true,
          onClick: async () => {
            if (!window.__player) return;
            const q = Array.isArray(tracksWithCover) ? tracksWithCover : [];
            if (q.length === 0) return;
            await window.__player.setQueueAndPlay(q, 0);
          },
        }),
      );

      actions.appendChild(
        buildActionBtn({
          icon: "ri-download-cloud-2-line",
          tooltip: "Download all artist albums",
          onClick: () => {
            if (!window.dl?.downloadUrl) return;
            const quality = getDownloadQualityRaw();
            void window.dl.downloadUrl({ url: `https://www.deezer.com/artist/${entityId}`, quality });
          },
        }),
      );

      meta.appendChild(actions);
    }

    header.appendChild(coverEl);
    header.appendChild(meta);
    container.appendChild(header);
  };
}
