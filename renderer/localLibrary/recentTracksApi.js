import { withTrackJsonCover } from "./trackModels.js";

export function createRecentTracksApi({ load, save, notify, compactTrackJson, coverFromTrack }) {
  const addRecentTrack = (track, { context } = {}) => {
    const t = track && typeof track === "object" ? track : null;
    const id = Number(t?.id || t?.SNG_ID);
    if (!Number.isFinite(id) || id <= 0) return false;

    const ctx = context && typeof context === "object" ? context : null;
    const ctxType = String(ctx?.type || ctx?.kind || "")
      .trim()
      .toLowerCase();
    const ctxId = Number(ctx?.id);
    const playlistId = ctxType === "playlist" && Number.isFinite(ctxId) && ctxId > 0 ? ctxId : null;
    const playlistTitle = playlistId ? String(ctx?.title || "").trim() : "";
    const playlistCover = playlistId ? String(ctx?.cover || "").trim() : "";

    const now = Date.now();
    const next = load();
    const existing = Array.isArray(next.recentTracks) ? next.recentTracks : [];
    const prev = existing.find((item) => Number(item?.id) === id) || null;
    const computedCover = coverFromTrack(t, { includeSmallAlbumCover: true, size: 250 });
    const prevCover =
      String(prev?.albumCover || "").trim() ||
      String(prev?.trackJson?.album?.cover_medium || prev?.trackJson?.album?.cover_small || prev?.trackJson?.album?.cover || "").trim() ||
      "";
    const cover = String(computedCover || prevCover || "").trim();

    const baseTrackJson = compactTrackJson(t) || (prev?.trackJson && typeof prev.trackJson === "object" ? { ...prev.trackJson } : null);
    const trackJson = withTrackJsonCover(baseTrackJson, cover);

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
      playlistId,
      playlistTitle,
      playlistCover,
      playedAt: now,
      trackJson: trackJson || null,
    };

    const deduped = existing.filter((item) => Number(item?.id) !== id);
    deduped.unshift(entry);
    next.recentTracks = deduped.slice(0, 30);

    save(next);
    notify();
    return true;
  };

  const listRecentTracks = () => {
    const state = load();
    const items = Array.isArray(state.recentTracks) ? state.recentTracks.slice() : [];
    items.sort((a, b) => (b.playedAt || 0) - (a.playedAt || 0));
    return items;
  };

  const removeRecentTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return false;
    const next = load();
    const existing = Array.isArray(next.recentTracks) ? next.recentTracks : [];
    const filtered = existing.filter((item) => Number(item?.id) !== id);
    if (filtered.length === existing.length) return false;
    next.recentTracks = filtered;
    save(next);
    notify();
    return true;
  };

  const getRecentTrack = (trackId) => {
    const id = Number(trackId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const state = load();
    const items = Array.isArray(state.recentTracks) ? state.recentTracks : [];
    const found = items.find((item) => Number(item?.id) === id);
    const trackJson = found?.trackJson && typeof found.trackJson === "object" ? { ...found.trackJson } : null;
    if (!trackJson) return null;

    const cover =
      String(found?.albumCover || "").trim() ||
      String(trackJson?.album?.cover_medium || trackJson?.album?.cover_small || trackJson?.album?.cover || trackJson?.cover || "").trim() ||
      "";
    return withTrackJsonCover(trackJson, cover);
  };

  return {
    addRecentTrack,
    listRecentTracks,
    removeRecentTrack,
    getRecentTrack,
  };
}
