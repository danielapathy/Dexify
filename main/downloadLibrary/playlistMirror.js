const fs = require("node:fs");
const path = require("node:path");

function ensurePlaylistTrackMirror({
  playlistsRoot,
  playlistId,
  trackId,
  quality,
  sourceAudioPath,
  trackJson,
  ensureDir,
  safeStat,
  readJson,
  writeJsonAtomic,
  toIdString,
  normalizeQuality,
}) {
  const pid = toIdString(playlistId);
  const tid = toIdString(trackId);
  const q = normalizeQuality(quality);
  const src = typeof sourceAudioPath === "string" ? sourceAudioPath : "";
  if (!pid || !tid || !q || !src) return { ok: false, error: "bad_request" };

  const srcStat = safeStat(src);
  if (!srcStat || !srcStat.isFile() || srcStat.size <= 0) return { ok: false, error: "missing_source_audio" };

  const playlistDir = path.join(playlistsRoot, pid);
  const trackDir = path.join(playlistDir, "tracks", tid, q);
  ensureDir(trackDir);

  const ext = path.extname(src) || (q === "flac" ? ".flac" : ".mp3");
  const destAudioPath = path.join(trackDir, `audio${ext}`);

  const destStat = safeStat(destAudioPath);
  if (!destStat || !destStat.isFile() || destStat.size <= 0) {
    try {
      fs.linkSync(src, destAudioPath);
    } catch {
      try {
        fs.copyFileSync(src, destAudioPath);
      } catch (e) {
        return { ok: false, error: "mirror_failed", message: String(e?.message || e || "mirror_failed") };
      }
    }
  }

  try {
    const tj = trackJson && typeof trackJson === "object" ? trackJson : null;
    if (tj) {
      const trackJsonPath = path.join(trackDir, "track.json");
      const prev = readJson(trackJsonPath);
      if (!prev) writeJsonAtomic(trackJsonPath, tj);
    }
  } catch {}

  const itemsJsonPath = path.join(playlistDir, "items.json");
  const existing = readJson(itemsJsonPath);
  const prevTrackIds = Array.isArray(existing?.trackIds) ? existing.trackIds : Array.isArray(existing) ? existing : [];
  const prevDownloads = existing?.downloads && typeof existing.downloads === "object" ? existing.downloads : {};
  const next = {
    trackIds: prevTrackIds,
    downloads: {
      ...prevDownloads,
      [tid]: { audioPath: destAudioPath, quality: q, updatedAt: Date.now() },
    },
  };
  try {
    writeJsonAtomic(itemsJsonPath, next);
  } catch {}

  return { ok: true, playlistId: Number(pid), trackId: Number(tid), quality: q, audioPath: destAudioPath, itemsJsonPath };
}

module.exports = { ensurePlaylistTrackMirror };
