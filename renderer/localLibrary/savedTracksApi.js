export function createSavedTracksApi({ load, save, notify, compactTrackJson, coverFromTrack }) {
  const addSavedTrack = (track) => {
    const t = track && typeof track === "object" ? track : null;
    const id = Number(t?.id || t?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    next.savedTracks[String(id)] = {
      id,
      title: String(t?.title || t?.SNG_TITLE || ""),
      artist: String(t?.artist?.name || t?.ART_NAME || ""),
      artistId: t?.artist?.id ? Number(t.artist.id) : t?.ART_ID ? Number(t.ART_ID) : null,
      duration: Number(t?.duration || t?.DURATION || 0) || 0,
      explicit: Boolean(t?.explicit_lyrics || t?.EXPLICIT_LYRICS),
      albumId: t?.album?.id ? Number(t.album.id) : t?.ALB_ID ? Number(t.ALB_ID) : null,
      albumTitle: String(t?.album?.title || t?.ALB_TITLE || ""),
      albumCover: coverFromTrack(t, { includeSmallAlbumCover: false, size: 250 }),
      addedAt: now,
    };
    save(next);
    notify();
    return true;
  };

  const removeSavedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.savedTracks[String(id)];
    save(next);
    notify();
    return true;
  };

  const isTrackSaved = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const state = load();
    return Boolean(state.savedTracks[String(id)]);
  };

  const listSavedTracks = () => {
    const state = load();
    const items = Object.values(state.savedTracks || {});
    items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return items;
  };

  const getSavedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const state = load();
    const saved = state.savedTracks && typeof state.savedTracks === "object" ? state.savedTracks : {};
    const found = saved[String(id)] && typeof saved[String(id)] === "object" ? saved[String(id)] : null;
    if (!found) return null;
    const cover = String(found?.albumCover || "").trim();
    return {
      id,
      title: String(found?.title || ""),
      duration: Number(found?.duration) || 0,
      explicit_lyrics: Boolean(found?.explicit),
      artist: { id: Number(found?.artistId) || null, name: String(found?.artist || "") },
      album: {
        id: Number(found?.albumId) || null,
        title: String(found?.albumTitle || ""),
        cover_small: cover,
        cover_medium: cover,
        cover: cover,
      },
      ...(found?.download && typeof found.download === "object" ? { download: { ...found.download } } : {}),
    };
  };

  const upsertTrackDownload = ({ trackId, fileUrl, downloadPath, quality }) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    const existing = next.savedTracks[String(id)];
    if (!existing) return false;
    existing.download = {
      fileUrl: String(fileUrl || ""),
      downloadPath: String(downloadPath || ""),
      quality: String(quality || ""),
      at: Date.now(),
    };
    save(next);
    notify();
    return true;
  };

  const upsertDownloadedTrack = ({ track, fileUrl, downloadPath, fileSize, quality, uuid }) => {
    const t = track && typeof track === "object" ? track : null;
    const id = Number(t?.id || t?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.downloadedTracks[String(id)] || {};

    const albumCover = coverFromTrack(t, { includeSmallAlbumCover: false, size: 250 }) || String(existing.albumCover || "");
    const nextTrackJson = compactTrackJson(t) || existing.trackJson || null;
    const nextFileSize = Number(fileSize) || Number(existing.fileSize) || 0;

    next.downloadedTracks[String(id)] = {
      id,
      title: String(t?.title || t?.SNG_TITLE || existing.title || ""),
      artist: String(t?.artist?.name || t?.ART_NAME || existing.artist || ""),
      artistId:
        t?.artist?.id
          ? Number(t.artist.id)
          : t?.ART_ID
            ? Number(t.ART_ID)
            : Number(existing.artistId) || (nextTrackJson?.artist?.id ? Number(nextTrackJson.artist.id) : null),
      duration: Number(t?.duration || t?.DURATION || existing.duration || 0) || 0,
      explicit: Boolean(t?.explicit_lyrics || t?.EXPLICIT_LYRICS || existing.explicit),
      albumId: t?.album?.id ? Number(t.album.id) : t?.ALB_ID ? Number(t.ALB_ID) : existing.albumId ?? null,
      albumTitle: String(t?.album?.title || t?.ALB_TITLE || existing.albumTitle || ""),
      albumCover,
      downloadedAt: existing.downloadedAt || now,
      updatedAt: now,
      fileSize: nextFileSize,
      trackJson: nextTrackJson,
      download: {
        uuid: String(uuid || existing?.download?.uuid || ""),
        fileUrl: String(fileUrl || existing?.download?.fileUrl || ""),
        downloadPath: String(downloadPath || existing?.download?.downloadPath || ""),
        quality: String(quality || existing?.download?.quality || ""),
        at: now,
      },
    };
    save(next);
    notify();
    return true;
  };

  const removeDownloadedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    let changed = false;

    if (!next.downloadedTracks || typeof next.downloadedTracks !== "object") next.downloadedTracks = {};
    if (next.downloadedTracks[String(id)]) {
      delete next.downloadedTracks[String(id)];
      changed = true;
    }

    // Also clear download metadata from savedTracks (keep the saved track itself).
    if (next.savedTracks && typeof next.savedTracks === "object") {
      const saved = next.savedTracks[String(id)];
      if (saved && typeof saved === "object" && saved.download) {
        delete saved.download;
        changed = true;
      }
    }

    if (!changed) return false;
    save(next);
    notify();
    try {
      window.dispatchEvent(new CustomEvent("local-library:trackRemoved", { detail: { trackId: id } }));
    } catch {}
    return true;
  };

  const listDownloadedTracks = ({ requireFile = true } = {}) => {
    const state = load();
    const items = Object.values(state.downloadedTracks || {});
    const filtered = requireFile ? items.filter((track) => track?.download?.fileUrl) : items;
    filtered.sort((a, b) => (b.download?.at || b.updatedAt || 0) - (a.download?.at || a.updatedAt || 0));
    return filtered;
  };

  return {
    addSavedTrack,
    removeSavedTrack,
    isTrackSaved,
    listSavedTracks,
    getSavedTrack,
    upsertTrackDownload,
    upsertDownloadedTrack,
    removeDownloadedTrack,
    listDownloadedTracks,
  };
}
