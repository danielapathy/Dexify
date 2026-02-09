const fs = require("node:fs");
const path = require("node:path");

const { ensureDir, listDirents } = require("./fs");

const AUDIO_EXTS = new Set([".mp3", ".flac", ".m4a", ".mp4", ".ogg", ".wav"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function toIdString(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(Math.trunc(n));
}

function normalizeQuality(value) {
  const q = String(value || "").trim().toLowerCase();
  if (!q) return null;
  if (q === "flac") return "flac";
  if (q === "mp3_320" || q === "320" || q === "mp3-320") return "mp3_320";
  if (q === "mp3_128" || q === "128" || q === "mp3-128") return "mp3_128";
  return q;
}

function pickBestQuality(qualities, preferred) {
  const p = normalizeQuality(preferred);
  if (p && qualities[p]) return p;
  if (qualities.flac) return "flac";
  if (qualities.mp3_320) return "mp3_320";
  if (qualities.mp3_128) return "mp3_128";
  const keys = Object.keys(qualities || {});
  return keys[0] || null;
}

function inferAlbumCoverUrl(album) {
  if (!album || typeof album !== "object") return "";
  const candidates = [
    album.cover_xl,
    album.cover_big,
    album.cover_medium,
    album.cover_small,
    album.cover,
    album.picture_xl,
    album.picture_big,
    album.picture_medium,
    album.picture_small,
    album.picture,
  ];
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s) return s;
  }
  return "";
}

async function downloadBinaryToFile(url, destPath, { timeoutMs = 15000 } = {}) {
  const u = String(url || "").trim();
  if (!u) return { ok: false, error: "missing_url" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(u, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: "http_error", status: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    ensureDir(path.dirname(destPath));
    fs.writeFileSync(destPath, buf);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: "fetch_failed", message: String(e?.message || e) };
  } finally {
    clearTimeout(timeout);
  }
}

function moveFileSync(fromPath, toPath) {
  ensureDir(path.dirname(toPath));
  try {
    fs.renameSync(fromPath, toPath);
    return { ok: true };
  } catch {
    try {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "move_failed", message: String(e?.message || e) };
    }
  }
}

function findFirstFileByExt(dirPath, extSet) {
  const entries = listDirents(dirPath);
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!extSet.has(ext)) continue;
    return path.join(dirPath, ent.name);
  }
  return null;
}

function findFirstFileRecursive(rootDir, extSet) {
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    const entries = listDirents(dir);
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (!extSet.has(ext)) continue;
      return full;
    }
  }
  return null;
}

module.exports = {
  AUDIO_EXTS,
  IMAGE_EXTS,
  toIdString,
  normalizeQuality,
  pickBestQuality,
  inferAlbumCoverUrl,
  downloadBinaryToFile,
  moveFileSync,
  findFirstFileByExt,
  findFirstFileRecursive,
};
