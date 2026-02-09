const fs = require("node:fs");
const path = require("node:path");

function createTrackDownloader({
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
}) {
  const parsePlaylistIdFromUuid = (uuidRaw) => {
    const uuid = String(uuidRaw || "").trim();
    const match = uuid.match(/^playlist_(\d+)_track_/);
    const pid = match ? Number(match[1]) : NaN;
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  };

  return async function downloadSingleTrack({ dz, trackId, quality, uuid, trackJson, albumJson }) {
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
        try {
          if (requestedUuid && typeof library?.stampTrackUuid === "function") {
            library.stampTrackUuid({ trackId: tId, quality: q, uuid: downloadUuid });
          }
        } catch {}
        try {
          const playlistId = parsePlaylistIdFromUuid(downloadUuid);
          if (playlistId && typeof library?.ensurePlaylistTrackMirror === "function") {
            await library.ensurePlaylistTrackMirror({
              playlistId,
              trackId: tId,
              quality: q,
              sourceAudioPath: exactHit.audioPath,
              trackJson: trackJson && typeof trackJson === "object" ? trackJson : null,
            });
          }
        } catch {}
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
            uuid: downloadUuid,
          });
          if (adopted?.ok && adopted.fileUrl) {
            safeRmDir(legacyDir);
            try {
              const playlistId = parsePlaylistIdFromUuid(downloadUuid);
              if (playlistId && typeof library?.ensurePlaylistTrackMirror === "function") {
                await library.ensurePlaylistTrackMirror({
                  playlistId,
                  trackId: tId,
                  quality: q,
                  sourceAudioPath: adopted.audioPath,
                  trackJson: resolvedTrack && typeof resolvedTrack === "object" ? resolvedTrack : trackJson && typeof trackJson === "object" ? trackJson : null,
                });
              }
            } catch {}
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
        activeDownloads?.set?.(downloadUuid, {
          uuid: downloadUuid,
          trackId: tId,
          quality: q,
          stageDir,
          downloadObject: obj,
          startedAt: Date.now(),
        });
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
          uuid: downloadUuid,
        });

        if (!stored?.ok || !stored.fileUrl) {
          broadcastDownloadEvent({
            event: "downloadFailed",
            data: { uuid: downloadUuid, message: "Download produced no usable audio file", debug: { stageDir } },
          });
          return { ok: false, error: "download_no_path", uuid: downloadUuid, debug: { stageDir } };
        }

        try {
          const playlistId = parsePlaylistIdFromUuid(downloadUuid);
          if (playlistId && typeof library?.ensurePlaylistTrackMirror === "function") {
            await library.ensurePlaylistTrackMirror({
              playlistId,
              trackId: tId,
              quality: q,
              sourceAudioPath: stored.audioPath,
              trackJson: resolvedTrack && typeof resolvedTrack === "object" ? resolvedTrack : trackJson && typeof trackJson === "object" ? trackJson : null,
            });
          }
        } catch {}

        broadcastDownloadEvent({
          event: "downloadFinished",
          data: { uuid: downloadUuid, downloadPath: stored.audioPath, fileUrl: stored.fileUrl, fileSize: stored.fileSize || 0 },
        });

        return { ok: true, uuid: downloadUuid, downloadPath: stored.audioPath, fileUrl: stored.fileUrl, fileSize: stored.fileSize || 0 };
      } catch (e) {
        const errName = String(e?.name || "");
        const errMessage = String(e?.message || "");
        const cancelled = errName === "DownloadCanceled" || /cancel/i.test(errName) || /cancel/i.test(errMessage);
        if (cancelled) {
          broadcastDownloadEvent({ event: "downloadCancelled", data: { uuid: downloadUuid, id: tId } });
          return { ok: false, error: "download_cancelled", uuid: downloadUuid };
        }
        const message = String(e?.message || e || "download_failed");
        const stack = typeof e?.stack === "string" ? String(e.stack) : "";
        const debug = { downloadUuid, stageDir };
        broadcastDownloadEvent({ event: "downloadFailed", data: { uuid: downloadUuid, message, stack, debug } });
        return { ok: false, error: "download_failed", message, uuid: downloadUuid, stack, debug };
      } finally {
        try {
          activeDownloads?.delete?.(downloadUuid);
        } catch {}
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
}

module.exports = { createTrackDownloader };
