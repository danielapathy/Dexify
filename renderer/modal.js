function toText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function safeTrim(value) {
  return String(value || "").trim();
}

function buildDetailsText({ message, stack, debug }) {
  const parts = [];
  if (stack) parts.push(`Stack:\n${stack}`);
  if (debug) parts.push(`Debug:\n${typeof debug === "string" ? debug : JSON.stringify(debug, null, 2)}`);
  return parts.join("\n\n").trim();
}

export function wireModal() {
  if (document.getElementById("appModalOverlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "appModalOverlay";
  overlay.className = "modal-overlay";
  overlay.hidden = true;

  const card = document.createElement("div");
  card.className = "modal-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Dialog");

  const body = document.createElement("div");
  body.className = "modal-body";

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = "Something went wrong";

  const subtitleEl = document.createElement("div");
  subtitleEl.className = "modal-subtitle";
  subtitleEl.textContent = "";

  const track = document.createElement("div");
  track.className = "modal-track";
  track.hidden = true;

  const trackCover = document.createElement("div");
  trackCover.className = "modal-track__cover";
  const trackImg = document.createElement("img");
  trackImg.alt = "";
  trackCover.appendChild(trackImg);

  const trackMeta = document.createElement("div");
  trackMeta.className = "modal-track__meta";
  const trackName = document.createElement("div");
  trackName.className = "modal-track__name";
  const trackArtist = document.createElement("div");
  trackArtist.className = "modal-track__artist";
  trackMeta.appendChild(trackName);
  trackMeta.appendChild(trackArtist);

  track.appendChild(trackCover);
  track.appendChild(trackMeta);

  const msgEl = document.createElement("div");
  msgEl.className = "modal-message";
  msgEl.textContent = "";

  const detailsWrap = document.createElement("div");
  detailsWrap.className = "modal-details";

  const details = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "Details";

  const pre = document.createElement("pre");
  pre.className = "modal-pre";
  pre.textContent = "";

  details.appendChild(summary);
  details.appendChild(pre);
  detailsWrap.appendChild(details);

  body.appendChild(titleEl);
  body.appendChild(subtitleEl);
  body.appendChild(track);
  body.appendChild(msgEl);
  body.appendChild(detailsWrap);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "modal-btn modal-btn--ghost";
  cancelBtn.textContent = "Cancel";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "modal-btn modal-btn--ghost";
  copyBtn.textContent = "Copy details";

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.className = "modal-btn modal-btn--primary";
  primaryBtn.textContent = "Close";

  actions.appendChild(cancelBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(primaryBtn);

  card.appendChild(body);
  card.appendChild(actions);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let lastActive = null;

  const setOpen = (open) => {
    if (open) {
      lastActive = document.activeElement;
      overlay.hidden = false;
      document.body.dataset.modalOpen = "true";
      requestAnimationFrame(() => overlay.classList.add("is-open"));
      primaryBtn.focus();
      return;
    }
    overlay.classList.remove("is-open");
    document.body.dataset.modalOpen = "";
    setTimeout(() => {
      overlay.hidden = true;
      try {
        lastActive?.focus?.();
      } catch {}
      lastActive = null;
    }, 200);
  };

  const close = () => setOpen(false);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  cancelBtn.addEventListener("click", close);
  primaryBtn.addEventListener("click", close);

  let lastCopyText = "";
  copyBtn.addEventListener("click", async () => {
    if (overlay.hidden) return;
    const text = String(lastCopyText || pre.textContent || "");
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied";
      setTimeout(() => (copyBtn.textContent = "Copy details"), 900);
    } catch {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => (copyBtn.textContent = "Copy details"), 1200);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (overlay.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  window.__modal = {
    close,
    showError: ({
      title,
      subtitle,
      message,
      stack,
      debug,
      trackTitle,
      trackArtist: trackArtistText,
      coverUrl,
    } = {}) => {
      titleEl.textContent = safeTrim(title) || "Download failed";
      subtitleEl.textContent = safeTrim(subtitle);

      const msg = safeTrim(message);
      msgEl.textContent = msg || "An unexpected error occurred.";

      const detailsText = buildDetailsText({ stack: safeTrim(stack), debug });
      pre.textContent = detailsText || "(no details)";
      details.open = Boolean(detailsText);
      lastCopyText = buildDetailsText({ stack: safeTrim(stack), debug }) || msg;

      const tTitle = safeTrim(trackTitle);
      const tArtist = safeTrim(trackArtistText);
      const cover = safeTrim(coverUrl);
      track.hidden = !(tTitle || tArtist || cover);
      trackName.textContent = tTitle || "Unknown track";
      trackArtist.textContent = tArtist || "";
      if (cover) trackImg.src = cover;
      else trackImg.removeAttribute("src");

      setOpen(true);
    },
  };
}
