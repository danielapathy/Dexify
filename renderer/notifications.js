import { getLocalLibrary } from "./localLibrary.js";

export function wireNotifications() {
  const btn = document.getElementById("notificationsBtn");
  if (!btn) return;
  if (!window.dl?.onEvent) return;

  const menu = document.createElement("div");
  menu.id = "notificationsMenu";
  menu.className = "notifications-menu";
  menu.hidden = true;
  menu.tabIndex = -1;
  document.body.appendChild(menu);

  const downloads = new Map();

  const summarizeActiveCount = () => {
    let n = 0;
    for (const d of downloads.values()) {
      if (d.status === "queued" || d.status === "downloading") n++;
    }
    return n;
  };

  const setBadge = () => {
    const active = summarizeActiveCount();
    btn.dataset.badge = active > 0 ? String(active) : "";
  };

  const render = () => {
    const items = Array.from(downloads.values());
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const rows = items.filter((d) => d.status === "queued" || d.status === "downloading").slice(0, 18);

    const header = `
      <div class="notifications-menu__header">
        <div class="notifications-menu__title">Downloads</div>
        <div class="notifications-menu__meta">${rows.length > 0 ? `${rows.length} active` : "No active downloads"}</div>
      </div>
    `;

    const list =
      rows.length === 0
        ? `<div class="notifications-menu__empty">Nothing here yet.</div>`
        : `<div class="notifications-menu__list">
            ${rows
              .map((d) => {
                const title = String(d.title || d.uuid || "Download");
                const status = d.status === "queued" ? "Queued" : "Downloading";
                const pct = typeof d.progress === "number" ? Math.max(0, Math.min(100, d.progress)) : null;
                return `
                  <div class="notifications-menu__item" data-status="${d.status}" data-uuid="${String(d.uuid || "")}">
                    <div class="notifications-menu__itemMain">
                      <div class="notifications-menu__itemTitle">${title}</div>
                      <div class="notifications-menu__itemSubtitle">${status}${pct !== null && d.status === "downloading" ? ` • ${Math.floor(pct)}%` : ""}</div>
                    </div>
                    ${pct !== null && (d.status === "downloading" || d.status === "queued") ? `<div class="notifications-menu__bar"><span style="width:${Math.floor(pct)}%"></span></div>` : ""}
                  </div>
                `;
              })
              .join("")}
          </div>`;
    menu.innerHTML = header + list;
  };

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      render();
      const rect = btn.getBoundingClientRect();
      const x = Math.round(rect.right - 360);
      const y = Math.round(rect.bottom + 10);
      menu.style.left = `${Math.max(12, x)}px`;
      menu.style.top = `${Math.max(12, y)}px`;
      menu.focus();
    }
  };

  const isOpen = () => !menu.hidden;

  btn.addEventListener("click", () => setOpen(!isOpen()));

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (menu.contains(event.target)) return;
    if (btn.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") setOpen(false);
  });

  menu.addEventListener("click", () => {});

  window.dl.onEvent((payload) => {
    const event = String(payload?.event || "");
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const uuid = String(data.uuid || "");
    if (!uuid) return;

    const prev =
      downloads.get(uuid) || {
        uuid,
        status: "queued",
        progress: null,
        updatedAt: 0,
        title: "",
        errorMessage: "",
        errorStack: "",
        errorDebug: null,
      };
    const next = { ...prev };
    next.updatedAt = Date.now();

    if (event === "downloadRequested") {
      next.status = "queued";
      next.progress = 0;
      next.errorMessage = "";
      next.errorStack = "";
      next.errorDebug = null;
      if (data.id) {
        const meta = window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById[String(data.id)] : null;
        const title = String(meta?.title || "");
        const artist = String(meta?.artist || "");
        next.title = title ? `${title}${artist ? ` • ${artist}` : ""}` : `Track #${data.id}`;
      }
      else if (data.url) next.title = String(data.url);
    } else if (event === "updateQueue") {
      if (typeof data.progress === "number") {
        next.status = "downloading";
        next.progress = data.progress;
      }
      if (data.downloaded || data.alreadyDownloaded) {
        next.status = "downloading";
        next.progress = 100;
      }
    } else if (event === "downloadFinished") {
      next.status = "done";
      next.progress = 100;
    } else if (event === "finishDownload") {
      next.status = "done";
      if (typeof next.progress !== "number") next.progress = 100;
    } else if (event === "downloadFailed") {
      next.status = "failed";
      next.errorMessage = String(data?.message || data?.err || data?.error || "Download failed");
      next.errorStack = typeof data?.stack === "string" ? data.stack : "";
      next.errorDebug = data?.debug && typeof data.debug === "object" ? data.debug : null;

      const st = window.__player?.getState?.();
      if (st?.downloadUuid && String(st.downloadUuid) === uuid) {
        const tid = String(st?.track?.id || "");
        const meta =
          tid && window.__downloadMetaById && typeof window.__downloadMetaById === "object"
            ? window.__downloadMetaById[tid]
            : null;
        window.__modal?.showError?.({
          title: "Download failed",
          subtitle:
            (/desired bitrate/i.test(String(next.errorMessage || "")) || /bitrate/i.test(String(next.errorMessage || "")))
              ? "Try lowering download quality in Settings → Downloads → Quality."
              : next.title || "",
          message: next.errorMessage,
          stack: next.errorStack,
          debug: next.errorDebug,
          trackTitle: String(st?.track?.title || meta?.title || ""),
          trackArtist: String(st?.track?.artist || meta?.artist || ""),
          coverUrl: String(st?.track?.cover || meta?.cover || ""),
        });
      }
    }

    // Keep the menu focused on active downloads only:
    // - Failed downloads are cancelled (errors show in the modal instead).
    // - Completed downloads auto-dismiss shortly after finishing.
    if (next.status === "failed") {
      downloads.delete(uuid);
    } else {
      downloads.set(uuid, next);
      if (next.status === "done") {
        setTimeout(() => {
          downloads.delete(uuid);
          setBadge();
          if (isOpen()) render();
        }, 1500);
      }
    }
    setBadge();
    if (isOpen()) render();
  });

  setBadge();
}

