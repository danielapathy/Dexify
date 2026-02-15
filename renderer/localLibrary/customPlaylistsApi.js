// Helper to create composite image from 4 album covers
async function createCompositeImage(urls) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  
  const loadImage = (url) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
  
  const images = await Promise.all(urls.map(loadImage));
  
  // Draw 2x2 grid
  ctx.drawImage(images[0], 0, 0, 256, 256);
  ctx.drawImage(images[1], 256, 0, 256, 256);
  ctx.drawImage(images[2], 0, 256, 256, 256);
  ctx.drawImage(images[3], 256, 256, 256, 256);
  
  return canvas.toDataURL("image/jpeg", 0.92);
}

// Generate composite cover from playlist tracks
async function generateCompositeCover(playlist) {
  const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  const tracksMap = playlist.tracks || {};
  
  // Collect unique album covers (newest first)
  const seen = new Set();
  const covers = [];
  for (let i = trackIds.length - 1; i >= 0 && covers.length < 4; i--) {
    const track = tracksMap[String(trackIds[i])];
    const albumCover = String(track?.albumCover || "").trim();
    if (albumCover && !seen.has(albumCover)) {
      seen.add(albumCover);
      covers.push(albumCover);
    }
  }
  
  // If < 4 tracks total, use single cover
  if (trackIds.length < 4) {
    return covers.length > 0 ? covers[0] : "";
  }
  
  // If >= 4 tracks but < 4 unique covers, duplicate to fill grid
  if (covers.length >= 2 && covers.length < 4) {
    while (covers.length < 4) covers.push(covers[covers.length - 1]);
  }
  
  if (covers.length === 4) {
    try {
      return await createCompositeImage(covers);
    } catch {
      return covers[0] || "";
    }
  }
  
  return covers[0] || "";
}

