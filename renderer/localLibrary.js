import { normalizeRecordType, readJsonFromLocalStorage, writeJsonToLocalStorage } from "./utils.js";

export function createLocalLibrary() {
  const KEY = "spotify.localLibrary.v1";

  const defaultState = () => ({
    savedTracks: {},
    downloadedTracks: {},
    savedAlbums: {},
    playlists: {},
    recentTracks: [],
  });

  const md5ToCoverUrl = (md5, { size = 250 } = {}) => {
    const s = String(md5 || "").trim();
    if (!s || !/^[a-f0-9]{32}$/i.test(s)) return "";
    const n = Number(size);
    const px = Number.isFinite(n) && n > 0 ? Math.round(n) : 250;
    return `https://e-cdns-images.dzcdn.net/images/cover/${s}/${px}x${px}-000000-80-0-0.jpg`;
  };

  const load = () => {
    const parsed = readJsonFromLocalStorage(KEY, null);
    if (!parsed || typeof parsed !== "object") return defaultState();
    return {
      ...defaultState(),
      ...parsed,
      savedTracks: parsed.savedTracks && typeof parsed.savedTracks === "object" ? parsed.savedTracks : {},
      downloadedTracks: parsed.downloadedTracks && typeof parsed.downloadedTracks === "object" ? parsed.downloadedTracks : {},
      savedAlbums: parsed.savedAlbums && typeof parsed.savedAlbums === "object" ? parsed.savedAlbums : {},
      playlists: parsed.playlists && typeof parsed.playlists === "object" ? parsed.playlists : {},
      recentTracks: Array.isArray(parsed.recentTracks) ? parsed.recentTracks : [],
    };
  };

  const save = (next) => writeJsonToLocalStorage(KEY, next);

  const mutate = (fn) => {
    if (typeof fn !== "function") return false;
    const next = load();
    let dirty = false;
    const markDirty = () => {
      dirty = true;
    };
    try {
      fn(next, { markDirty });
    } catch {
      return false;
    }
    if (!dirty) return false;
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

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
      albumCover:
        String(t?.album?.cover_medium || t?.album?.cover || "") ||
        String(t?.cover || "") ||
        (String(t?.ALB_PICTURE || "").match(/^[a-f0-9]{32}$/i)
          ? `https://e-cdns-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/250x250-000000-80-0-0.jpg`
          : ""),
      addedAt: now,
    };
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const removeSavedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.savedTracks[String(id)];
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const isTrackSaved = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const s = load();
    return Boolean(s.savedTracks[String(id)]);
  };

  const listSavedTracks = () => {
    const s = load();
    const items = Object.values(s.savedTracks || {});
    items.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    return items;
  };

  const getSavedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const s = load();
    const saved = s.savedTracks && typeof s.savedTracks === "object" ? s.savedTracks : {};
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
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const removeSavedAlbum = (albumId) => {
    const id = Number(albumId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.savedAlbums[String(id)];
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const isAlbumSaved = (albumId) => {
    const id = Number(albumId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const s = load();
    return Boolean(s.savedAlbums && typeof s.savedAlbums === "object" && s.savedAlbums[String(id)]);
  };

  const listSavedAlbums = () => {
    const s = load();
    const items = Object.values(s.savedAlbums || {});
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
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const addSavedPlaylist = (playlist) => {
    const p = playlist && typeof playlist === "object" ? playlist : null;
    const id = Number(p?.id || p?.playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.playlists[String(id)] && typeof next.playlists[String(id)] === "object" ? next.playlists[String(id)] : {};

    const cover = String(p?.picture_medium || p?.picture_small || p?.picture || p?.cover_medium || p?.cover || p?.coverUrl || p?.imageUrl || "").trim() ||
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
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const removeSavedPlaylist = (playlistId) => {
    const id = Number(playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    delete next.playlists[String(id)];
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const isPlaylistSaved = (playlistId) => {
    const id = Number(playlistId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const s = load();
    return Boolean(s.playlists && typeof s.playlists === "object" && s.playlists[String(id)]);
  };

  const listSavedPlaylists = () => {
    const s = load();
    const items = Object.values(s.playlists || {});
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

    const cover = String(p?.picture_medium || p?.picture_small || p?.picture || p?.cover_medium || p?.cover || p?.coverUrl || p?.imageUrl || "").trim() ||
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
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
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
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const compactTrackJson = (t) => {
    const raw = t && typeof t === "object" ? t : null;
    if (!raw) return null;
    const id = Number(raw?.id || raw?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return null;

    const album = raw?.album && typeof raw.album === "object" ? raw.album : null;
    const artist = raw?.artist && typeof raw.artist === "object" ? raw.artist : null;

    const coverFallback =
      String(album?.cover_medium || album?.cover_small || album?.cover || "") ||
      String(raw?.cover || "") ||
      (String(raw?.ALB_PICTURE || "").match(/^[a-f0-9]{32}$/i)
        ? `https://e-cdns-images.dzcdn.net/images/cover/${raw.ALB_PICTURE}/250x250-000000-80-0-0.jpg`
        : "");

    return {
      id,
      title: String(raw?.title || raw?.SNG_TITLE || ""),
      duration: Number(raw?.duration || raw?.DURATION || 0) || 0,
      preview: String(raw?.preview || ""),
      explicit: Boolean(raw?.explicit_lyrics || raw?.EXPLICIT_LYRICS),
      artist: artist ? { id: Number(artist?.id) || null, name: String(artist?.name || "") } : { id: null, name: String(raw?.ART_NAME || "") },
      album: album
        ? {
            id: Number(album?.id) || null,
            title: String(album?.title || raw?.ALB_TITLE || ""),
            cover_small: String(album?.cover_small || coverFallback || ""),
            cover_medium: String(album?.cover_medium || coverFallback || ""),
            cover: String(album?.cover || coverFallback || ""),
          }
        : {
            id: Number(raw?.ALB_ID) || null,
            title: String(raw?.ALB_TITLE || ""),
            cover_small: String(coverFallback || ""),
            cover_medium: String(coverFallback || ""),
            cover: String(coverFallback || ""),
          },
    };
  };

  const upsertDownloadedTrack = ({ track, fileUrl, downloadPath, quality, uuid }) => {
    const t = track && typeof track === "object" ? track : null;
    const id = Number(t?.id || t?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = next.downloadedTracks[String(id)] || {};

    const albumCover =
      String(t?.album?.cover_medium || t?.album?.cover || "") ||
      String(t?.cover || "") ||
      (String(t?.ALB_PICTURE || "").match(/^[a-f0-9]{32}$/i)
        ? `https://e-cdns-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/250x250-000000-80-0-0.jpg`
        : "") ||
      String(existing.albumCover || "");

    const nextTrackJson = compactTrackJson(t) || existing.trackJson || null;

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
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const removeDownloadedTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    if (!next.downloadedTracks || typeof next.downloadedTracks !== "object") next.downloadedTracks = {};
    if (!next.downloadedTracks[String(id)]) return false;
    delete next.downloadedTracks[String(id)];
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const listDownloadedTracks = ({ requireFile = true } = {}) => {
    const s = load();
    const items = Object.values(s.downloadedTracks || {});
    const filtered = requireFile ? items.filter((t) => t?.download?.fileUrl) : items;
    filtered.sort((a, b) => (b.download?.at || b.updatedAt || 0) - (a.download?.at || a.updatedAt || 0));
    return filtered;
  };

  const addRecentTrack = (track) => {
    const t = track && typeof track === "object" ? track : null;
    const id = Number(t?.id || t?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const now = Date.now();
    const next = load();
    const existing = Array.isArray(next.recentTracks) ? next.recentTracks : [];
    const prev = existing.find((x) => Number(x?.id) === id) || null;

    const computedCover =
      String(t?.album?.cover_medium || t?.album?.cover_small || t?.album?.cover || "") ||
      String(t?.cover || "") ||
      (String(t?.ALB_PICTURE || "").match(/^[a-f0-9]{32}$/i)
        ? `https://e-cdns-images.dzcdn.net/images/cover/${t.ALB_PICTURE}/250x250-000000-80-0-0.jpg`
        : "");

    const prevCover =
      String(prev?.albumCover || "").trim() ||
      String(prev?.trackJson?.album?.cover_medium || prev?.trackJson?.album?.cover_small || prev?.trackJson?.album?.cover || "").trim() ||
      "";

    const cover = String(computedCover || prevCover || "").trim();

    const trackJson = compactTrackJson(t) || (prev?.trackJson && typeof prev.trackJson === "object" ? { ...prev.trackJson } : null);
    if (trackJson && typeof trackJson === "object") {
      if (cover) {
        trackJson.cover = String(trackJson.cover || cover);
        if (trackJson.album && typeof trackJson.album === "object") {
          trackJson.album = { ...trackJson.album };
          trackJson.album.cover_small = String(trackJson.album.cover_small || cover);
          trackJson.album.cover_medium = String(trackJson.album.cover_medium || cover);
          trackJson.album.cover = String(trackJson.album.cover || cover);
        } else if (trackJson.album === undefined) {
          trackJson.album = { cover_small: cover, cover_medium: cover, cover };
        }
      }
    }

    const entry = {
      id,
      title: String(t?.title || t?.SNG_TITLE || prev?.title || ""),
      artist: String(t?.artist?.name || t?.ART_NAME || prev?.artist || ""),
      artistId:
        t?.artist?.id
          ? Number(t.artist.id)
          : t?.ART_ID
            ? Number(t.ART_ID)
            : prev?.artistId ?? (trackJson?.artist?.id ?? null),
      duration: Number(t?.duration || t?.DURATION || prev?.duration || 0) || 0,
      albumId:
        t?.album?.id
          ? Number(t.album.id)
          : t?.ALB_ID
            ? Number(t.ALB_ID)
            : prev?.albumId ?? (trackJson?.album?.id ?? null),
      albumTitle: String(t?.album?.title || t?.ALB_TITLE || prev?.albumTitle || ""),
      albumCover: cover || "",
      playedAt: now,
      trackJson: trackJson || null,
    };

    const deduped = existing.filter((x) => Number(x?.id) !== id);
    deduped.unshift(entry);
    next.recentTracks = deduped.slice(0, 30);

    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const listRecentTracks = () => {
    const s = load();
    const items = Array.isArray(s.recentTracks) ? s.recentTracks.slice() : [];
    items.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
    return items;
  };

  const removeRecentTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    const existing = Array.isArray(next.recentTracks) ? next.recentTracks : [];
    const filtered = existing.filter((x) => Number(x?.id) !== id);
    if (filtered.length === existing.length) return false;
    next.recentTracks = filtered;
    save(next);
    window.dispatchEvent(new CustomEvent("local-library:changed"));
    return true;
  };

  const getRecentTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const s = load();
    const items = Array.isArray(s.recentTracks) ? s.recentTracks : [];
    const found = items.find((x) => Number(x?.id) === id);
    const trackJson = found?.trackJson && typeof found.trackJson === "object" ? { ...found.trackJson } : null;
    if (!trackJson) return null;

    const cover =
      String(found?.albumCover || "").trim() ||
      String(trackJson?.album?.cover_medium || trackJson?.album?.cover_small || trackJson?.album?.cover || trackJson?.cover || "").trim() ||
      "";
    if (cover) {
      trackJson.cover = String(trackJson.cover || cover);
      if (trackJson.album && typeof trackJson.album === "object") {
        trackJson.album = { ...trackJson.album };
        trackJson.album.cover_small = String(trackJson.album.cover_small || cover);
        trackJson.album.cover_medium = String(trackJson.album.cover_medium || cover);
        trackJson.album.cover = String(trackJson.album.cover || cover);
      } else if (trackJson.album === undefined) {
        trackJson.album = { cover_small: cover, cover_medium: cover, cover };
      }
    }
    return trackJson;
  };

  return {
    load,
    mutate,
    addSavedTrack,
    removeSavedTrack,
    isTrackSaved,
    listSavedTracks,
    getSavedTrack,
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
    upsertTrackDownload,
    upsertDownloadedTrack,
    removeDownloadedTrack,
    listDownloadedTracks,
    addRecentTrack,
    listRecentTracks,
    removeRecentTrack,
    getRecentTrack,
  };
}

export function getLocalLibrary() {
  return window.__localLibrary || (window.__localLibrary = createLocalLibrary());
}
