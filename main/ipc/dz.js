function registerDzIpcHandlers({ ipcMain, state, refreshSessionUser, getDzClient }) {
  ipcMain.handle("dz:status", async () => {
    await refreshSessionUser();
    const dzRes = await getDzClient({ requireLogin: true });
    return {
      ok: true,
      hasARL: Boolean(state.sessionState.arl),
      user: state.sessionUser || null,
      deezerSdkLoggedIn: Boolean(dzRes?.ok && dzRes.dz?.loggedIn),
    };
  });

  ipcMain.handle("dz:mainSearch", async (_event, payload) => {
    const term = String(payload?.term || "").trim();
    if (!term) return { ok: true, results: null };

    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;
    try {
      const index = Number.isFinite(Number(payload?.start)) ? Number(payload.start) : 0;
      const limit = Number.isFinite(Number(payload?.nb)) ? Number(payload.nb) : 20;
      const results = await dzRes.dz.gw.search(term, index, limit);
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: "main_search_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:search", async (_event, payload) => {
    const term = String(payload?.term || "").trim();
    if (!term) return { ok: true, results: { data: [], total: 0 } };

    const dzRes = await getDzClient({ requireLogin: false });
    if (!dzRes.ok) return dzRes;

    const type = String(payload?.type || "").trim().toLowerCase();
    const index = Number.isFinite(Number(payload?.start)) ? Number(payload.start) : 0;
    const limit = Number.isFinite(Number(payload?.nb)) ? Number(payload.nb) : 25;

    try {
      let results;
      switch (type) {
        case "track":
          results = await dzRes.dz.api.search_track(term, { limit, index });
          break;
        case "album":
          results = await dzRes.dz.api.search_album(term, { limit, index });
          break;
        case "artist":
          results = await dzRes.dz.api.search_artist(term, { limit, index });
          break;
        case "playlist":
          results = await dzRes.dz.api.search_playlist(term, { limit, index });
          break;
        case "radio":
          results = await dzRes.dz.api.search_radio(term, { limit, index });
          break;
        case "user":
          results = await dzRes.dz.api.search_user(term, { limit, index });
          break;
        default:
          results = await dzRes.dz.api.search(term, { limit, index });
          break;
      }
      return { ok: true, results, type };
    } catch (e) {
      return { ok: false, error: "search_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:getUserFavorites", async () => {
    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    try {
      const dz = dzRes.dz;
      if (!dz.loggedIn || !dz.currentUser?.id) return { ok: false, error: "not_logged_in" };
      const userID = dz.currentUser.id;

      const [playlists, albums, artists] = await Promise.all([
        dz.gw.get_user_playlists(userID, { limit: -1 }),
        dz.gw.get_user_albums(userID, { limit: -1 }),
        dz.gw.get_user_artists(userID, { limit: -1 }),
      ]);

      const tracks = await dz.gw.get_my_favorite_tracks({ limit: 100 });
      const lovedTracks = dz.currentUser?.loved_tracks
        ? `https://deezer.com/playlist/${dz.currentUser.loved_tracks}`
        : null;

      return { ok: true, playlists, albums, artists, tracks, lovedTracks };
    } catch (e) {
      return { ok: false, error: "get_user_favorites_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:getUserTracks", async (_event, payload) => {
    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    try {
      const limit = payload?.limit === -1 ? -1 : Number(payload?.limit) || 100;
      const tracks = await dzRes.dz.gw.get_my_favorite_tracks({ limit });
      return { ok: true, tracks };
    } catch (e) {
      return { ok: false, error: "get_user_tracks_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:getTrack", async (_event, payload) => {
    const id = Number(payload?.id);
    if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "bad_request" };

    const dzRes = await getDzClient({ requireLogin: false });
    if (!dzRes.ok) return dzRes;

    try {
      const dz = dzRes.dz;
      const track =
        dz?.gw && typeof dz.gw.get_track_with_fallback === "function"
          ? await dz.gw.get_track_with_fallback(String(id))
          : dz?.api && typeof dz.api.get_track === "function"
            ? await dz.api.get_track(String(id))
            : null;
      if (!track || typeof track !== "object") return { ok: false, error: "track_fetch_failed" };
      return { ok: true, track };
    } catch (e) {
      return { ok: false, error: "track_fetch_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:getCapabilities", async () => {
    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;
    const user = dzRes?.dz?.currentUser || null;
    return {
      ok: true,
      capabilities: {
        can_stream_hq: Boolean(user?.can_stream_hq),
        can_stream_lossless: Boolean(user?.can_stream_lossless),
      },
    };
  });

  ipcMain.handle("dz:getTracklist", async (_event, payload) => {
    const id = String(payload?.id || "").trim();
    const type = String(payload?.type || "").trim().toLowerCase();
    if (!id || !type) return { ok: false, error: "bad_request" };

    try {
      let dzRes = null;
      if (type === "smarttracklist") {
        if (!state.sessionState.arl) return { ok: false, error: "not_logged_in" };
        dzRes = await getDzClient({ requireLogin: true });
      } else {
        // Prefer authed client when available (many home/app-state entities are personalized).
        const authed = await getDzClient({ requireLogin: true });
        dzRes = authed?.ok ? authed : await getDzClient({ requireLogin: false });
      }
      if (!dzRes?.ok) return dzRes || { ok: false, error: "deezer_client_unavailable" };

      const dz = dzRes.dz;
      if (type === "artist") {
        const artist = await dz.api.get_artist(id);
        if (!artist || typeof artist !== "object") return { ok: false, error: "artist_fetch_failed" };

        const safeCall = async (fn, fallback) => {
          try {
            return await fn();
          } catch {
            return fallback;
          }
        };

        const [top, albums, related, radio, playlists] = await Promise.all([
          safeCall(() => dz.api.get_artist_top(id, { limit: 80 }), null),
          safeCall(() => dz.api.get_artist_albums(id, { limit: 120 }), null),
          safeCall(() => dz.api.get_artist_related(id, { limit: 40 }), null),
          safeCall(() => dz.api.get_artist_radio(id, { limit: 80 }), null),
          safeCall(() => dz.api.get_artist_playlists(id, { limit: 40 }), null),
        ]);

        const topTracks = Array.isArray(top?.data) ? top.data : [];
        const albumsList = Array.isArray(albums?.data) ? albums.data : [];
        const relatedArtists = Array.isArray(related?.data) ? related.data : [];
        const radioTracks = Array.isArray(radio?.data) ? radio.data : [];
        const playlistItems = Array.isArray(playlists?.data) ? playlists.data : [];

        return {
          ok: true,
          data: {
            ...artist,
            topTracks,
            albums: albumsList,
            related: relatedArtists,
            radio: radioTracks,
            playlists: playlistItems,
          },
        };
      }

      if (type === "album") {
        const album = await dz.api.get_album(id);
        const tracksRes = await dz.api.get_album_tracks(id, { limit: 1000 });
        const tracks =
          Array.isArray(tracksRes?.data) ? tracksRes.data : Array.isArray(album?.tracks?.data) ? album.tracks.data : [];
        return { ok: true, data: { ...album, tracks } };
      }

      if (type === "playlist") {
        const playlist = await dz.api.get_playlist(id);
        const tracksRes = await dz.api.get_playlist_tracks(id, { limit: 1000 });
        const tracks =
          Array.isArray(tracksRes?.data)
            ? tracksRes.data
            : Array.isArray(playlist?.tracks?.data)
              ? playlist.tracks.data
              : [];
        return { ok: true, data: { ...playlist, tracks } };
      }

      if (type === "radio") {
        const radio = await dz.api.get_radio(id);
        const tracksRes = await dz.api.get_radio_tracks(id, { limit: 200 });
        const tracks = Array.isArray(tracksRes?.data) ? tracksRes.data : [];
        return { ok: true, data: { ...radio, tracks } };
      }

      if (type === "smarttracklist") {
        const gw = dz.gw;
        if (!gw || typeof gw.api_call !== "function") return { ok: false, error: "gw_unavailable" };
        const res = await gw.api_call("smartTracklist.getSongs", { SMARTTRACKLIST_ID: id, start: 0, nb: 200 });
        const tracks =
          (Array.isArray(res?.data) && res.data) ||
          (Array.isArray(res?.SONGS) && res.SONGS) ||
          (Array.isArray(res?.songs) && res.songs) ||
          (Array.isArray(res?.results?.data) && res.results.data) ||
          [];
        return { ok: true, data: { SMARTTRACKLIST_ID: id, tracks } };
      }

      return { ok: false, error: "unsupported_type", type };
    } catch (e) {
      return { ok: false, error: "get_tracklist_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:getPage", async (_event, payload) => {
    const page = String(payload?.page || payload?.link || "").trim();
    if (!page) return { ok: false, error: "bad_request" };

    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;

    try {
      const result = await dzRes.dz.gw.get_page(page);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: "get_page_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:likeTrack", async (_event, payload) => {
    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;
    const sngId = Number(payload?.id);
    if (!Number.isFinite(sngId) || sngId <= 0) return { ok: false, error: "bad_request" };
    try {
      const res = await dzRes.dz.gw.add_song_to_favorites(sngId);
      return { ok: true, result: res };
    } catch (e) {
      return { ok: false, error: "like_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("dz:unlikeTrack", async (_event, payload) => {
    const dzRes = await getDzClient({ requireLogin: true });
    if (!dzRes.ok) return dzRes;
    const sngId = Number(payload?.id);
    if (!Number.isFinite(sngId) || sngId <= 0) return { ok: false, error: "bad_request" };
    try {
      const res = await dzRes.dz.gw.remove_song_from_favorites(sngId);
      return { ok: true, result: res };
    } catch (e) {
      return { ok: false, error: "unlike_failed", message: String(e?.message || e) };
    }
  });
}

module.exports = { registerDzIpcHandlers };
