export function createEntityDownloadAction({ lib, getActiveEntry }) {
  const getDownloadedTracks = () => {
    const st = lib?.load?.() || {};
    return st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
  };

  const isTrackDownloaded = (trackId, downloadedTracks) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const entry =
      downloadedTracks[String(id)] && typeof downloadedTracks[String(id)] === "object" ? downloadedTracks[String(id)] : null;
    const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
    return Boolean(fileUrl);
  };

  const computeStats = (trackIds, downloadedTracks) => {
    const ids = Array.isArray(trackIds) ? trackIds : [];
    const total = ids.length;
    if (total === 0) return { total: 0, downloaded: 0, remaining: 0 };
    let downloaded = 0;
    for (const tid of ids) {
      if (isTrackDownloaded(tid, downloadedTracks)) downloaded++;
    }
    return { total, downloaded, remaining: Math.max(0, total - downloaded) };
  };

  const resolveLabel = (baseLabel, stats) => {
    const label = String(baseLabel || "").trim() || "Download";
    const total = Number(stats?.total) || 0;
    const remaining = Number(stats?.remaining) || 0;
    if (total <= 0) return label;
    if (remaining <= 0) return "Downloaded";
    if (remaining < total) return `Download remaining ${remaining} track${remaining === 1 ? "" : "s"}`;
    return label;
  };

  const applyToEntry = (entry) => {
    const e = entry && typeof entry === "object" ? entry : null;
    if (!e) return;

    const downloadState = e?.downloadAction && typeof e.downloadAction === "object" ? e.downloadAction : null;
    if (downloadState) {
      const btn = downloadState.btn && downloadState.btn.nodeType === 1 ? downloadState.btn : null;
      const removeBtn = downloadState.removeBtn && downloadState.removeBtn.nodeType === 1 ? downloadState.removeBtn : null;
      if (btn) {
        const label = String(downloadState.label || "").trim();
        const trackIds = Array.isArray(downloadState.trackIds) ? downloadState.trackIds : [];
        const downloadedTracks = getDownloadedTracks();
        const stats = computeStats(trackIds, downloadedTracks);
        const fullyDownloaded = stats.total > 0 && stats.remaining === 0;
        const partial = stats.downloaded > 0 && stats.remaining > 0;
        const hasAny = stats.downloaded > 0;

        btn.dataset.downloadRemaining = String(stats.remaining);
        btn.dataset.downloadTotal = String(stats.total);
        btn.dataset.deleteMode = "0";

        let tooltip;
        if (fullyDownloaded) {
          tooltip = "Downloaded";
          btn.classList.add("is-disabled");
          btn.setAttribute("aria-disabled", "true");
        } else {
          btn.classList.remove("is-disabled");
          btn.setAttribute("aria-disabled", "false");
          if (partial) {
            tooltip = `Download remaining ${stats.remaining} track${stats.remaining === 1 ? "" : "s"}`;
          } else {
            tooltip = resolveLabel(label, stats);
          }
        }
        try {
          btn.dataset.tooltip = tooltip;
          btn.setAttribute("aria-label", tooltip);
        } catch {}

        const icon = btn.querySelector("i");
        if (icon) icon.className = fullyDownloaded ? "ri-check-line" : "ri-download-2-line";
      }

      if (removeBtn) {
        const trackIds = Array.isArray(downloadState.trackIds) ? downloadState.trackIds : [];
        const downloadedTracks = getDownloadedTracks();
        const stats = computeStats(trackIds, downloadedTracks);
        const hasAny = stats.downloaded > 0;
        if (hasAny) {
          removeBtn.classList.remove("is-hidden");
        } else {
          removeBtn.classList.add("is-hidden");
        }
      }
    }

  };

  const applyActive = () => {
    try {
      applyToEntry(getActiveEntry?.());
    } catch {}
  };

  const schedule = (() => {
    let raf = 0;
    return () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyActive();
      });
    };
  })();

  window.addEventListener("local-library:changed", () => schedule());
  window.addEventListener("nav:viewChanged", () => schedule());
  if (window.dl?.onEvent) {
    window.dl.onEvent((payload) => {
      const event = String(payload?.event || "");
      if (event === "downloadFinished" || event === "downloadFailed" || event === "downloadCancelled" || event === "downloadGroupPlanned") {
        schedule();
      }
    });
  }

  schedule();

  const bind = (entry, btn, { label, trackIds, removeBtn } = {}) => {
    const e = entry && typeof entry === "object" ? entry : null;
    const b = btn && btn.nodeType === 1 ? btn : null;
    if (!e || !b) return;

    e.downloadAction = {
      btn: b,
      label: String(label || "").trim(),
      trackIds: Array.isArray(trackIds) ? trackIds : [],
      removeBtn: removeBtn && removeBtn.nodeType === 1 ? removeBtn : null,
    };
    applyToEntry(e);
  };

  return { bind, schedule };
}
