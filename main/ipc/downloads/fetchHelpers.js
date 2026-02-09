function createDownloadFetchHelpers({ fs, toIdString, normalizeQuality }) {
  const qualityToBitrate = (quality) => {
    const q = normalizeQuality(quality);
    return q === "flac" ? 9 : q === "mp3_320" ? 3 : 1;
  };

  const parseDeezerUrl = (url) => {
    const value = String(url || "").trim();
    const match = value.match(/deezer\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist)\/(\d+)/i);
    if (!match) return null;
    return { type: String(match[1]).toLowerCase(), id: Number(match[2]) };
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
          const track = await fn.call(api, id);
          if (track && typeof track === "object") return track;
        } catch {}
      }
    }

    if (gw) {
      const fn = gw.get_track_with_fallback || gw.getTrack || null;
      if (typeof fn === "function") {
        try {
          const track = await fn.call(gw, id);
          if (track && typeof track === "object") return track;
        } catch {}
      }

      const pageFn = gw.get_track_page || null;
      if (typeof pageFn === "function") {
        try {
          const page = await pageFn.call(gw, id);
          const track = page?.DATA && typeof page.DATA === "object" ? page.DATA : page;
          if (track && typeof track === "object") return track;
        } catch {}
      }
    }

    return null;
  };

  return {
    qualityToBitrate,
    parseDeezerUrl,
    safeRmDir,
    tryFetchAlbumFull,
    tryFetchPlaylistFull,
    tryFetchArtistAlbums,
    tryFetchTrack,
  };
}

module.exports = { createDownloadFetchHelpers };
