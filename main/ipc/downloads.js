const fs = require("node:fs");
const path = require("node:path");

const { ensureDir, getDownloadsDir } = require("../sessionStorage");
const { sanitizeDownloadUuid, normalizeDownloadedFilePath, resolvePathFromDeemixObject } = require("../downloadUtils");
const { findMostRecentDownloadFile, listAudioFiles } = require("../downloadUtils");
const { createDownloadLibrary, normalizeQuality, toIdString } = require("../downloadLibrary");

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
    enabled:
      process.env.DEBUG_DOWNLOADS === "true" ||
      process.env.DEBUG_DOWNLOADS === "1" ||
      process.env.DEBUG_DOWNLOADS === "verbose" ||
      process.env.NODE_ENV !== "production",
  });

  const library = createDownloadLibrary({ downloadsDir: getDownloadsDir() });
  const inFlight = new Map();

  // Startup health check (non-blocking): re-download missing album cover files for already-downloaded albums.
  // This keeps sidebar/recents artwork consistent even if a previous run failed mid-download.
  setTimeout(() => {
    try {
      library.ensureLoaded();
      void library.healMissingAlbumCovers?.({ max: 40 });
    } catch {}
  }, 900);

  const qualityToBitrate = (quality) => {
    const q = normalizeQuality(quality);
    return q === "flac" ? 9 : q === "mp3_320" ? 3 : 1;
  };

  const parseDeezerUrl = (url) => {
    const u = String(url || "").trim();
    const m = u.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist)\/(\d+)/i);
    if (!m) return null;
    return { type: String(m[1]).toLowerCase(), id: Number(m[2]) };
  };

  const safeRmDir = (dirPath) => {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch {}
  };

  const tryFetchAlbumFull = async (dz, albumId) => {
    const id = toIdString(albumId);
    if (!id) return null;
    if (!dz?.api || typeof dz.api.get_album !== "function") return null;
    try {
      const album = await dz.api.get_album(id);
      if (!album || typeof album !== "object") return null;
      if (typeof dz.api.get_album_tracks === "function") {
        try {
          const tracksRes = await dz.api.get_album_tracks(id, { limit: 1000 });
          const tracks = Array.isArray(tracksRes?.data)
            ? tracksRes.data
            : Array.isArray(album?.tracks?.data)
              ? album.tracks.data
              : [];
          return { ...album, tracks };
        } catch {
          return album;
        }
      }
      return album;
    } catch {
      return null;
    }
  };

  const tryFetchPlaylistFull = async (dz, playlistId) => {
    const id = toIdString(playlistId);
    if (!id) return null;
    if (!dz?.api || typeof dz.api.get_playlist !== "function") return null;
    try {
      const playlist = await dz.api.get_playlist(id);
      if (!playlist || typeof playlist !== "object") return null;
      if (typeof dz.api.get_playlist_tracks === "function") {
        try {
          const tracksRes = await dz.api.get_playlist_tracks(id, { limit: 1000 });
          const tracks = Array.isArray(tracksRes?.data)
            ? tracksRes.data
            : Array.isArray(playlist?.tracks?.data)
              ? playlist.tracks.data
              : [];
          return { ...playlist, tracks };
        } catch {
          return playlist;
        }
    }
    return playlist;
  } catch {
    return null;
  }
  };

  const tryFetchArtistAlbums = async (dz, artistId) => {
    const id = toIdString(artistId);
    if (!id) return [];
    const api = dz?.api;
    if (!api) return [];
    const fn = api.get_artist_albums || api.getArtistAlbums || null;
    if (typeof fn !== "function") return [];
    try {
      const res = await fn.call(api, id, { limit: 1000 });
      const data = Array.isArray(res?.data) ? res.data : Array.isArray(res?.albums?.data) ? res.albums.data : [];
      return data;
    } catch {
      return [];
    }
  };

  const tryFetchTrack = async (dz, trackId) => {
    const id = toIdString(trackId);
    if (!id) return null;
    const api = dz?.api;
    const gw = dz?.gw;

    if (api) {
      const fn = api.get_track || api.getTrack || null;
      if (typeof fn === "function") {
        try {
          const t = await fn.call(api, id);
          if (t && typeof t === "object") return t;
        } catch {
          /* fall through */
        }
      }
    }

    // Deezer SDK doesn't always expose a `get_track` on `api`, but it does expose GW helpers.
    // Prefer `get_track_with_fallback`, which normalizes `get_track_page` into `DATA`.
    if (gw) {
      const fn = gw.get_track_with_fallback || gw.getTrack || null;
      if (typeof fn === "function") {
        try {
          const t = await fn.call(gw, id);
          if (t && typeof t === "object") return t;
        } catch {
          /* fall through */
        }
      }

      const pageFn = gw.get_track_page || null;
      if (typeof pageFn === "function") {
        try {
          const page = await pageFn.call(gw, id);
          const t = page?.DATA && typeof page.DATA === "object" ? page.DATA : page;
          if (t && typeof t === "object") return t;
        } catch {
          /* fall through */
        }
      }
    }

    return null;
  };

  const downloadSingleTrack = async ({ dz, trackId, quality, uuid, trackJson, albumJson }) => {
    const tId = Number(trackId);
    if (!Number.isFinite(tId) || tId <= 0) return { ok: false, error: "bad_request" };

    const clampQualityForUser = (q0) => {
      const q = normalizeQuality(q0) || "mp3_128";
      const user = dz?.currentUser || null;
      const canHQ = Boolean(user?.can_stream_hq);
      const canLossless = Boolean(user?.can_stream_lossless);
      if (q === "flac" && !canLossless) return canHQ ? "mp3_320" : "mp3_128";
      if (q === "mp3_320" && !canHQ) return "mp3_128";
      return q;
    };

    const q = clampQualityForUser(quality);
    const bitrate = qualityToBitrate(q);
    const requestedUuid = sanitizeDownloadUuid(uuid);
    const downloadUuid = requestedUuid || `dl_${tId}_${bitrate}`;

    const inflightKey = `${tId}:${q}`;
    if (inFlight.has(inflightKey)) return inFlight.get(inflightKey);

    const promise = (async () => {
      library.ensureLoaded();

      const exactHit = (() => {
        const res = library.resolveTrack({ trackId: tId, quality: q });
        if (!res?.ok || !res.exists) return null;
        return res.quality === q ? res : null;
      })();
      if (exactHit) {
        broadcastDownloadEvent({
          event: "downloadFinished",
          data: { uuid: downloadUuid, downloadPath: exactHit.audioPath, fileUrl: exactHit.fileUrl, alreadyDownloaded: true },
        });
        return {
          ok: true,
          uuid: downloadUuid,
          downloadPath: exactHit.audioPath,
          fileUrl: exactHit.fileUrl,
          alreadyDownloaded: true,
        };
      }

      const extractAlbumId = ({ maybeAlbum, maybeTrack }) => {
        return (
          toIdString(maybeAlbum?.id) ||
          toIdString(maybeAlbum?.ALB_ID) ||
          toIdString(maybeAlbum?.album_id) ||
          toIdString(maybeAlbum?.ALBUM_ID) ||
          toIdString(maybeTrack?.album?.id) ||
          toIdString(maybeTrack?.album?.ALB_ID) ||
          toIdString(maybeTrack?.album_id) ||
          toIdString(maybeTrack?.ALB_ID) ||
          toIdString(maybeTrack?.ALBUM_ID) ||
          toIdString(maybeTrack?.data?.ALB_ID) ||
          null
        );
      };

      let resolvedTrack = trackJson && typeof trackJson === "object" ? trackJson : null;
      if (!resolvedTrack) resolvedTrack = await tryFetchTrack(dz, tId);
      if (!resolvedTrack) return { ok: false, error: "missing_track_metadata" };

      let albumId = extractAlbumId({ maybeAlbum: albumJson, maybeTrack: resolvedTrack });
      if (!albumId) {
        const fetched = await tryFetchTrack(dz, tId);
        if (fetched && typeof fetched === "object") {
          albumId = extractAlbumId({ maybeAlbum: albumJson, maybeTrack: fetched }) || albumId;

          // Prefer renderer-provided fields when present, but don't drop fetched album identifiers.
          const merged = { ...fetched, ...resolvedTrack };
          const resolvedAlbum = resolvedTrack?.album && typeof resolvedTrack.album === "object" ? resolvedTrack.album : null;
          const resolvedHasAlbumId = Boolean(toIdString(resolvedAlbum?.id) || toIdString(resolvedAlbum?.ALB_ID));
          if (!resolvedHasAlbumId && fetched?.album && typeof fetched.album === "object") {
            merged.album = fetched.album;
          }
          resolvedTrack = merged;
        }
      }
      if (!albumId) return { ok: false, error: "missing_album_context" };

      const fullAlbum =
        (albumJson && typeof albumJson === "object" ? albumJson : null) ||
        (resolvedTrack?.album && typeof resolvedTrack.album === "object" ? resolvedTrack.album : null) ||
        null;
      const fetchedAlbum = await tryFetchAlbumFull(dz, albumId);
      const resolvedAlbum = fetchedAlbum || fullAlbum;
      if (!resolvedAlbum) return { ok: false, error: "missing_album_metadata" };

      await library.ensureAlbumMetadata({ albumId, albumJson: resolvedAlbum });

      // Legacy adoption:
      // Previous versions stored downloads as `.session/downloads/track_<id>_<bitrate>/...`.
      // If such a folder exists, import it into the canonical album-based layout instead of re-downloading.
      try {
        const downloadsRoot = getDownloadsDir();
        const legacyDir = path.join(downloadsRoot, `track_${tId}_${bitrate}`);
        if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory()) {
          const adopted = await library.ensureTrackStoredFromStaging({
            albumId,
            trackId: tId,
            quality: q,
            stagingDir: legacyDir,
            trackJson: resolvedTrack,
            albumJson: resolvedAlbum,
          });
          if (adopted?.ok && adopted.fileUrl) {
            safeRmDir(legacyDir);
            broadcastDownloadEvent({
              event: "downloadFinished",
              data: { uuid: downloadUuid, downloadPath: adopted.audioPath, fileUrl: adopted.fileUrl, alreadyDownloaded: true },
            });
            return {
              ok: true,
              uuid: downloadUuid,
              downloadPath: adopted.audioPath,
              fileUrl: adopted.fileUrl,
              alreadyDownloaded: true,
            };
          }
        }
      } catch {}

      const deemix = await loadVendoredDeemixLite();
      const Downloader = deemix?.Downloader;
      const generateDownloadObject = deemix?.generateDownloadObject;
      const DEFAULT_SETTINGS = deemix?.DEFAULT_SETTINGS;
      if (typeof Downloader !== "function" || typeof generateDownloadObject !== "function" || !DEFAULT_SETTINGS) {
        return { ok: false, error: "deemix_not_available" };
      }

      const stageDir = library.stageDirForUuid(downloadUuid);
      safeRmDir(stageDir);
      ensureDir(stageDir);

      const settings = {
        ...DEFAULT_SETTINGS,
        downloadLocation: stageDir + path.sep,
        maxBitrate: bitrate,
      };

      let downloadPath = null;
      const downloadPaths = new Set();
      const listener = {
        send: (eventName, data) => {
          if (data && typeof data === "object" && !Array.isArray(data) && !data.uuid) data.uuid = downloadUuid;
          const maybePath = data && typeof data === "object" ? data.downloadPath : null;
          if (typeof maybePath === "string" && maybePath) {
            downloadPaths.add(maybePath);
            if (!downloadPath) downloadPath = maybePath;
          }
          broadcastDownloadEvent({ event: eventName, data });
        },
      };

      try {
        const link = `https://www.deezer.com/track/${tId}`;
        const obj = await generateDownloadObject(dz, link, bitrate, {}, listener);
        if (!obj || typeof obj !== "object") return { ok: false, error: "download_object_failed" };

        obj.uuid = downloadUuid;
        broadcastDownloadEvent({ event: "downloadRequested", data: { uuid: downloadUuid, id: tId, bitrate } });

        const downloader = new Downloader(dz, obj, settings, listener);
        await downloader.start();

        if (!downloadPath) downloadPath = resolvePathFromDeemixObject(obj, stageDir + path.sep);
        if (obj?.files && Array.isArray(obj.files)) {
          for (const f of obj.files) {
            if (!f?.path) continue;
            const p = String(f.path);
            if (p) downloadPaths.add(p);
          }
        }

        const resolvedPaths = [];
        for (const p of downloadPaths) {
          const full = normalizeDownloadedFilePath(p, stageDir, stageDir);
          if (full) resolvedPaths.push(full);
        }
        const scanned = listAudioFiles(stageDir);
        for (const p of scanned) resolvedPaths.push(p);
        if (resolvedPaths.length > 0 && !downloadPath) downloadPath = resolvedPaths[0];
        if (!downloadPath) downloadPath = findMostRecentDownloadFile(stageDir);

        const stored = await library.ensureTrackStoredFromStaging({
          albumId,
          trackId: tId,
          quality: q,
          stagingDir: stageDir,
          trackJson: resolvedTrack,
          albumJson: resolvedAlbum,
        });

        if (!stored?.ok || !stored.fileUrl) {
          broadcastDownloadEvent({
            event: "downloadFailed",
            data: { uuid: downloadUuid, message: "Download produced no usable audio file", debug: { stageDir } },
          });
          return { ok: false, error: "download_no_path", uuid: downloadUuid, debug: { stageDir } };
        }

        broadcastDownloadEvent({
          event: "downloadFinished",
          data: { uuid: downloadUuid, downloadPath: stored.audioPath, fileUrl: stored.fileUrl },
        });

        return { ok: true, uuid: downloadUuid, downloadPath: stored.audioPath, fileUrl: stored.fileUrl };
      } catch (e) {
        const message = String(e?.message || e || "download_failed");
        const stack = typeof e?.stack === "string" ? String(e.stack) : "";
        const debug = { downloadUuid, stageDir };
        broadcastDownloadEvent({ event: "downloadFailed", data: { uuid: downloadUuid, message, stack, debug } });
        return { ok: false, error: "download_failed", message, uuid: downloadUuid, stack, debug };
      } finally {
        safeRmDir(stageDir);
      }
    })()
      .finally(() => {
        inFlight.delete(inflightKey);
      })
      .catch((e) => ({ ok: false, error: "download_failed", message: String(e?.message || e) }));

    inFlight.set(inflightKey, promise);
    return promise;
  };

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
    return library.removeDownloadForTrack({ trackId, quality, deleteAlbumContainer: true });
  });

  ipcMain.handle("dl:migrateLegacy", async () => {
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
    log("dl:downloadUrl:start", { payload });
    const url = String(payload?.url || "").trim();
    if (!url) return { ok: false, error: "bad_request" };

    const parsed = parseDeezerUrl(url);
    if (!parsed) return { ok: false, error: "bad_request" };

    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    const quality = String(payload?.quality || "mp3_128");
    const q = normalizeQuality(quality) || "mp3_128";

    if (parsed.type === "track") {
      return downloadSingleTrack({ dz: dzRes.dz, trackId: parsed.id, quality: q, uuid: payload?.uuid || null });
    }

    if (parsed.type === "album") {
      const album = await tryFetchAlbumFull(dzRes.dz, parsed.id);
      if (!album) return { ok: false, error: "album_fetch_failed" };
      const tracks = Array.isArray(album?.tracks) ? album.tracks : Array.isArray(album?.tracks?.data) ? album.tracks.data : [];
      const albumId = Number(album?.id || parsed.id);
      if (!Number.isFinite(albumId) || albumId <= 0) return { ok: false, error: "album_fetch_failed" };

      const results = [];
      for (const t of tracks) {
        const id = Number(t?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const r = await downloadSingleTrack({
          dz: dzRes.dz,
          trackId: id,
          quality: q,
          uuid: `album_${albumId}_track_${id}_${qualityToBitrate(q)}`,
          trackJson: t,
          albumJson: album,
        });
        results.push({ trackId: id, ok: Boolean(r?.ok), error: r?.error || null });
      }
      return { ok: true, type: "album", albumId, count: results.length, results };
    }

    if (parsed.type === "playlist") {
      const playlist = await tryFetchPlaylistFull(dzRes.dz, parsed.id);
      if (!playlist) return { ok: false, error: "playlist_fetch_failed" };
      const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : Array.isArray(playlist?.tracks?.data) ? playlist.tracks.data : [];
      const playlistId = Number(playlist?.id || parsed.id);
      if (!Number.isFinite(playlistId) || playlistId <= 0) return { ok: false, error: "playlist_fetch_failed" };

      const trackIds = [];
      for (const t of tracks) {
        const id = Number(t?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        trackIds.push(id);
      }
      await library.ensurePlaylistMetadata({ playlistId, playlistJson: playlist, trackIds });

      const albumCache = new Map();
      const getAlbum = async (albumId) => {
        const key = toIdString(albumId);
        if (!key) return null;
        if (albumCache.has(key)) return albumCache.get(key);
        const full = await tryFetchAlbumFull(dzRes.dz, key);
        const val = full || null;
        albumCache.set(key, val);
        return val;
      };

      const results = [];
      for (const t of tracks) {
        const id = Number(t?.id);
        if (!Number.isFinite(id) || id <= 0) continue;
        const albumId = toIdString(t?.album?.id) || toIdString(t?.ALB_ID) || null;
        const album = albumId ? await getAlbum(albumId) : null;
        const r = await downloadSingleTrack({
          dz: dzRes.dz,
          trackId: id,
          quality: q,
          uuid: `playlist_${playlistId}_track_${id}_${qualityToBitrate(q)}`,
          trackJson: t,
          albumJson: album || t?.album || null,
        });
        results.push({ trackId: id, ok: Boolean(r?.ok), error: r?.error || null });
      }
      return { ok: true, type: "playlist", playlistId, count: results.length, results };
    }

    if (parsed.type === "artist") {
      const artistId = toIdString(parsed.id);
      if (!artistId) return { ok: false, error: "artist_fetch_failed" };

      const albums = await tryFetchArtistAlbums(dzRes.dz, artistId);
      const albumIds = Array.from(
        new Set(
          albums
            .map((a) => Number(a?.id))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      );
      if (albumIds.length === 0) return { ok: false, error: "artist_albums_fetch_failed" };

      const results = [];
      for (const albumId of albumIds) {
        const album = await tryFetchAlbumFull(dzRes.dz, albumId);
        if (!album) {
          results.push({ albumId, ok: false, error: "album_fetch_failed" });
          continue;
        }
        const tracks = Array.isArray(album?.tracks) ? album.tracks : Array.isArray(album?.tracks?.data) ? album.tracks.data : [];
        for (const t of tracks) {
          const id = Number(t?.id);
          if (!Number.isFinite(id) || id <= 0) continue;
          const r = await downloadSingleTrack({
            dz: dzRes.dz,
            trackId: id,
            quality: q,
            uuid: `artist_${artistId}_album_${albumId}_track_${id}_${qualityToBitrate(q)}`,
            trackJson: t,
            albumJson: album,
          });
          results.push({ albumId, trackId: id, ok: Boolean(r?.ok), error: r?.error || null });
        }
      }
      return { ok: true, type: "artist", artistId, albums: albumIds.length, count: results.length, results };
    }

    return { ok: false, error: "unsupported_type", type: parsed.type };
  });
}

module.exports = { registerDownloadIpcHandlers };
