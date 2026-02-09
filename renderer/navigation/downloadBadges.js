export function createDownloadBadges({ lib, entityView }) {
  const inFlightByTrackId = new Map(); // trackId -> { status, progress, uuid, updatedAt }

  const parseUuid = (uuid) => {
    const s = String(uuid || "").trim();
    if (!s) return null;
    let m = s.match(/^(?:track|dl)_(\d+)_(\d+)/);
    if (!m) m = s.match(/(?:^|_)track_(\d+)_(\d+)/);
    if (!m) return null;
    return { trackId: Number(m[1]), bitrate: Number(m[2]) };
  };

  const rememberMeta = ({ trackId, title, artist, cover, albumId, albumTitle }) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return;
    const map = window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById : {};
    map[String(id)] = {
      title: String(title || ""),
      artist: String(artist || ""),
      cover: String(cover || ""),
      albumId: Number.isFinite(Number(albumId)) ? Number(albumId) : null,
      albumTitle: String(albumTitle || ""),
      at: Date.now(),
    };
    window.__downloadMetaById = map;
  };

  const getDownloadedState = () => {
    const state = lib?.load?.() || {};
    return state.downloadedTracks && typeof state.downloadedTracks === "object" ? state.downloadedTracks : {};
  };

  const isTrackDownloaded = (trackId, downloadedTracks) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const downloaded = downloadedTracks || getDownloadedState();
    const entry = downloaded[String(id)] && typeof downloaded[String(id)] === "object" ? downloaded[String(id)] : null;
    const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
    return Boolean(fileUrl);
  };

  const looksLikeDownloading = (trackId, downloadedTracks) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    if (inFlightByTrackId.has(id)) return true;

    const downloaded = downloadedTracks || getDownloadedState();
    const entry = downloaded[String(id)] && typeof downloaded[String(id)] === "object" ? downloaded[String(id)] : null;
    const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
    const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
    const at = Number(entry?.download?.at) || 0;
    if (fileUrl) return false;
    if (!uuid || !at) return false;
    return Date.now() - at < 10 * 60 * 1000;
  };

  const setIcon = (badge, iconClass) => {
    const el = badge && badge.nodeType === 1 ? badge : null;
    if (!el) return;
    const i = el.querySelector("i");
    if (i) {
      i.className = String(iconClass || "");
      i.setAttribute("aria-hidden", "true");
    } else {
      el.innerHTML = `<i class="${String(iconClass || "")}" aria-hidden="true"></i>`;
    }
  };

  const applyToRow = (row, downloadedTracks = null) => {
    const r = row && row.nodeType === 1 ? row : null;
    if (!r) return;
    const badge = r.querySelector(".entity-track__download");
    if (!badge) return;
    const trackId = Number(r.dataset.trackId);
    if (!Number.isFinite(trackId) || trackId <= 0) return;

    const downloading = looksLikeDownloading(trackId, downloadedTracks);
    const downloaded = !downloading && isTrackDownloaded(trackId, downloadedTracks);

    badge.classList.toggle("is-downloading", downloading);
    badge.classList.toggle("is-downloaded", downloaded);

    if (downloading) setIcon(badge, "ri-loader-4-line");
    else if (downloaded) setIcon(badge, "ri-download-2-fill");
    else setIcon(badge, "ri-download-2-line");

    r.dataset.downloaded = downloaded ? "1" : "0";
    if (r.closest(".entity-tracks--dl")) r.dataset.selectDisabled = downloaded ? "0" : "1";
  };

  const applyToTrackId = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return;
    const root = entityView && entityView.nodeType === 1 ? entityView : null;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll(`.entity-tracks--dl .entity-track[data-track-id="${id}"]`));
    const downloaded = getDownloadedState();
    for (const row of rows) applyToRow(row, downloaded);
  };

  const applyAll = () => {
    const root = entityView && entityView.nodeType === 1 ? entityView : null;
    if (!root) return;
    const rows = Array.from(root.querySelectorAll(".entity-tracks--dl .entity-track[data-track-id]"));
    const downloaded = getDownloadedState();
    for (const row of rows) applyToRow(row, downloaded);
  };

  const schedule = (() => {
    let raf = 0;
    let forceAll = false;
    const pending = new Set();
    return (trackId = null) => {
      const id = Number(trackId);
      if (Number.isFinite(id) && id > 0) pending.add(id);
      else forceAll = true;

      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (forceAll) {
          forceAll = false;
          pending.clear();
          applyAll();
          return;
        }
        const ids = Array.from(pending);
        pending.clear();
        for (const tid of ids) applyToTrackId(tid);
      });
    };
  })();

  window.addEventListener("local-library:changed", () => schedule());
  window.addEventListener("nav:viewChanged", () => schedule());

  if (window.dl?.onEvent) {
    window.dl.onEvent((payload) => {
      const event = String(payload?.event || "");
      const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
      const uuid = String(data?.uuid || "").trim();
      const fromData = Number(data?.id);
      const parsed = uuid ? parseUuid(uuid) : null;
      const trackId = Number.isFinite(fromData) && fromData > 0 ? fromData : parsed?.trackId ?? null;
      if (!Number.isFinite(trackId) || trackId <= 0) return;

      if (event === "downloadRequested") {
        inFlightByTrackId.set(trackId, { status: "queued", progress: 0, uuid, updatedAt: Date.now() });
        schedule(trackId);
        return;
      }

      if (event === "updateQueue") {
        const progress = typeof data?.progress === "number" ? data.progress : null;
        inFlightByTrackId.set(trackId, { status: "downloading", progress, uuid, updatedAt: Date.now() });
        schedule(trackId);
        return;
      }

      if (event === "downloadFinished" || event === "finishDownload" || event === "downloadFailed") {
        inFlightByTrackId.delete(trackId);
        schedule(trackId);
      }
    });
  }

  // Initial pass (in case the first view renders before any events fire).
  schedule();

  return { applyToRow, rememberMeta };
}
