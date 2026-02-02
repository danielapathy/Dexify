export function updateRangeFill(range) {
  const min = Number(range.min || 0);
  const max = Number(range.max || 100);
  const value = Number(range.value || 0);
  const pct = ((value - min) / (max - min)) * 100;
  range.style.setProperty("--pct", `${pct}%`);
}

export function debounce(fn, waitMs) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      t = null;
      fn(...args);
    }, waitMs);
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function readJsonFromLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function normalizeTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function extractAverageColorFromImageUrl(url) {
  const { extractPrimaryColorFromImageUrl } = await import("./color.js");
  return await extractPrimaryColorFromImageUrl(url, { maxRes: 220, k: 8, iters: 10, centerBias: true, edgeWeight: true });
}

export function formatFansCountText(value) {
  const s = String(value || "");
  if (!s) return "";

  const nf = new Intl.NumberFormat("en-US");

  // e.g. "Artist • 256 673 fans" -> "Artist • 256,673 fans"
  let out = s.replace(/(\d[\d\s]{2,})(?=\s*(?:fans?|fan)\b)/gi, (m) => {
    const digits = m.replace(/[^\d]/g, "");
    if (!digits) return m;
    const n = Number(digits);
    if (!Number.isFinite(n)) return m;
    return nf.format(n);
  });

  // Drop stray letters after the count before "fans" (e.g. "256,673a fans").
  out = out.replace(/(\d[\d,]*)([a-z])(?=\s*(?:fans?|fan)\b)/gi, "$1");

  // Ensure a space exists before "fans" if the source omitted it (e.g. "256,673fans").
  out = out.replace(/(\d)(?=(?:fans?|fan)\b)/gi, "$1 ");

  return out;
}

export function normalizeRecordType(value) {
  const v = String(value || "")
    .trim()
    .toLowerCase();
  if (!v) return "";
  if (v === "album" || v === "single" || v === "ep" || v === "compilation") return v;
  if (v === "compile") return "compilation";
  return v;
}

export function formatRecordTypeLabel(value, { fallback = "Album" } = {}) {
  const rt = normalizeRecordType(value);
  if (rt === "single") return "Single";
  if (rt === "ep") return "EP";
  if (rt === "compilation") return "Compilation";
  if (rt === "album") return "Album";
  if (!rt) return String(fallback || "Album");
  return `${rt.slice(0, 1).toUpperCase()}${rt.slice(1)}`;
}
