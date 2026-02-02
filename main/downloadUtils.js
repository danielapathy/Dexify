const path = require("node:path");
const fs = require("node:fs");

function sanitizeDownloadUuid(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  if (s.length > 120) return null;
  if (!/^[a-z0-9_\-]+$/i.test(s)) return null;
  return s;
}

function inferDownloadUuidFromDeezerUrl(url, bitrate) {
  const u = String(url || "").trim();
  if (!u) return null;
  const m = u.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist)\/(\d+)/i);
  if (!m) return null;
  const type = String(m[1]).toLowerCase();
  const id = String(m[2]);
  const candidate = `url_${type}_${id}_${Number(bitrate) || 0}`;
  return sanitizeDownloadUuid(candidate);
}

function normalizeDownloadedFilePath(maybePath, baseDir, allowedRootDir) {
  try {
    const raw = String(maybePath || "");
    if (!raw) return null;
    const absolute = path.isAbsolute(raw) ? raw : path.join(String(baseDir || ""), raw);

    const root = path.resolve(String(allowedRootDir || ""));
    const full = path.resolve(absolute);
    if (full !== root && !full.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
    return full;
  } catch {
    return null;
  }
}

function resolvePathFromDeemixObject(obj, downloadLocation) {
  if (!obj || typeof obj !== "object") return null;
  const files = Array.isArray(obj.files) ? obj.files : [];
  if (files.length === 0) return null;
  const extrasPath = obj?.extrasPath ? String(obj.extrasPath) : "";

  const candidatePaths = [];
  for (const f of files) {
    const p = f?.path ? String(f.path) : "";
    if (p) {
      candidatePaths.push(p);
      if (downloadLocation && !path.isAbsolute(p)) candidatePaths.push(path.join(downloadLocation, p));
    }

    const filename = f?.filename ? String(f.filename) : "";
    if (filename && extrasPath) candidatePaths.push(path.join(extrasPath, filename));
    if (filename && downloadLocation) candidatePaths.push(path.join(downloadLocation, filename));
  }

  for (const p of candidatePaths) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}

function listAudioFiles(rootDir) {
  const exts = new Set([".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".wav"]);
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(ent.name).toLowerCase();
      if (!exts.has(ext)) continue;
      out.push(full);
    }
  };
  walk(rootDir);
  return out;
}

function findMostRecentDownloadFile(rootDir) {
  const files = listAudioFiles(rootDir);
  let best = null;
  for (const p of files) {
    let st = null;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!best || st.mtimeMs > best.mtimeMs) best = { path: p, mtimeMs: st.mtimeMs };
  }
  return best?.path || null;
}

module.exports = {
  sanitizeDownloadUuid,
  inferDownloadUuidFromDeezerUrl,
  normalizeDownloadedFilePath,
  resolvePathFromDeemixObject,
  listAudioFiles,
  findMostRecentDownloadFile,
};
