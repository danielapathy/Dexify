const { createDownloadLibrary } = require("../downloadLibrary");

function compactText(value, { max = 140 } = {}) {
  const s = String(value || "").trim().replace(/\s+/g, " ");
  if (!s) return "";
  const limit = Math.max(8, Math.min(1000, Number(max) || 140));
  return s.length > limit ? `${s.slice(0, limit - 1)}…` : s;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function summarizeDownloadedTracks({ downloadsDir, limitTracks = 250, limitAlbums = 80 } = {}) {
  if (!downloadsDir) return { ok: false, error: "bad_request" };

  const tracksLimit = Math.max(0, Math.min(2_000, Number(limitTracks) || 250));
  const albumsLimit = Math.max(0, Math.min(500, Number(limitAlbums) || 80));

  const library = createDownloadLibrary({ downloadsDir });
  library.ensureLoaded();

  const res = library.listDownloadedTracks();
  if (!res?.ok) return res && typeof res === "object" ? res : { ok: false, error: "list_failed" };

  const rows = Array.isArray(res.tracks) ? res.tracks : [];
  const simplified = rows
    .map((row) => {
      const track = row?.track && typeof row.track === "object" ? row.track : null;
      const album = row?.album && typeof row.album === "object" ? row.album : null;
      const trackId = toInt(row?.trackId || track?.id || track?.SNG_ID);
      const albumId = toInt(row?.albumId || album?.id || album?.ALB_ID || track?.album?.id);
      const title = compactText(track?.title || track?.SNG_TITLE || "");
      const artist = compactText(track?.artist?.name || track?.ART_NAME || "");
      const albumTitle = compactText(album?.title || album?.ALB_TITLE || track?.album?.title || "");
      const quality = compactText(row?.bestQuality || "");
      const fileSize = Number(row?.fileSize) || 0;
      const downloadedAt = Number(row?.mtimeMs) || 0;
      return {
        trackId,
        title,
        artist,
        albumId,
        album: albumTitle,
        quality,
        fileSize,
        downloadedAt,
      };
    })
    .filter((t) => t.trackId && (t.title || t.artist || t.album));

  simplified.sort((a, b) => (b.downloadedAt || 0) - (a.downloadedAt || 0));
  const tracks = simplified.slice(0, tracksLimit);

  const albumsById = new Map();
  for (const t of tracks) {
    const key = t.albumId ? String(t.albumId) : "";
    if (!key) continue;
    const existing = albumsById.get(key) || { albumId: t.albumId, title: t.album, tracks: [] };
    existing.tracks.push({ trackId: t.trackId, title: t.title, artist: t.artist, quality: t.quality, downloadedAt: t.downloadedAt });
    if (!existing.title) existing.title = t.album;
    albumsById.set(key, existing);
  }

  const albums = Array.from(albumsById.values())
    .sort((a, b) => b.tracks.length - a.tracks.length)
    .slice(0, albumsLimit);

  return {
    ok: true,
    totals: { tracks: simplified.length, albums: albumsById.size },
    tracks,
    albums,
  };
}

function summarizeDownloadedPlaylists({ downloadsDir, limit = 120 } = {}) {
  if (!downloadsDir) return { ok: false, error: "bad_request" };
  const take = Math.max(0, Math.min(500, Number(limit) || 120));

  const library = createDownloadLibrary({ downloadsDir });
  library.ensureLoaded();
  if (typeof library.listDownloadedPlaylists !== "function") return { ok: false, error: "not_supported" };
  const res = library.listDownloadedPlaylists();
  if (!res?.ok) return res && typeof res === "object" ? res : { ok: false, error: "list_failed" };

  const rows = Array.isArray(res.playlists) ? res.playlists : [];
  return {
    ok: true,
    playlists: rows.slice(0, take).map((p) => ({
      playlistId: toInt(p?.playlistId),
      title: compactText(p?.title || ""),
      total: toInt(p?.total) || 0,
      downloaded: toInt(p?.downloaded) || 0,
      updatedAt: Number(p?.updatedAt) || 0,
    })),
  };
}

module.exports = {
  summarizeDownloadedTracks,
  summarizeDownloadedPlaylists,
};

