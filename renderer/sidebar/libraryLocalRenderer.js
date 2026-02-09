import { getLocalLibrary } from "../localLibrary.js";
import { formatRecordTypeLabel } from "../utils.js";
import { createLibraryItemElement } from "./libraryItemElement.js";

export function createLibraryLocalRenderer({ list, norm }) {
  const targetList = list && list.nodeType === 1 ? list : null;
  const normalize = typeof norm === "function" ? norm : (v) => String(v || "");

  const renderLibraryLocal = async () => {
    if (!targetList) return;

    const lib = getLocalLibrary();
    const state = lib.load();

    const savedTracksCount = Object.keys(state.savedTracks || {}).length;
    const downloadedTracksState =
      state.downloadedTracks && typeof state.downloadedTracks === "object" ? state.downloadedTracks : {};

    let downloadedTracksCount = Object.values(downloadedTracksState || {}).filter((t) => t?.download?.fileUrl).length;

    const recentTracks = Array.isArray(state.recentTracks) ? state.recentTracks : [];
    const playedAtByTrackId = new Map();
    const playedAtByAlbumId = new Map();
    const recentAlbumMetaById = new Map(); // albumId -> { title, artist, cover }
    const playedAtByPlaylistId = new Map();
    const recentPlaylistMetaById = new Map(); // playlistId -> { title, cover }
    for (const r of recentTracks) {
      const playedAt = Number(r?.playedAt) || 0;
      if (!Number.isFinite(playedAt) || playedAt <= 0) continue;

      const trackId = Number(r?.id);
      if (Number.isFinite(trackId) && trackId > 0) {
        const prev = playedAtByTrackId.get(trackId) || 0;
        if (playedAt > prev) playedAtByTrackId.set(trackId, playedAt);
      }

      const playlistId = Number(r?.playlistId);
      if (Number.isFinite(playlistId) && playlistId > 0) {
        const prev = playedAtByPlaylistId.get(playlistId) || 0;
        if (playedAt > prev) playedAtByPlaylistId.set(playlistId, playedAt);

        const prevMeta = recentPlaylistMetaById.get(playlistId) || null;
        const title = String(r?.playlistTitle || prevMeta?.title || "").trim();
        const cover = String(r?.playlistCover || prevMeta?.cover || "").trim();
        if (title || cover) {
          recentPlaylistMetaById.set(playlistId, {
            title: title || prevMeta?.title || "",
            cover: cover || prevMeta?.cover || "",
          });
        }
        // Playlist plays should not bump the underlying album recency.
        continue;
      }

      const albumId = Number(r?.albumId);
      if (Number.isFinite(albumId) && albumId > 0) {
        const prev = playedAtByAlbumId.get(albumId) || 0;
        if (playedAt > prev) playedAtByAlbumId.set(albumId, playedAt);

        const prevMeta = recentAlbumMetaById.get(albumId) || null;
        const title = String(r?.albumTitle || prevMeta?.title || "").trim();
        const artist = String(r?.artist || prevMeta?.artist || "").trim();
        const cover = String(r?.albumCover || prevMeta?.cover || "").trim();
        if (title || artist || cover) {
          recentAlbumMetaById.set(albumId, {
            title: title || prevMeta?.title || "",
            artist: artist || prevMeta?.artist || "",
            cover: cover || prevMeta?.cover || "",
          });
        }
      }
    }

    const getTrackDownloadedAt = (trackId) => {
      const id = Number(trackId);
      if (!Number.isFinite(id) || id <= 0) return 0;
      const entry =
        downloadedTracksState[String(id)] && typeof downloadedTracksState[String(id)] === "object"
          ? downloadedTracksState[String(id)]
          : null;
      const at = Number(entry?.download?.at) || Number(entry?.download?.mtimeMs) || Number(entry?.updatedAt) || 0;
      return Number.isFinite(at) && at > 0 ? at : 0;
    };

    const albumTotalsById = new Map();
    const albumMetaById = new Map();
    const albumDownloadedTrackIdsById = new Map();
    const albumLastDownloadedAtById = new Map();
    const albumSearchPartsById = new Map();
    const albumHasPlaylistOriginById = new Map();
    const albumHasNonPlaylistOriginById = new Map();

    const downloadedPlaylistsById = new Map(); // playlistId -> { title, cover, total, downloaded, updatedAt }
    const playlistIdsWithDownloadedTracks = new Set();

    try {
      if (window.dl?.listDownloads) {
        const res = await window.dl.listDownloads();
        const rows = Array.isArray(res?.tracks) ? res.tracks : [];
        downloadedTracksCount = rows.length;

        const getAlbumId = (row) => {
          const album = row?.album && typeof row.album === "object" ? row.album : null;
          const track = row?.track && typeof row.track === "object" ? row.track : null;
          const direct = Number(row?.albumId || row?.album_id);
          const id = Number(album?.id || album?.ALB_ID || direct || track?.album?.id || track?.ALB_ID || track?.album_id);
          return Number.isFinite(id) && id > 0 ? id : null;
        };

        const getAlbumTotal = (album) => {
          const a = album && typeof album === "object" ? album : null;
          if (!a) return null;
          const direct = Number(a?.nb_tracks);
          if (Number.isFinite(direct) && direct > 0) return direct;
          const nested = Number(a?.tracks?.total);
          if (Number.isFinite(nested) && nested > 0) return nested;
          if (Array.isArray(a?.tracks?.data) && a.tracks.data.length > 0) return a.tracks.data.length;
          if (Array.isArray(a?.tracks) && a.tracks.length > 0) return a.tracks.length;
          return null;
        };

        const pickCover = (album, coverUrl) => {
          const url = typeof coverUrl === "string" ? coverUrl.trim() : "";
          if (url) return url;
          const a = album && typeof album === "object" ? album : null;
          if (!a) return "";
          const candidates = [
            a.cover_medium,
            a.cover_big,
            a.cover_xl,
            a.cover_small,
            a.cover,
            a.picture_medium,
            a.picture_big,
            a.picture_xl,
            a.picture_small,
            a.picture,
          ];
          for (const c of candidates) {
            const s = typeof c === "string" ? c.trim() : "";
            if (s) return s;
          }
          return "";
        };

        for (const row of rows) {
          const track = row?.track && typeof row.track === "object" ? row.track : null;
          const album =
            row?.album && typeof row.album === "object"
              ? row.album
              : track?.album && typeof track.album === "object"
                ? track.album
                : null;

          const albumId = getAlbumId(row);
          if (!albumId) continue;

          const trackId = Number(row?.trackId || track?.id || track?.SNG_ID);
          if (Number.isFinite(trackId) && trackId > 0) {
            const set = albumDownloadedTrackIdsById.get(albumId) || new Set();
            set.add(trackId);
            albumDownloadedTrackIdsById.set(albumId, set);

            const at = Math.max(getTrackDownloadedAt(trackId), Number(row?.mtimeMs) || 0);
            const prevAt = albumLastDownloadedAtById.get(albumId) || 0;
            if (at > prevAt) albumLastDownloadedAtById.set(albumId, at);

            const uuid = String(row?.uuid || "").trim();
            if (uuid) {
              if (uuid.startsWith("playlist_")) {
                albumHasPlaylistOriginById.set(albumId, true);
                const _m = uuid.match(/^playlist_(\d+)_track_/);
                if (_m) {
                  const _pid = Number(_m[1]);
                  const _dlEntry = downloadedTracksState[String(trackId)];
                  const _hasFile = _dlEntry && typeof _dlEntry === "object" && _dlEntry.download?.fileUrl;
                  if (Number.isFinite(_pid) && _pid > 0 && _hasFile) playlistIdsWithDownloadedTracks.add(_pid);
                }
              } else if (uuid.startsWith("album_") || uuid.startsWith("artist_")) {
                // Explicit album-context downloads should be treated as real albums in the sidebar.
                albumHasNonPlaylistOriginById.set(albumId, true);
              } else {
                // "dl_*" (single-track downloads) and unknown uuids are treated as origin-unknown;
                // they should not force albums to appear when the rest of the album comes from a playlist.
              }
            } else {
              // Older DB rows may not have uuid; treat as non-playlist to avoid accidentally hiding albums.
              albumHasNonPlaylistOriginById.set(albumId, true);
            }

            const parts = albumSearchPartsById.get(albumId) || new Set();
            if (parts.size < 60) {
              const tTitle = String(track?.title || track?.SNG_TITLE || "").trim();
              if (tTitle) parts.add(tTitle);
              const tArtist = String(track?.artist?.name || track?.ART_NAME || "").trim();
              if (tArtist) parts.add(tArtist);
            }
            albumSearchPartsById.set(albumId, parts);
          }

          if (!albumTotalsById.has(albumId)) {
            const total = getAlbumTotal(album);
            if (Number.isFinite(total) && total > 0) albumTotalsById.set(albumId, total);
          }

          if (!albumMetaById.has(albumId)) {
            const cover = pickCover(album, row?.coverUrl);
            albumMetaById.set(albumId, {
              title: String(album?.title || album?.ALB_TITLE || "").trim(),
              artist: String(album?.artist?.name || album?.artist?.ART_NAME || album?.ART_NAME || "").trim(),
              recordType: String(album?.record_type || album?.recordType || "").trim(),
              cover,
            });
          }
        }
      }

      if (window.dl?.listPlaylists) {
        const res = await window.dl.listPlaylists();
        const rows = Array.isArray(res?.playlists) ? res.playlists : [];
        for (const row of rows) {
          const playlistId = Number(row?.playlistId || row?.id);
          if (!Number.isFinite(playlistId) || playlistId <= 0) continue;
          const title = String(row?.title || "").trim();
          const cover = String(row?.picture || row?.picture_medium || row?.cover || "").trim();
          const total = Number(row?.total);
          const downloaded = Number(row?.downloaded);
          const updatedAt = Number(row?.updatedAt) || 0;
          downloadedPlaylistsById.set(playlistId, {
            title: title || `Playlist #${playlistId}`,
            hasTitle: Boolean(title),
            cover,
            total: Number.isFinite(total) && total >= 0 ? total : 0,
            downloaded: Number.isFinite(downloaded) && downloaded >= 0 ? downloaded : 0,
            updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
          });
        }
      }
    } catch {}

    const albumDownloadProgressById = new Map();
    const fullyDownloadedAlbumIds = new Set();
    const autoAddDownloadedAlbumIds = new Set();
    for (const [albumId, ids] of albumDownloadedTrackIdsById.entries()) {
      const total = albumTotalsById.get(albumId);
      if (!Number.isFinite(total) || total <= 0) continue;
      const downloaded = ids.size;
      albumDownloadProgressById.set(albumId, { total, downloaded });
      if (downloaded >= total) {
        fullyDownloadedAlbumIds.add(albumId);
        const fromPlaylist = Boolean(albumHasPlaylistOriginById.get(albumId));
        const fromNonPlaylist = Boolean(albumHasNonPlaylistOriginById.get(albumId));
        if (!(fromPlaylist && !fromNonPlaylist)) autoAddDownloadedAlbumIds.add(albumId);
      }
    }

    targetList.innerHTML = "";

    const addItem = ({
      category,
      title,
      subtitle,
      subtitlePinned,
      imageUrl,
      entityType,
      entityId,
      isActive,
      route,
      trackId,
      sortCreator,
      sortRecent,
      sortAdded,
      searchMeta,
    }) => {
      const a = createLibraryItemElement({
        category,
        title,
        subtitle,
        subtitlePinned,
        imageUrl,
        entityType,
        entityId,
        isActive,
        route,
        trackId,
        sortTitle: normalize(title),
        sortCreator: normalize(sortCreator || subtitle),
        sortRecent: String(Number(sortRecent) || 0),
        sortAdded: String(Number(sortAdded) || 0),
        searchMeta: searchMeta ? normalize(searchMeta) : "",
      });
      targetList.appendChild(a);
    };

    addItem({
      category: "playlist",
      title: "Liked Songs",
      subtitle: savedTracksCount > 0 ? `Playlist • ${savedTracksCount} tracks` : "Playlist • No saved tracks",
      subtitlePinned: true,
      entityType: null,
      entityId: null,
      isActive: true,
      route: "liked",
      sortRecent: Number.POSITIVE_INFINITY,
      sortAdded: Number.POSITIVE_INFINITY,
    });

    addItem({
      category: "playlist",
      title: "Downloads",
      subtitle: downloadedTracksCount > 0 ? `Offline • ${downloadedTracksCount} tracks` : "Offline • No downloads",
      subtitlePinned: true,
      entityType: null,
      entityId: null,
      isActive: false,
      route: "downloads",
      sortRecent: Number.POSITIVE_INFINITY - 1,
      sortAdded: Number.POSITIVE_INFINITY - 1,
    });

    const rest = [];

    const savedTracks = Object.values(state.savedTracks || {});
    const albumAddedAtById = new Map();
    for (const t of savedTracks) {
      const id = Number(t?.id);
      if (!Number.isFinite(id) || id <= 0) continue;

      const cover = String(t?.albumCover || "").trim();
      const addedAt = Number(t?.addedAt) || 0;
      const albumId = Number(t?.albumId);

      const playedAt = playedAtByTrackId.get(id) || 0;
      const recentAt = Math.max(playedAt, getTrackDownloadedAt(id), addedAt);

      if (Number.isFinite(albumId) && albumId > 0) {
        const prev = albumAddedAtById.get(albumId) || 0;
        const next = Math.max(prev, addedAt);
        if (next > prev) albumAddedAtById.set(albumId, next);
      }

      if (Number.isFinite(albumId) && albumId > 0 && fullyDownloadedAlbumIds.has(albumId)) continue;
    }

    const savedAlbums = Object.values(state.savedAlbums || {});
    const albumIdsInRest = new Set();
    for (const a of savedAlbums) {
      const id = Number(a?.id);
      if (!Number.isFinite(id) || id <= 0) continue;

      const hasDownloads = albumDownloadedTrackIdsById.has(id) && albumDownloadedTrackIdsById.get(id).size > 0;
      if (!hasDownloads) continue;

      const artist = String(a?.artist || "").trim();
      const title = String(a?.title || "Album");
      const typeLabel = formatRecordTypeLabel(a?.recordType || a?.record_type, { fallback: "Album" });
      const subtitleBase = artist ? `${typeLabel} • ${artist}` : typeLabel;
      const cover = String(a?.cover || "").trim();
      const addedAt = Number(a?.addedAt) || 0;

      const recentAtBase = Number(a?.updatedAt) || Number(a?.downloadedAt) || addedAt;
      const playedAt = playedAtByAlbumId.get(id) || 0;
      const downloadedAt = albumLastDownloadedAtById.get(id) || 0;
      const recentAt = Math.max(Number(recentAtBase) || 0, playedAt, downloadedAt);

      const progress = albumDownloadProgressById.get(id);
      const isFull = fullyDownloadedAlbumIds.has(id);
      let subtitle = subtitleBase;
      if (isFull) subtitle = `${subtitleBase} • Downloaded`;
      else if (progress && progress.downloaded > 0) subtitle = `${subtitleBase} • ${progress.downloaded}/${progress.total} downloaded`;

      const searchParts = albumSearchPartsById.get(id);
      const searchMeta = searchParts && searchParts.size > 0 ? Array.from(searchParts).join(" ") : "";

      rest.push({
        category: "album",
        title,
        subtitle,
        sortCreator: artist,
        imageUrl: cover,
        entityType: "album",
        entityId: id,
        route: null,
        trackId: null,
        sortRecent: recentAt,
        sortAdded: addedAt,
        searchMeta,
      });
      albumIdsInRest.add(id);
    }

    const savedPlaylists = Object.values(state.playlists || {});
    const playlistIdsInRest = new Set();
    for (const p of savedPlaylists) {
      const id = Number(p?.id);
      if (!Number.isFinite(id) || id <= 0) continue;

      if (!playlistIdsWithDownloadedTracks.has(id)) continue;

      const creator = String(p?.creator || "").trim();
      const title = String(p?.title || "Playlist");
      const dl = downloadedPlaylistsById.get(id) || null;
      const progress =
        dl && Number.isFinite(Number(dl.total)) && dl.total > 0
          ? `${Math.min(dl.total, Number(dl.downloaded) || 0)}/${dl.total} downloaded`
          : dl && (Number(dl.downloaded) || 0) > 0
            ? "Downloaded"
            : "";
      const subtitleBase = creator ? `Playlist • ${creator}` : "Playlist";
      const subtitle = progress ? `${subtitleBase} • ${progress}` : subtitleBase;
      const cover = String(p?.cover || "").trim();
      const addedAt = Number(p?.addedAt) || 0;
      const playedAt = playedAtByPlaylistId.get(id) || 0;
      const recentAt = Math.max(Number(p?.updatedAt) || 0, Number(p?.downloadedAt) || 0, dl?.updatedAt || 0, playedAt, addedAt);

      rest.push({
        category: "playlist",
        title,
        subtitle,
        sortCreator: creator,
        imageUrl: cover,
        entityType: "playlist",
        entityId: id,
        route: null,
        trackId: null,
        sortRecent: recentAt,
        sortAdded: addedAt,
      });
      playlistIdsInRest.add(id);
    }

    // Downloaded playlists (even if not saved) should show as a single container row to prevent album clutter.
    for (const [playlistId, dl] of downloadedPlaylistsById.entries()) {
      if (playlistIdsInRest.has(playlistId)) continue;
      if (!playlistIdsWithDownloadedTracks.has(playlistId)) continue;
      // Skip orphaned playlists whose metadata was deleted (title is a raw-ID fallback).
      if (!dl?.hasTitle) continue;
      const title = String(dl?.title || `Playlist #${playlistId}`).trim() || `Playlist #${playlistId}`;
      const total = Number(dl?.total) || 0;
      const downloaded = Number(dl?.downloaded) || 0;
      const progress = total > 0 ? `${Math.min(total, downloaded)}/${total} downloaded` : downloaded > 0 ? "Downloaded" : "";
      const subtitle = progress ? `Playlist • ${progress}` : "Playlist";
      const cover = String(dl?.cover || "").trim();
      const playedAt = playedAtByPlaylistId.get(playlistId) || 0;
      const recentAt = Math.max(Number(dl?.updatedAt) || 0, playedAt);

      rest.push({
        category: "playlist",
        title,
        subtitle,
        sortCreator: "",
        imageUrl: cover,
        entityType: "playlist",
        entityId: playlistId,
        route: null,
        trackId: null,
        sortRecent: recentAt,
        sortAdded: recentAt,
        searchMeta: title,
      });
      playlistIdsInRest.add(playlistId);
    }

    // Recently played playlists should only be visible if they have downloaded tracks.
    for (const [playlistId, playedAt] of playedAtByPlaylistId.entries()) {
      if (playlistIdsInRest.has(playlistId)) continue;
      if (!playlistIdsWithDownloadedTracks.has(playlistId)) continue;
      const meta = recentPlaylistMetaById.get(playlistId) || { title: "", cover: "" };
      const rawTitle = String(meta.title || "").trim();
      // Skip orphaned playlists whose metadata was deleted.
      if (!rawTitle) continue;
      const title = rawTitle || `Playlist #${playlistId}`;
      const cover = String(meta.cover || "").trim();
      rest.push({
        category: "playlist",
        title,
        subtitle: "Playlist",
        sortCreator: "",
        imageUrl: cover,
        entityType: "playlist",
        entityId: playlistId,
        route: null,
        trackId: null,
        sortRecent: playedAt,
        sortAdded: playedAt,
        searchMeta: title,
      });
      playlistIdsInRest.add(playlistId);
    }

    // Recently played albums should only be visible if they have downloaded tracks.
    for (const [albumId, playedAt] of playedAtByAlbumId.entries()) {
      if (albumIdsInRest.has(albumId)) continue;
      if (fullyDownloadedAlbumIds.has(albumId)) continue;

      const hasDownloads = albumDownloadedTrackIdsById.has(albumId) && albumDownloadedTrackIdsById.get(albumId).size > 0;
      if (!hasDownloads) continue;

      const meta = recentAlbumMetaById.get(albumId) || { title: "", artist: "", cover: "" };
      const title = String(meta.title || "Album").trim() || "Album";
      const artist = String(meta.artist || "").trim();
      const subtitleBase = formatRecordTypeLabel("", { fallback: "Album" });
      const subtitle = artist ? `${subtitleBase} • ${artist}` : subtitleBase;
      const cover = String(meta.cover || "").trim();

      rest.push({
        category: "album",
        title,
        subtitle,
        sortCreator: artist,
        imageUrl: cover,
        entityType: "album",
        entityId: albumId,
        route: null,
        trackId: null,
        sortRecent: playedAt,
        sortAdded: albumAddedAtById.get(albumId) || 0,
        searchMeta: [title, artist].filter(Boolean).join(" "),
      });
      albumIdsInRest.add(albumId);
    }

    for (const albumId of Array.from(autoAddDownloadedAlbumIds)) {
      if (state.savedAlbums && typeof state.savedAlbums === "object" && state.savedAlbums[String(albumId)]) continue;

      const meta = albumMetaById.get(albumId) || { title: "", artist: "", cover: "", recordType: "" };
      const title = String(meta.title || "Album").trim() || "Album";
      const artist = String(meta.artist || "").trim();
      const typeLabel = formatRecordTypeLabel(meta.recordType, { fallback: "Album" });
      const subtitleBase = artist ? `${typeLabel} • ${artist}` : typeLabel;
      const subtitle = `${subtitleBase} • Downloaded`;
      const cover = String(meta.cover || "").trim();

      const playedAt = playedAtByAlbumId.get(albumId) || 0;
      const downloadedAt = albumLastDownloadedAtById.get(albumId) || 0;
      const sortRecent = Math.max(playedAt, downloadedAt);
      const sortAdded = Math.max(albumAddedAtById.get(albumId) || 0, downloadedAt);

      const searchParts = albumSearchPartsById.get(albumId);
      const searchMeta = searchParts && searchParts.size > 0 ? Array.from(searchParts).join(" ") : "";

      rest.push({
        category: "album",
        title,
        subtitle,
        sortCreator: artist,
        imageUrl: cover,
        entityType: "album",
        entityId: albumId,
        route: null,
        trackId: null,
        sortRecent,
        sortAdded,
        searchMeta,
      });
      albumIdsInRest.add(albumId);
    }

    rest.sort((a, b) => (Number(b.sortRecent) || 0) - (Number(a.sortRecent) || 0));
    for (const it of rest) addItem({ ...it, isActive: false });
  };

  return { renderLibraryLocal };
}