export function createCustomPlaylistsApi({ load, save, notify }) {
  const ensureCustomPlaylists = (state) => {
    if (!state.customPlaylists || typeof state.customPlaylists !== "object") state.customPlaylists = {};
  };

  const createCustomPlaylist = ({ title } = {}) => {
    const now = Date.now();
    const id = `cp_${now}`;
    const playlist = {
      id,
      title: String(title || "").trim() || `My Playlist #${Object.keys(load().customPlaylists || {}).length + 1}`,
      cover: "",
      customCover: false,
      trackIds: [],
      tracks: {},
      createdAt: now,
      updatedAt: now,
      playedAt: 0,
    };
    const next = load();
    ensureCustomPlaylists(next);
    next.customPlaylists[id] = playlist;
    save(next);
    notify();
    return playlist;
  };

  const deleteCustomPlaylist = (id) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureCustomPlaylists(next);
    if (!next.customPlaylists[key]) return false;
    delete next.customPlaylists[key];
    // Also remove from any folders
    if (next.folders && typeof next.folders === "object") {
      for (const folder of Object.values(next.folders)) {
        if (Array.isArray(folder.children)) {
          folder.children = folder.children.filter(
            (c) => !(c.type === "customPlaylist" && String(c.id) === key),
          );
        }
      }
    }
    save(next);
    notify();
    return true;
  };

  const renameCustomPlaylist = (id, title) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;
    p.title = String(title || "").trim() || p.title;
    p.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const addTrackToCustomPlaylist = (playlistId, track) => {
    const key = String(playlistId || "");
    if (!key) return false;
    const t = track && typeof track === "object" ? track : null;
    if (!t) return false;
    const trackId = Number(t.id || t.SNG_ID);
    if (!Number.isFinite(trackId) || trackId <= 0) return false;

    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;
    if (!Array.isArray(p.trackIds)) p.trackIds = [];
    if (!p.tracks || typeof p.tracks !== "object") p.tracks = {};

    // Dedupe
    if (p.trackIds.includes(trackId)) return false;

    p.trackIds.push(trackId);
    p.tracks[String(trackId)] = {
      id: trackId,
      title: String(t.title || t.SNG_TITLE || ""),
      artist: String(t.artist?.name || t.ART_NAME || t.artist || ""),
      albumId: Number(t.album?.id || t.ALB_ID) || null,
      albumTitle: String(t.album?.title || t.ALB_TITLE || ""),
      albumCover: String(
        t.album?.cover_medium || t.album?.cover_small || t.album?.cover || t.cover || "",
      ).trim(),
      duration: Number(t.duration || t.DURATION) || 0,
      explicit: Boolean(t.explicit_lyrics || t.EXPLICIT_LYRICS),
      addedAt: Date.now(),
    };
    p.updatedAt = Date.now();

    // Auto-generate composite cover if no custom cover
    if (!p.customCover) {
      generateCompositeCover(p).then((cover) => {
        const current = load();
        const playlist = current.customPlaylists?.[key];
        if (playlist && !playlist.customCover) {
          playlist.cover = cover;
          save(current);
          notify();
        }
      }).catch(() => {});
    }

    save(next);
    notify();
    return true;
  };

  const removeTrackFromCustomPlaylist = (playlistId, trackId) => {
    const key = String(playlistId || "");
    const tid = Number(trackId);
    if (!key || !Number.isFinite(tid) || tid <= 0) return false;

    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;
    if (!Array.isArray(p.trackIds)) return false;

    const idx = p.trackIds.indexOf(tid);
    if (idx === -1) return false;
    p.trackIds.splice(idx, 1);
    delete p.tracks?.[String(tid)];
    p.updatedAt = Date.now();

    // Clear cover if playlist is now empty
    if (p.trackIds.length === 0) {
      p.cover = "";
      p.customCover = false;
    } else if (!p.customCover) {
      // Set an immediate synchronous cover from the first remaining track's
      // album art so that page refreshes see the correct cover right away.
      const firstTid = p.trackIds[0];
      const firstTrack = p.tracks?.[String(firstTid)];
      const immediateCover = String(firstTrack?.albumCover || "").trim();
      if (immediateCover) p.cover = immediateCover;
      // Fire async composite cover regeneration (for 4-grid) in the background.
      generateCompositeCover(p).then((cover) => {
        const current = load();
        const playlist = current.customPlaylists?.[key];
        if (playlist && !playlist.customCover && cover && cover !== playlist.cover) {
          playlist.cover = cover;
          save(current);
          notify();
        }
      }).catch(() => {});
    }

    save(next);
    notify();
    return true;
  };

  const reorderCustomPlaylistTracks = (playlistId, trackIds) => {
    const key = String(playlistId || "");
    if (!key || !Array.isArray(trackIds)) return false;

    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;

    const validIds = trackIds.map(Number).filter((n) => Number.isFinite(n) && n > 0);
    p.trackIds = validIds;
    p.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const listCustomPlaylists = () => {
    const state = load();
    ensureCustomPlaylists(state);
    const items = Object.values(state.customPlaylists);
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return items;
  };

  const getCustomPlaylist = (id) => {
    const key = String(id || "");
    if (!key) return null;
    const state = load();
    ensureCustomPlaylists(state);
    return state.customPlaylists[key] || null;
  };

  const markCustomPlaylistPlayed = (id) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;
    p.playedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const setCustomPlaylistCover = (id, dataUrl) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;
    p.cover = String(dataUrl || "").trim();
    p.customCover = true;
    p.updatedAt = Date.now();
    save(next);
    notify();
    return true;
  };

  const clearCustomPlaylistCover = (id) => {
    const key = String(id || "");
    if (!key) return false;
    const next = load();
    ensureCustomPlaylists(next);
    const p = next.customPlaylists[key];
    if (!p) return false;
    p.customCover = false;
    p.updatedAt = Date.now();
    
    // Regenerate composite cover
    generateCompositeCover(p).then((cover) => {
      const current = load();
      const playlist = current.customPlaylists?.[key];
      if (playlist && !playlist.customCover) {
        playlist.cover = cover;
        save(current);
        notify();
      }
    }).catch(() => {
      p.cover = "";
      save(next);
      notify();
    });
    
    save(next);
    notify();
    return true;
  };

  return {
    createCustomPlaylist,
    deleteCustomPlaylist,
    renameCustomPlaylist,
    addTrackToCustomPlaylist,
    removeTrackFromCustomPlaylist,
    reorderCustomPlaylistTracks,
    listCustomPlaylists,
    getCustomPlaylist,
    markCustomPlaylistPlayed,
    setCustomPlaylistCover,
    clearCustomPlaylistCover,
  };
}
