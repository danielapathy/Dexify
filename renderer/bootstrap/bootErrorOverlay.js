function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function mountBootErrorOverlay({ error, onReload } = {}) {
  const msg = error?.stack ? String(error.stack) : String(error?.message || error || "Unknown error");

  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "99999";
  overlay.style.background = "rgba(0, 0, 0, 0.92)";
  overlay.style.color = "rgba(255, 255, 255, 0.92)";
  overlay.style.padding = "22px";
  overlay.style.fontFamily =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  overlay.style.overflow = "auto";

  overlay.innerHTML = `
    <div style="max-width: 980px; margin: 0 auto;">
      <h1 style="margin: 0 0 10px; font-size: 18px; font-weight: 800;">Dexify failed to start</h1>
      <div style="margin: 0 0 14px; opacity: 0.75; font-size: 13px;">
        Open DevTools (View \u2192 Toggle Developer Tools) for details. You can also click Reload below.
      </div>
      <pre style="white-space: pre-wrap; word-break: break-word; padding: 12px; border-radius: 10px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.10);">${escapeHtml(
        msg,
      )}</pre>
      <button id="bootErrorReload" style="margin-top: 14px; padding: 10px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.10); color: rgba(255,255,255,0.92); cursor: pointer; font-weight: 700;">
        Reload
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector("#bootErrorReload")?.addEventListener?.("click", () => (onReload ? onReload() : window.location.reload()));
  return overlay;
}

