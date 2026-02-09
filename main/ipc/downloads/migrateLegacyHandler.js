const fs = require("node:fs");
const path = require("node:path");

function createMigrateLegacyHandler({ getDzClient, library, getDownloadsDir, tryFetchTrack, tryFetchAlbumFull, toIdString, safeRmDir }) {
  return async function handleMigrateLegacy() {
    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    library.ensureLoaded();

    const downloadsRoot = getDownloadsDir();
    let entries = [];
    try {
      entries = fs.readdirSync(downloadsRoot, { withFileTypes: true });
    } catch {
      entries = [];
    }

    const legacy = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const m = String(ent.name).match(/^track_(\d+)_(\d+)$/);
      if (!m) continue;
      const trackId = Number(m[1]);
      const bitrate = Number(m[2]);
      if (!Number.isFinite(trackId) || trackId <= 0) continue;
      legacy.push({ dir: path.join(downloadsRoot, ent.name), trackId, bitrate });
    }

    const results = [];
    for (const item of legacy) {
      const quality = item.bitrate === 9 ? "flac" : item.bitrate === 3 ? "mp3_320" : "mp3_128";
      try {
        const resolvedTrack = await tryFetchTrack(dzRes.dz, item.trackId);
        if (!resolvedTrack) {
          results.push({ trackId: item.trackId, ok: false, error: "missing_track_metadata" });
          continue;
        }
        const albumId = toIdString(resolvedTrack?.album?.id) || toIdString(resolvedTrack?.ALB_ID) || null;
        if (!albumId) {
          results.push({ trackId: item.trackId, ok: false, error: "missing_album_context" });
          continue;
        }
        const album = await tryFetchAlbumFull(dzRes.dz, albumId);
        if (!album) {
          results.push({ trackId: item.trackId, ok: false, error: "missing_album_metadata" });
          continue;
        }
        await library.ensureAlbumMetadata({ albumId, albumJson: album });
        const adopted = await library.ensureTrackStoredFromStaging({
          albumId,
          trackId: item.trackId,
          quality,
          stagingDir: item.dir,
          trackJson: resolvedTrack,
          albumJson: album,
        });
        if (adopted?.ok) {
          safeRmDir(item.dir);
          results.push({ trackId: item.trackId, ok: true });
        } else {
          results.push({ trackId: item.trackId, ok: false, error: adopted?.error || "adopt_failed" });
        }
      } catch (e) {
        results.push({ trackId: item.trackId, ok: false, error: "adopt_failed", message: String(e?.message || e) });
      }
    }

    return { ok: true, migrated: results.filter((r) => r.ok).length, total: results.length, results };
  };
}

module.exports = { createMigrateLegacyHandler };
