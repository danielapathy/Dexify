import { getDownloadQualityRaw, normalizeDownloadQuality, setDownloadQualityRaw } from "../settings.js";

function isElement(node) {
  return Boolean(node && node.nodeType === 1);
}

export function createPlayerAudioMenu({
  rootEl,
  audioSettingsBtn,
  getQualitySetting,
  setQualitySetting,
  switchQualityForCurrentTrack,
  applyNormalizeRouting,
  getNormalizeEnabled,
  setNormalizeEnabled,
  getAudioCtx,
} = {}) {
  const root = isElement(rootEl) ? rootEl : null;
  const btn = isElement(audioSettingsBtn) ? audioSettingsBtn : null;

  const getQ = typeof getQualitySetting === "function" ? getQualitySetting : () => getDownloadQualityRaw();
  const setQ = typeof setQualitySetting === "function" ? setQualitySetting : () => {};
  const switchQuality = typeof switchQualityForCurrentTrack === "function" ? switchQualityForCurrentTrack : () => {};
  const applyNormalize = typeof applyNormalizeRouting === "function" ? applyNormalizeRouting : () => {};

  const getNorm = typeof getNormalizeEnabled === "function" ? getNormalizeEnabled : () => false;
  const setNorm = typeof setNormalizeEnabled === "function" ? setNormalizeEnabled : () => {};

  const getCtx = typeof getAudioCtx === "function" ? getAudioCtx : () => null;

  if (!root || !btn) return null;

  const wrap = document.createElement("div");
  wrap.className = "player-audio-popover";
  wrap.hidden = true;

  const panel = document.createElement("div");
  panel.className = "player-audio-popover__panel";

  const title = document.createElement("div");
  title.className = "player-audio-popover__title";
  title.textContent = "Audio Quality";
  panel.appendChild(title);

  const options = [
    { value: "mp3_128", label: "Normal", sub: "MP3 • 128 kbps" },
    { value: "mp3_320", label: "High", sub: "MP3 • 320 kbps" },
    { value: "flac", label: "Lossless", sub: "FLAC" },
  ];

  const optionButtons = [];
  for (const opt of options) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "player-audio-option";
    b.dataset.quality = opt.value;
    b.innerHTML =
      `<span class="player-audio-option__main">` +
      `<span class="player-audio-option__label">${opt.label}</span>` +
      `<span class="player-audio-option__sub">${opt.sub}</span>` +
      `</span>` +
      `<span class="player-audio-option__right">` +
      `<span class="player-audio-option__lock"><i class="ri-lock-2-line icon" aria-hidden="true"></i></span>` +
      `<span class="player-audio-option__check"><i class="ri-check-line icon" aria-hidden="true"></i></span>` +
      `</span>`;
    optionButtons.push(b);
    panel.appendChild(b);
  }

  const divider = document.createElement("div");
  divider.className = "player-audio-divider";
  panel.appendChild(divider);

  const toggleRow = document.createElement("div");
  toggleRow.className = "player-audio-toggle";
  toggleRow.innerHTML =
    `<div>` +
    `<div class="player-audio-toggle__label">Normalize audio</div>` +
    `<div class="player-audio-toggle__desc">Adjusts sound to maintain the same volume level</div>` +
    `</div>`;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "toggle-switch";
  toggle.setAttribute("aria-label", "Normalize audio");
  toggleRow.appendChild(toggle);
  panel.appendChild(toggleRow);

  wrap.appendChild(panel);
  document.body.appendChild(wrap);

  const loadEntitlements = async () => {
    if (!window.dz?.getCapabilities) {
      window.__dzCapabilities = { can_stream_hq: false, can_stream_lossless: false };
      return window.__dzCapabilities;
    }
    try {
      const res = await window.dz.getCapabilities();
      const caps = res?.ok && res?.capabilities && typeof res.capabilities === "object" ? res.capabilities : null;
      window.__dzCapabilities = {
        can_stream_hq: Boolean(caps?.can_stream_hq),
        can_stream_lossless: Boolean(caps?.can_stream_lossless),
      };
    } catch {
      window.__dzCapabilities = { can_stream_hq: false, can_stream_lossless: false };
    }
    return window.__dzCapabilities;
  };

  const applyEntitlements = (caps) => {
    const canHQ = Boolean(caps?.can_stream_hq);
    const canLossless = Boolean(caps?.can_stream_lossless);
    for (const b of optionButtons) {
      const q = String(b.dataset.quality || "");
      const disabled = (q === "mp3_320" && !canHQ) || (q === "flac" && !canLossless);
      b.disabled = disabled;
      b.classList.toggle("is-disabled", disabled);
    }

    const normalized = getQ();
    const raw = getDownloadQualityRaw({ fallback: "" });
    if (raw && normalizeDownloadQuality(raw) !== normalized) {
      setDownloadQualityRaw(normalized);
    }
  };

  const sync = () => {
    const caps = window.__dzCapabilities && typeof window.__dzCapabilities === "object" ? window.__dzCapabilities : null;
    applyEntitlements(caps);
    const q = getQ();
    for (const b of optionButtons) b.classList.toggle("is-active", b.dataset.quality === q);
    const norm = Boolean(getNorm());
    toggle.dataset.on = norm ? "true" : "false";
    toggle.setAttribute("aria-pressed", norm ? "true" : "false");
  };

  const position = () => {
    const rect = btn.getBoundingClientRect();
    wrap.style.left = `${Math.round(rect.right)}px`;
    wrap.style.top = `${Math.round(rect.top)}px`;
  };

  const close = () => {
    wrap.hidden = true;
  };

  // Register with global dropdown system
  if (!window.__dropdownMenus) window.__dropdownMenus = new Set();
  window.__dropdownMenus.add(close);

  const closeAllDropdowns = (except) => {
    if (!window.__dropdownMenus) return;
    for (const fn of window.__dropdownMenus) {
      if (fn !== except && typeof fn === "function") {
        try { fn(); } catch {}
      }
    }
  };

  const open = async () => {
    closeAllDropdowns(close);
    wrap.hidden = false;
    position();
    const caps = await loadEntitlements();
    applyEntitlements(caps);
    sync();
    const ctx = getCtx();
    if (ctx) {
      try {
        await ctx.resume();
      } catch {}
    }
  };

  const toggleOpen = () => {
    if (wrap.hidden) {
      void open();
    } else {
      close();
    }
  };

  const onBtnClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleOpen();
  };

  const onPanelClick = (event) => {
    const b = event.target?.closest?.(".player-audio-option");
    if (!b) return;
    event.preventDefault();
    if (b.disabled || b.classList.contains("is-disabled")) return;
    setQ(b.dataset.quality);
    sync();
    void switchQuality();
  };

  const onToggleClick = (event) => {
    event.preventDefault();
    const next = !Boolean(getNorm());
    setNorm(next);
    void applyNormalize(next);
    sync();
  };

  const onDocMouseDown = (event) => {
    if (wrap.hidden) return;
    if (event.target === btn || btn.contains(event.target)) return;
    if (wrap.contains(event.target)) return;
    close();
  };

  const onDocKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (wrap.hidden) return;
    close();
  };

  const onResize = () => {
    if (wrap.hidden) return;
    position();
  };

  btn.addEventListener("click", onBtnClick);
  panel.addEventListener("click", onPanelClick);
  toggle.addEventListener("click", onToggleClick);
  document.addEventListener("mousedown", onDocMouseDown);
  document.addEventListener("keydown", onDocKeyDown);
  window.addEventListener("resize", onResize);

  sync();

  const destroy = () => {
    try {
      btn.removeEventListener("click", onBtnClick);
      panel.removeEventListener("click", onPanelClick);
      toggle.removeEventListener("click", onToggleClick);
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
      window.removeEventListener("resize", onResize);
    } catch {}
    try {
      wrap.remove();
    } catch {}
  };

  return { open, close, sync, destroy };
}

