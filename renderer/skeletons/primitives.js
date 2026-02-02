export function makeSkelLine({ className = "", width = "100%", height = "12px" } = {}) {
  const el = document.createElement("div");
  el.className = `skel skel-line${className ? ` ${className}` : ""}`;
  el.style.width = width;
  el.style.height = height;
  return el;
}

export function makeSkelBlock({ className = "", width = "100%", height = "100%" } = {}) {
  const el = document.createElement("div");
  el.className = `skel${className ? ` ${className}` : ""}`;
  el.style.width = width;
  el.style.height = height;
  return el;
}

export function getFontMetricsPx(el) {
  try {
    const st = getComputedStyle(el);
    const fontSize = Number.parseFloat(st.fontSize) || 14;
    const lineHeightRaw = st.lineHeight;
    const lineHeight = lineHeightRaw === "normal" ? fontSize * 1.2 : Number.parseFloat(lineHeightRaw) || fontSize * 1.2;
    return { fontSize, lineHeight };
  } catch {
    return { fontSize: 14, lineHeight: 16.8 };
  }
}

function parsePx(value) {
  const n = Number.parseFloat(String(value || ""));
  return Number.isFinite(n) ? n : 0;
}

export function measureClassTextMetrics(className, { sampleText = "Hg" } = {}) {
  if (!document?.body) return { fontSize: 14, lineHeight: 16.8, marginTop: 0, marginBottom: 0 };

  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-9999px";
  host.style.top = "-9999px";
  host.style.width = "400px";
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";

  const el = document.createElement("div");
  el.className = String(className || "").trim();
  el.textContent = sampleText;
  host.appendChild(el);
  document.body.appendChild(host);

  try {
    const st = getComputedStyle(el);
    const fontSize = parsePx(st.fontSize) || 14;
    const lineHeightRaw = st.lineHeight;
    const lineHeight = lineHeightRaw === "normal" ? fontSize * 1.2 : parsePx(lineHeightRaw) || fontSize * 1.2;
    const marginTop = parsePx(st.marginTop);
    const marginBottom = parsePx(st.marginBottom);
    return { fontSize, lineHeight, marginTop, marginBottom };
  } catch {
    return { fontSize: 14, lineHeight: 16.8, marginTop: 0, marginBottom: 0 };
  } finally {
    try {
      host.remove();
    } catch {}
  }
}
