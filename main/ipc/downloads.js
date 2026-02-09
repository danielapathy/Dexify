const fs = require("node:fs");
const { ensureDir, getDownloadsDir } = require("../sessionStorage");
const { sanitizeDownloadUuid, normalizeDownloadedFilePath, resolvePathFromDeemixObject } = require("../downloadUtils");
const { findMostRecentDownloadFile, listAudioFiles } = require("../downloadUtils");
const { createDownloadLibrary, normalizeQuality, toIdString } = require("../downloadLibrary");
const { env } = require("../env");
const { createDownloadFetchHelpers } = require("./downloads/fetchHelpers");
const { createTrackDownloader } = require("./downloads/trackDownloader");
const { createDownloadUrlHandler } = require("./downloads/downloadUrlHandler");
const { createMigrateLegacyHandler } = require("./downloads/migrateLegacyHandler");

function createDownloadLogger({ enabled }) {
  const isEnabled = Boolean(enabled);
  const log = (...args) => {
    if (!isEnabled) return;
    console.log("[download]", ...args);
  };
  return { log };
}

function registerDownloadIpcHandlers({ ipcMain, getDzClient, loadVendoredDeemixLite, broadcastDownloadEvent }) {
  const { log } = createDownloadLogger({
    enabled: env.DEBUG_DOWNLOADS_ENABLED,
  });

  const library = createDownloadLibrary({ downloadsDir: getDownloadsDir() });
  const inFlight = new Map();
  const activeDownloads = new Map();
  const cancelledGroupPrefixes = new Set();

  const parseGroupFromPrefix = (uuidPrefixRaw) => {
    const uuidPrefix = String(uuidPrefixRaw || "").trim();
    if (!uuidPrefix) return null;
    let match = uuidPrefix.match(/^album_(\d+)_track_$/);
    if (match) {
      const albumId = Number(match[1]);
      if (!Number.isFinite(albumId) || albumId <= 0) return null;
      return { kind: "album", groupKey: `album:${albumId}`, groupPrefix: `album_${albumId}_track_`, albumId };
    }
    match = uuidPrefix.match(/^playlist_(\d+)_track_$/);
    if (match) {
      const playlistId = Number(match[1]);
      if (!Number.isFinite(playlistId) || playlistId <= 0) return null;
      return { kind: "playlist", groupKey: `playlist:${playlistId}`, groupPrefix: `playlist_${playlistId}_track_`, playlistId };
    }
    return null;
  };

  // Startup health check (non-blocking): re-download missing album cover files for already-downloaded albums.
  // This keeps sidebar/recents artwork consistent even if a previous run failed mid-download.
  setTimeout(() => {
    try {
      library.ensureLoaded();
      void library.healMissingAlbumCovers?.({ max: 40 });
    } catch {}
  }, 900);

  const { qualityToBitrate, parseDeezerUrl, safeRmDir, tryFetchAlbumFull, tryFetchPlaylistFull, tryFetchArtistAlbums, tryFetchTrack } =
    createDownloadFetchHelpers({
      fs,
      toIdString,
      normalizeQuality,
    });

  const downloadSingleTrack = createTrackDownloader({
    library,
    inFlight,
    activeDownloads,
    loadVendoredDeemixLite,
    broadcastDownloadEvent,
    getDownloadsDir,
    ensureDir,
    sanitizeDownloadUuid,
    normalizeDownloadedFilePath,
    resolvePathFromDeemixObject,
    findMostRecentDownloadFile,
    listAudioFiles,
    normalizeQuality,
    toIdString,
    qualityToBitrate,
    safeRmDir,
    tryFetchTrack,
    tryFetchAlbumFull,
  });
  const handleDownloadUrl = createDownloadUrlHandler({
    log,
    getDzClient,
    parseDeezerUrl,
    normalizeQuality,
    toIdString,
    qualityToBitrate,
    tryFetchAlbumFull,
    tryFetchPlaylistFull,
    tryFetchArtistAlbums,
    downloadSingleTrack,
    library,
    broadcastDownloadEvent,
    isGroupCancelled: (prefix) => cancelledGroupPrefixes.has(String(prefix || "")),
    clearGroupCancelled: (prefix) => {
      try {
        cancelledGroupPrefixes.delete(String(prefix || ""));
      } catch {}
    },
  });
  const handleMigrateLegacy = createMigrateLegacyHandler({
    getDzClient,
    library,
    getDownloadsDir,
    tryFetchTrack,
    tryFetchAlbumFull,
    toIdString,
    safeRmDir,
  });

  ipcMain.handle("dl:resolveTrack", async (_event, payload) => {
    library.ensureLoaded();
    const trackId = Number(payload?.id);
    const quality = String(payload?.quality || "");
    return library.resolveTrack({ trackId, quality });
  });

  ipcMain.handle("dl:listDownloads", async () => {
    library.ensureLoaded();
    return library.listDownloadedTracks();
  });

  ipcMain.handle("dl:listPlaylists", async () => {
    library.ensureLoaded();
    if (typeof library.listDownloadedPlaylists !== "function") return { ok: false, error: "not_supported" };
    return library.listDownloadedPlaylists();
  });

  ipcMain.handle("dl:getOfflineTracklist", async (_event, payload) => {
    library.ensureLoaded();
    const type = String(payload?.type || "");
    const id = payload?.id;
    return library.getOfflineTracklist({ type, id });
  });

  ipcMain.handle("dl:scanLibrary", async () => {
    library.ensureLoaded();
    return library.scanAndRebuild();
  });

  ipcMain.handle("dl:healLibrary", async (_event, payload) => {
    library.ensureLoaded();
    const max = Number(payload?.max);
    return library.healMissingAlbumCovers({ max: Number.isFinite(max) ? max : 25 });
  });

  ipcMain.handle("dl:removeDownload", async (_event, payload) => {
    library.ensureLoaded();
    const trackId = Number(payload?.id);
    const quality = payload?.quality ? String(payload.quality) : null;
    return library.removeDownloadForTrack({ trackId, quality, deleteAlbumContainer: false });
  });

  ipcMain.handle("dl:deleteFromDisk", async (_event, payload) => {
    library.ensureLoaded();
    const trackId = Number(payload?.id);
    const quality = payload?.quality ? String(payload.quality) : null;
    const res = library.removeDownloadForTrack({ trackId, quality, deleteAlbumContainer: true });
    try {
      broadcastDownloadEvent({ event: "libraryChanged", data: { reason: "deleteFromDisk", trackId } });
    } catch {}
    return res;
  });

  ipcMain.handle("dl:deleteAlbumFromDisk", async (_event, payload) => {
    library.ensureLoaded();
    const albumId = Number(payload?.id);
    if (typeof library.deleteAlbumFromDisk !== "function") return { ok: false, error: "not_supported" };
    const res = library.deleteAlbumFromDisk({ albumId });
    try {
      broadcastDownloadEvent({ event: "libraryChanged", data: { reason: "deleteAlbumFromDisk", albumId } });
    } catch {}
    return res;
  });

  ipcMain.handle("dl:deletePlaylistFromDisk", async (_event, payload) => {
    library.ensureLoaded();
    const playlistId = Number(payload?.id);
    if (typeof library.deletePlaylistFromDisk !== "function") return { ok: false, error: "not_supported" };
    const res = library.deletePlaylistFromDisk({ playlistId });
    try {
      broadcastDownloadEvent({ event: "libraryChanged", data: { reason: "deletePlaylistFromDisk", playlistId } });
    } catch {}
    return res;
  });

  ipcMain.handle("dl:migrateLegacy", async () => {
    return handleMigrateLegacy();
  });

  ipcMain.handle("dl:downloadTrack", async (_event, payload) => {
    log("dl:downloadTrack:start", { payload });
    const trackId = Number(payload?.id);
    if (!Number.isFinite(trackId) || trackId <= 0) return { ok: false, error: "bad_request" };

    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    const quality = String(payload?.quality || "mp3_128");
    const trackJson = payload?.track && typeof payload.track === "object" ? payload.track : payload?.trackJson;
    const albumJson = payload?.album && typeof payload.album === "object" ? payload.album : payload?.albumJson;
    const uuid = payload?.uuid ? String(payload.uuid) : null;

    return downloadSingleTrack({ dz: dzRes.dz, trackId, quality, uuid, trackJson, albumJson });
  });

  ipcMain.handle("dl:downloadUrl", async (_event, payload) => {
    return handleDownloadUrl(payload);
  });

  ipcMain.handle("dl:cancelDownload", async (_event, payload) => {
    const uuid = sanitizeDownloadUuid(payload?.uuid);
    const uuidPrefix = String(payload?.uuidPrefix || "").trim();
    const targets = [];

    if (uuid) {
      const entry = activeDownloads.get(uuid);
      if (entry) targets.push(entry);
    } else if (uuidPrefix) {
      try {
        cancelledGroupPrefixes.add(uuidPrefix);
      } catch {}
      try {
        const group = parseGroupFromPrefix(uuidPrefix);
        if (group) {
          broadcastDownloadEvent({
            event: "downloadGroupCancelRequested",
            data: { ...group, updatedAt: Date.now() },
          });
        }
      } catch {}

      for (const [key, entry] of activeDownloads.entries()) {
        if (String(key).startsWith(uuidPrefix)) targets.push(entry);
      }
    }

    // If we have no active per-track download objects, a group-cancel can still be meaningful:
    // the downloadUrl handler checks `cancelledGroupPrefixes` between tracks to stop future work.
    if (targets.length === 0) return uuidPrefix ? { ok: true, cancelled: 0 } : { ok: false, error: "not_found" };

    for (const entry of targets) {
      try {
        if (entry?.downloadObject && typeof entry.downloadObject === "object") entry.downloadObject.isCanceled = true;
      } catch {}
      try {
        broadcastDownloadEvent({
          event: "downloadCancelRequested",
          data: {
            uuid: String(entry?.uuid || ""),
            id: Number(entry?.trackId) || null,
          },
        });
      } catch {}
    }

    return { ok: true, cancelled: targets.length };
  });
}

module.exports = { registerDownloadIpcHandlers };