export function wireDownloads() {
  if (!window.dl?.onEvent) return;

  const lib = getLocalLibrary();
  const artistEl = document.getElementById("playerArtist");

  const toNumId = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const syncDownloadsFromDisk = async () => {
    if (!window.dl?.listDownloads) return;
    try {
      const res = await window.dl.listDownloads();
      const rows = Array.isArray(res?.tracks) ? res.tracks : [];
      if (rows.length === 0) return;

      lib.mutate((state, { markDirty }) => {
        if (!state.downloadedTracks || typeof state.downloadedTracks !== "object") state.downloadedTracks = {};
        const downloaded = state.downloadedTracks;

        for (const row of rows) {
          const track = row?.track && typeof row.track === "object" ? row.track : null;
          const album = row?.album && typeof row.album === "object" ? row.album : track?.album && typeof track.album === "object" ? track.album : null;

          const trackId = toNumId(row?.trackId || track?.id || track?.SNG_ID);
          if (!trackId) continue;

          const existing = downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;

          const fileUrl = String(row?.fileUrl || existing?.download?.fileUrl || "").trim();
          if (!fileUrl) continue;
          const downloadPath = String(row?.audioPath || row?.downloadPath || existing?.download?.downloadPath || "").trim();
          const quality = String(row?.bestQuality || existing?.download?.quality || "").trim();

          const artistName = String(track?.artist?.name || track?.ART_NAME || existing?.artist || "").trim();
          const artistId = toNumId(track?.artist?.id || track?.ART_ID || existing?.artistId);

          const albumId = toNumId(row?.albumId || album?.id || album?.ALB_ID || track?.ALB_ID || track?.album_id || existing?.albumId);
          const albumTitle = String(album?.title || track?.ALB_TITLE || existing?.albumTitle || "").trim();
          const cover = String(
            row?.coverUrl ||
              album?.cover_medium ||
              album?.cover ||
              track?.album?.cover_medium ||
              track?.album?.cover ||
              track?.cover ||
              existing?.albumCover ||
              "",
          ).trim();

          const title = String(track?.title || track?.SNG_TITLE || existing?.title || "").trim();
          const duration = Number(track?.duration || track?.DURATION || existing?.duration || 0) || 0;
          const explicit = Boolean(track?.explicit_lyrics || track?.EXPLICIT_LYRICS || existing?.explicit);

          const prevDownload = existing?.download && typeof existing.download === "object" ? existing.download : {};
          const rowMtime = Number(row?.mtimeMs) || 0;
          const nextDownloadAt = Number(prevDownload?.at) || rowMtime || 0;
          const nextDownloadedAt = Number(existing?.downloadedAt) || nextDownloadAt || 0;
          const nextUpdatedAt = Number(existing?.updatedAt) || nextDownloadedAt || 0;

          const nextTrackJson =
            existing?.trackJson && typeof existing.trackJson === "object"
              ? existing.trackJson
              : {
                  id: trackId,
                  title,
                  duration,
                  explicit_lyrics: explicit,
                  artist: { id: artistId, name: artistName },
                  album: {
                    id: albumId,
                    title: albumTitle,
                    cover_small: cover,
                    cover_medium: cover,
                    cover,
                  },
                  ...(cover ? { cover } : {}),
                };

          const next = {
            ...(existing && typeof existing === "object" ? existing : {}),
            id: trackId,
            title,
            artist: artistName,
            ...(artistId ? { artistId } : {}),
            duration,
            explicit,
            ...(albumId ? { albumId } : {}),
            albumTitle,
            albumCover: cover,
            downloadedAt: nextDownloadedAt,
            updatedAt: nextUpdatedAt,
            trackJson: nextTrackJson,
            download: {
              uuid: String(prevDownload?.uuid || ""),
              fileUrl,
              downloadPath,
              quality,
              at: nextDownloadAt,
              mtimeMs: rowMtime || Number(prevDownload?.mtimeMs) || 0,
            },
          };

	          const prev = existing || null;
	          const changed =
	            !prev ||
	            String(prev?.download?.fileUrl || "") !== String(next.download.fileUrl || "") ||
	            String(prev?.download?.downloadPath || "") !== String(next.download.downloadPath || "") ||
	            String(prev?.download?.quality || "") !== String(next.download.quality || "") ||
	            Number(prev?.download?.at || 0) !== Number(next.download.at || 0) ||
	            Number(prev?.download?.mtimeMs || 0) !== Number(next.download.mtimeMs || 0) ||
	            Number(prev?.downloadedAt || 0) !== Number(next.downloadedAt || 0) ||
	            Number(prev?.updatedAt || 0) !== Number(next.updatedAt || 0) ||
	            String(prev?.albumCover || "") !== String(next.albumCover || "") ||
	            String(prev?.albumTitle || "") !== String(next.albumTitle || "") ||
	            Number(prev?.albumId || 0) !== Number(next.albumId || 0) ||
	            String(prev?.title || "") !== String(next.title || "");

          if (!changed) continue;
          downloaded[String(trackId)] = next;
          markDirty();
        }
      });
    } catch {}
  };

  // On cold start, rehydrate local library download state from the downloads DB on disk.
  setTimeout(() => void syncDownloadsFromDisk(), 120);

  window.dl.onEvent((payload) => {
    const event = String(payload?.event || "");
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const uuid = String(data?.uuid || "").trim();
    if (!uuid) return;

    // Keep Downloads in sync for track downloads (even if they weren't initiated via the player).
    if (event === "downloadRequested" || event === "downloadFinished" || event === "downloadFailed") {
      const parseTrackRef = () => {
        const fromData = Number(data?.id);
        const fromDataBitrate = Number(data?.bitrate);
        if (Number.isFinite(fromData) && fromData > 0) {
          return { trackId: fromData, bitrate: Number.isFinite(fromDataBitrate) ? fromDataBitrate : null };
        }

        const m1 = uuid.match(/^(?:track|dl)_(\d+)_(\d+)/);
        if (m1) return { trackId: Number(m1[1]), bitrate: Number(m1[2]) };

        const m2 = uuid.match(/(?:^|_)track_(\d+)_(\d+)/);
        if (m2) return { trackId: Number(m2[1]), bitrate: Number(m2[2]) };

        return { trackId: null, bitrate: null };
      };

      const ref = parseTrackRef();
      const trackId = Number(ref?.trackId);
      const bitrate = Number(ref?.bitrate);
      if (Number.isFinite(trackId) && trackId > 0) {
        const quality = bitrate === 9 ? "flac" : bitrate === 3 ? "mp3_320" : "mp3_128";

        if (event === "downloadRequested") {
          const meta =
            window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById[String(trackId)] : null;
          lib.upsertDownloadedTrack?.({
            track: {
              id: trackId,
              title: String(meta?.title || ""),
              artist: { name: String(meta?.artist || "") },
              album: { cover_medium: String(meta?.cover || ""), cover: String(meta?.cover || "") },
            },
            fileUrl: "",
            downloadPath: "",
            quality,
            uuid,
          });
        } else if (event === "downloadFinished") {
          lib.upsertDownloadedTrack?.({
            track: { id: trackId },
            fileUrl: String(data?.fileUrl || ""),
            downloadPath: String(data?.downloadPath || ""),
            quality,
            uuid,
          });
        } else if (event === "downloadFailed") {
          // Don't strand the UI in a "downloading" state if the track was never written to disk.
          try {
            const st = lib.load?.() || {};
            const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
            const entry = downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;
            const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
            if (!fileUrl) lib.removeDownloadedTrack?.(trackId);
          } catch {}
        }
      }
    }

    const st = window.__player?.getState?.();
    if (!st || !st.downloadUuid) return;
    if (uuid !== st.downloadUuid) return;

    if (event === "updateQueue" && typeof data.progress === "number") {
      if (artistEl) artistEl.textContent = `Downloading… ${Math.floor(data.progress)}%`;
    }
    if (event === "downloadFinished") {
      if (artistEl && st.track?.artist) artistEl.textContent = st.track.artist;
    }
  });
}
