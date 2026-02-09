export function createSavedCollectionsApi({ load, save, notify, normalizeRecordType, md5ToCoverUrl }) {
  const addSavedAlbum = (album) => {
    const a = album && typeof album === "object" ? album : null;
    const id = Number(a?.id || a?.ALB_ID || a?.ALBUM_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.savedAlbums[String(id)] && typeof next.savedAlbums[String(id)] === "object" ? next.savedAlbums[String(id)] : {};
    const md5 = String(a?.md5_image || a?.ALB_PICTURE || existing?.md5_image || "");
    const cover =
      String(a?.cover_medium || a?.cover_small || a?.cover || a?.picture_medium || a?.picture || a?.coverUrl || a?.imageUrl || "").trim() ||
      md5ToCoverUrl(md5) ||
      String(existing?.cover || "").trim() ||
      "";

    const recordType =
      normalizeRecordType(a?.record_type || a?.recordType || existing?.recordType || existing?.record_type) ||
      normalizeRecordType(existing?.recordType || existing?.record_type) ||
      "";

    next.savedAlbums[String(id)] = {
      id,
      title: String(a?.title || a?.ALB_TITLE || existing?.title || ""),
      artist: String(a?.artist?.name || a?.artist?.ART_NAME || a?.ART_NAME || existing?.artist || ""),
      recordType,
      cover,
      addedAt: Number(existing?.addedAt) || now,
      updatedAt: now,
      downloadedAt: Number(existing?.downloadedAt) || null,
    };
    save(next);
    notify();
    return true;
  };

  const removeSavedAlbum = (albumId) => {
    const id = Number(albumId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.savedAlbums[String(id)];
    save(next);
    notify();
    return true;
  };

  const isAlbumSaved = (albumId) => {
    const id = Number(albumId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const state = load();
    return Boolean(state.savedAlbums && typeof state.savedAlbums === "object" && state.savedAlbums[String(id)]);
  };

  const listSavedAlbums = () => {
    const state = load();
    const items = Object.values(state.savedAlbums || {});
    items.sort((a, b) => (b.updatedAt || b.addedAt || 0) - (a.updatedAt || a.addedAt || 0));
    return items;
  };

  const markAlbumDownloaded = (album) => {
    const a = album && typeof album === "object" ? album : null;
    const id = Number(a?.id || a?.ALB_ID || a?.ALBUM_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.savedAlbums[String(id)] && typeof next.savedAlbums[String(id)] === "object" ? next.savedAlbums[String(id)] : {};
    const md5 = String(a?.md5_image || a?.ALB_PICTURE || existing?.md5_image || "");
    const cover =
      String(a?.cover_medium || a?.cover_small || a?.cover || a?.picture_medium || a?.picture || a?.coverUrl || a?.imageUrl || "").trim() ||
      md5ToCoverUrl(md5) ||
      String(existing?.cover || "").trim() ||
      "";

    const recordType =
      normalizeRecordType(a?.record_type || a?.recordType || existing?.recordType || existing?.record_type) ||
      normalizeRecordType(existing?.recordType || existing?.record_type) ||
      "";

    next.savedAlbums[String(id)] = {
      id,
      title: String(a?.title || a?.ALB_TITLE || existing?.title || ""),
      artist: String(a?.artist?.name || a?.artist?.ART_NAME || a?.ART_NAME || existing?.artist || ""),
      recordType,
      cover,
      addedAt: Number(existing?.addedAt) || now,
      updatedAt: now,
      downloadedAt: now,
    };
    save(next);
    notify();
    return true;
  };

  const addSavedPlaylist = (playlist) => {
    const p = playlist && typeof playlist === "object" ? playlist : null;
    const id = Number(p?.id || p?.playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.playlists[String(id)] && typeof next.playlists[String(id)] === "object" ? next.playlists[String(id)] : {};
    const cover =
      String(p?.picture_medium || p?.picture_small || p?.picture || p?.cover_medium || p?.cover || p?.coverUrl || p?.imageUrl || "").trim() ||
      String(existing?.cover || "").trim() ||
      "";

    next.playlists[String(id)] = {
      id,
      title: String(p?.title || existing?.title || ""),
      creator: String(p?.creator?.name || p?.user?.name || p?.USER_NAME || existing?.creator || ""),
      cover,
      addedAt: Number(existing?.addedAt) || now,
      updatedAt: now,
      downloadedAt: Number(existing?.downloadedAt) || null,
    };
    save(next);
    notify();
    return true;
  };

  const removeSavedPlaylist = (playlistId) => {
    const id = Number(playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.playlists[String(id)];
    save(next);
    notify();
    return true;
  };

  const isPlaylistSaved = (playlistId) => {
    const id = Number(playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const state = load();
    return Boolean(state.playlists && typeof state.playlists === "object" && state.playlists[String(id)]);
  };

  const listSavedPlaylists = () => {
    const state = load();
    const items = Object.values(state.playlists || {});
    items.sort((a, b) => (b.updatedAt || b.addedAt || 0) - (a.updatedAt || a.addedAt || 0));
    return items;
  };

  const markPlaylistDownloaded = (playlist) => {
    const p = playlist && typeof playlist === "object" ? playlist : null;
    const id = Number(p?.id || p?.playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.playlists[String(id)] && typeof next.playlists[String(id)] === "object" ? next.playlists[String(id)] : {};
    const cover =
      String(p?.picture_medium || p?.picture_small || p?.picture || p?.cover_medium || p?.cover || p?.coverUrl || p?.imageUrl || "").trim() ||
      String(existing?.cover || "").trim() ||
      "";

    next.playlists[String(id)] = {
      id,
      title: String(p?.title || existing?.title || ""),
      creator: String(p?.creator?.name || p?.user?.name || p?.USER_NAME || existing?.creator || ""),
      cover,
      addedAt: Number(existing?.addedAt) || now,
      updatedAt: now,
      downloadedAt: now,
    };
    save(next);
    notify();
    return true;
  };

  return {
    addSavedAlbum,
    removeSavedAlbum,
    isAlbumSaved,
    listSavedAlbums,
    markAlbumDownloaded,
    addSavedPlaylist,
    removeSavedPlaylist,
    isPlaylistSaved,
    listSavedPlaylists,
    markPlaylistDownloaded,
  };
}
