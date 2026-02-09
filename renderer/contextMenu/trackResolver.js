export function normalizeTrackFromAny(source) {
  const t = source && typeof source === "object" ? source : null;
  if (!t) return null;
  const id = Number(t?.id || t?.SNG_ID);
  if (!Number.isFinite(id) || id <= 0) return null;
  return t;
}

export function getAlbumIdFromTrack(trackLike) {
  const track = normalizeTrackFromAny(trackLike);
  if (!track) return null;
  let raw = track?.raw && typeof track.raw === "object" ? track.raw : null;
  // Many parts of the app wrap track objects (normalizeTrack/snapshotTrack). Unwrap a couple levels.
  for (let i = 0; i < 3; i++) {
    if (!raw || typeof raw !== "object") break;
    const next = raw.raw && typeof raw.raw === "object" ? raw.raw : null;
    if (!next) break;
    raw = next;
  }
  const id =
    track?.album?.id ||
    track?.albumId ||
    track?.ALB_ID ||
    track?.ALBUM_ID ||
    track?.album_id ||
    track?.trackJson?.album?.id ||
    track?.data?.ALB_ID ||
    track?.data?.album?.id ||
    raw?.album?.id ||
    raw?.albumId ||
    raw?.album_id ||
    raw?.ALB_ID ||
    raw?.trackJson?.album?.id ||
    raw?.data?.ALB_ID ||
    raw?.data?.album?.id ||
    null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function getArtistIdFromTrack(trackLike) {
  const track = normalizeTrackFromAny(trackLike);
  if (!track) return null;
  let raw = track?.raw && typeof track.raw === "object" ? track.raw : null;
  // Many parts of the app wrap track objects (normalizeTrack/snapshotTrack). Unwrap a couple levels.
  for (let i = 0; i < 3; i++) {
    if (!raw || typeof raw !== "object") break;
    const next = raw.raw && typeof raw.raw === "object" ? raw.raw : null;
    if (!next) break;
    raw = next;
  }
  const id =
    track?.artist?.id ||
    track?.artistId ||
    track?.ART_ID ||
    track?.artist_id ||
    track?.trackJson?.artist?.id ||
    track?.data?.ART_ID ||
    track?.data?.artist?.id ||
    raw?.artist?.id ||
    raw?.artistId ||
    raw?.artist_id ||
    raw?.ART_ID ||
    raw?.trackJson?.artist?.id ||
    raw?.data?.ART_ID ||
    raw?.data?.artist?.id ||
    null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function extractTrackMetaFromRow(row) {
  const root = row && row.nodeType === 1 ? row : null;
  if (!root) return null;
  const trackId = Number(root.dataset.trackId);
  if (!Number.isFinite(trackId) || trackId <= 0) return null;

  const title =
    String(root.querySelector(".entity-track__title")?.textContent || root.querySelector(".search-track__title")?.textContent || "").trim() ||
    "Track";
  const artist =
    String(root.querySelector(".entity-track__artist")?.textContent || root.querySelector(".search-track__subtitle")?.textContent || "").trim();
  const coverSrc =
    root.querySelector(".entity-track__cover img")?.getAttribute?.("src") ||
    root.querySelector(".search-track__cover img")?.getAttribute?.("src") ||
    "";

  const albumId = Number(root.dataset.albumId);
  const cleanAlbumId = Number.isFinite(albumId) && albumId > 0 ? albumId : null;
  const artistId = Number(root.dataset.artistId);
  const cleanArtistId = Number.isFinite(artistId) && artistId > 0 ? artistId : null;

  return {
    id: trackId,
    title,
    artist: { id: cleanArtistId, name: artist },
    album: cleanAlbumId || coverSrc ? { id: cleanAlbumId, cover_medium: coverSrc, cover_small: coverSrc, cover: coverSrc } : undefined,
  };
}

export function resolveTrackFromRow(row, { getTrackListInfoFromRow }) {
  const fromDom = extractTrackMetaFromRow(row);
  const idx = Number(row?.dataset?.trackIndex);
  const info = typeof getTrackListInfoFromRow === "function" ? getTrackListInfoFromRow(row) : null;
  const list = Array.isArray(info?.tracks) ? info.tracks : [];
  const fromList = Number.isFinite(idx) && idx >= 0 ? normalizeTrackFromAny(list[idx]) : null;

  if (!fromDom) return fromList;
  if (!fromList) return fromDom;

  const albumId = getAlbumIdFromTrack(fromList) || getAlbumIdFromTrack(fromDom);
  const artistId = getArtistIdFromTrack(fromList) || getArtistIdFromTrack(fromDom);

  const merged = { ...fromList };
  if (artistId) merged.artist = { ...(merged.artist || {}), id: artistId };
  if (albumId) merged.album = { ...(merged.album || {}), id: albumId };
  const cover = fromDom?.album?.cover_medium || fromDom?.album?.cover || "";
  if (cover) {
    merged.album = {
      ...(merged.album || {}),
      cover_medium: merged.album?.cover_medium || cover,
      cover_small: merged.album?.cover_small || cover,
      cover: merged.album?.cover || cover,
    };
  }
  return merged;
}
