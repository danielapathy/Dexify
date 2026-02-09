import { getLocalLibrary } from "../localLibrary.js";

function toNumId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTrackRef({ uuid, data }) {
  const fromData = Number(data?.id);
  const fromDataBitrate = Number(data?.bitrate);
  if (Number.isFinite(fromData) && fromData > 0) {
    return { trackId: fromData, bitrate: Number.isFinite(fromDataBitrate) ? fromDataBitrate : null };
  }

  const m1 = uuid.match(/^(?:track|dl)_(\d+)_(\d+)/);
  if (m1) return { trackId: Number(m1[1]), bitrate: Number(m1[2]) };

  const m2 = uuid.match(/(?:^|_)track_(\d+)_(\d+)/);
  if (m2) return { trackId: Number(m2[1]), bitrate: Number(m2[2]) };

  return { trackId: null, bitrate: null };
}

export function wireDownloads() {
  if (!window.dl?.onEvent) return;

  const lib = getLocalLibrary();
  const artistEl = document.getElementById("playerArtist");

  const syncDownloadsFromDisk = async () => {
    if (!window.dl?.listDownloads) return;
    try {
      const res = await window.dl.listDownloads();
      const rows = Array.isArray(res?.tracks) ? res.tracks : [];
      const presentDownloadedIds = new Set();
      for (const row of rows) {
        const track = row?.track && typeof row.track === "object" ? row.track : null;
        const trackId = toNumId(row?.trackId || track?.id || track?.SNG_ID);
        if (!trackId) continue;
        const fileUrl = String(row?.fileUrl || "").trim();
        if (!fileUrl) continue;
        presentDownloadedIds.add(String(trackId));
      }

      lib.mutate((state, { markDirty }) => {
        if (!state.downloadedTracks || typeof state.downloadedTracks !== "object") state.downloadedTracks = {};
        const downloaded = state.downloadedTracks;
        const saved = state.savedTracks && typeof state.savedTracks === "object" ? state.savedTracks : null;

        // Prune stale "downloaded" rows (e.g. after deleting from disk) so the UI doesn't show
        // green downloaded badges or disable album/playlist downloads incorrectly.
        for (const [id, entry] of Object.entries(downloaded)) {
          const e = entry && typeof entry === "object" ? entry : null;
          const fileUrl = e?.download?.fileUrl ? String(e.download.fileUrl) : "";
          if (!fileUrl) continue; // keep in-flight rows
          if (presentDownloadedIds.has(String(id))) continue;
          delete downloaded[id];
          markDirty();
        }
        if (saved) {
          for (const [id, entry] of Object.entries(saved)) {
            const e = entry && typeof entry === "object" ? entry : null;
            const fileUrl = e?.download?.fileUrl ? String(e.download.fileUrl) : "";
            if (!fileUrl) continue;
            if (presentDownloadedIds.has(String(id))) continue;
            delete e.download;
            markDirty();
          }
        }

        for (const row of rows) {
          const track = row?.track && typeof row.track === "object" ? row.track : null;
          const album =
            row?.album && typeof row.album === "object"
              ? row.album
              : track?.album && typeof track.album === "object"
                ? track.album
                : null;

          const trackId = toNumId(row?.trackId || track?.id || track?.SNG_ID);
          if (!trackId) continue;

          const existing =
            downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;

          const fileUrl = String(row?.fileUrl || existing?.download?.fileUrl || "").trim();
          if (!fileUrl) continue;
          const downloadPath = String(row?.audioPath || row?.downloadPath || existing?.download?.downloadPath || "").trim();
          const quality = String(row?.bestQuality || existing?.download?.quality || "").trim();

          const artistName = String(track?.artist?.name || track?.ART_NAME || existing?.artist || "").trim();
          const artistId = toNumId(track?.artist?.id || track?.ART_ID || existing?.artistId);

          const albumId = toNumId(row?.albumId || album?.id || album?.ALB_ID || track?.ALB_ID || track?.album_id || existing?.albumId);
          const albumTitle = String(album?.title || track?.ALB_TITLE || existing?.albumTitle || "").trim();
          const cover = String(
            row?.coverUrl ||
              album?.cover_medium ||
              album?.cover ||
              track?.album?.cover_medium ||
              track?.album?.cover ||
              track?.cover ||
              existing?.albumCover ||
              "",
          ).trim();

          const title = String(track?.title || track?.SNG_TITLE || existing?.title || "").trim();
          const duration = Number(track?.duration || track?.DURATION || existing?.duration || 0) || 0;
          const explicit = Boolean(track?.explicit_lyrics || track?.EXPLICIT_LYRICS || existing?.explicit);

          const prevDownload = existing?.download && typeof existing.download === "object" ? existing.download : {};
          const rowMtime = Number(row?.mtimeMs) || 0;
          const nextDownloadAt = Number(prevDownload?.at) || rowMtime || 0;
          const nextDownloadedAt = Number(existing?.downloadedAt) || nextDownloadAt || 0;
          const nextUpdatedAt = Number(existing?.updatedAt) || nextDownloadedAt || 0;
          const nextUuid = String(row?.uuid || prevDownload?.uuid || "").trim();

          const nextTrackJson =
            existing?.trackJson && typeof existing.trackJson === "object"
              ? existing.trackJson
              : {
                  id: trackId,
                  title,
                  duration,
                  explicit_lyrics: explicit,
                  artist: { id: artistId, name: artistName },
                  album: {
                    id: albumId,
                    title: albumTitle,
                    cover_small: cover,
                    cover_medium: cover,
                    cover,
                  },
                  ...(cover ? { cover } : {}),
                };

          const fileSize = Number(row?.fileSize) || Number(existing?.fileSize) || 0;

          const next = {
            ...(existing && typeof existing === "object" ? existing : {}),
            id: trackId,
            title,
            artist: artistName,
            ...(artistId ? { artistId } : {}),
            duration,
            explicit,
            ...(albumId ? { albumId } : {}),
            albumTitle,
            albumCover: cover,
            downloadedAt: nextDownloadedAt,
            updatedAt: nextUpdatedAt,
            fileSize,
            trackJson: nextTrackJson,
            download: {
              uuid: nextUuid,
              fileUrl,
              downloadPath,
              quality,
              at: nextDownloadAt,
              mtimeMs: rowMtime || Number(prevDownload?.mtimeMs) || 0,
            },
          };

          const prev = existing || null;
          const changed =
            !prev ||
            String(prev?.download?.uuid || "") !== String(next.download.uuid || "") ||
            String(prev?.download?.fileUrl || "") !== String(next.download.fileUrl || "") ||
            String(prev?.download?.downloadPath || "") !== String(next.download.downloadPath || "") ||
            String(prev?.download?.quality || "") !== String(next.download.quality || "") ||
            Number(prev?.download?.at || 0) !== Number(next.download.at || 0) ||
            Number(prev?.download?.mtimeMs || 0) !== Number(next.download.mtimeMs || 0) ||
            Number(prev?.downloadedAt || 0) !== Number(next.downloadedAt || 0) ||
            Number(prev?.updatedAt || 0) !== Number(next.updatedAt || 0) ||
            String(prev?.albumCover || "") !== String(next.albumCover || "") ||
            String(prev?.albumTitle || "") !== String(next.albumTitle || "") ||
            Number(prev?.albumId || 0) !== Number(next.albumId || 0) ||
            String(prev?.title || "") !== String(next.title || "") ||
            Number(prev?.fileSize || 0) !== Number(next.fileSize || 0);

          if (!changed) continue;
          downloaded[String(trackId)] = next;
          markDirty();
        }
      });
    } catch {}
  };

  // On cold start, rehydrate local library download state from the downloads DB on disk.
  setTimeout(() => void syncDownloadsFromDisk(), 120);

  window.dl.onEvent((payload) => {
    const event = String(payload?.event || "");
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const uuid = String(data?.uuid || "").trim();
    if (event === "libraryChanged") {
      void syncDownloadsFromDisk();
      return;
    }
    if (!uuid) return;

    // Keep Downloads in sync for track downloads (even if they weren't initiated via the player).
    if (event === "downloadRequested" || event === "downloadFinished" || event === "downloadFailed" || event === "downloadCancelled") {
      const ref = parseTrackRef({ uuid, data });
      const trackId = Number(ref?.trackId);
      const bitrate = Number(ref?.bitrate);
      if (Number.isFinite(trackId) && trackId > 0) {
        const quality = bitrate === 9 ? "flac" : bitrate === 3 ? "mp3_320" : "mp3_128";

        if (event === "downloadRequested") {
          const meta =
            window.__downloadMetaById && typeof window.__downloadMetaById === "object" ? window.__downloadMetaById[String(trackId)] : null;
          lib.upsertDownloadedTrack?.({
            track: {
              id: trackId,
              title: String(meta?.title || ""),
              artist: { name: String(meta?.artist || "") },
              album: { cover_medium: String(meta?.cover || ""), cover: String(meta?.cover || "") },
            },
            fileUrl: "",
            downloadPath: "",
            quality,
            uuid,
          });
        } else if (event === "downloadFinished") {
          lib.upsertDownloadedTrack?.({
            track: { id: trackId },
            fileUrl: String(data?.fileUrl || ""),
            downloadPath: String(data?.downloadPath || ""),
            fileSize: Number(data?.fileSize) || 0,
            quality,
            uuid,
          });
        } else if (event === "downloadFailed" || event === "downloadCancelled") {
          // Don't strand the UI in a "downloading" state if the track was never written to disk.
          try {
            const st = lib.load?.() || {};
            const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
            const entry = downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;
            const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
            if (!fileUrl) lib.removeDownloadedTrack?.(trackId);
          } catch {}
        }
      }
    }

    const st = window.__player?.getState?.();
    if (!st || !st.downloadUuid) return;
    if (uuid !== st.downloadUuid) return;

    if (event === "updateQueue" && typeof data.progress === "number") {
      if (artistEl) artistEl.textContent = `Downloading\u2026 ${Math.floor(data.progress)}%`;
    }
    if (event === "downloadFinished") {
      if (artistEl && st.track?.artist) artistEl.textContent = st.track.artist;
    }
    if (event === "downloadFailed" || event === "downloadCancelled") {
      if (artistEl && st.track?.artist) artistEl.textContent = st.track.artist;
    }
  });
}
