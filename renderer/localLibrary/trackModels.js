const MD5_HEX_RE = /^[a-f0-9]{32}$/i;

export function md5ToCoverUrl(md5, { size = 250 } = {}) {
  const value = String(md5 || "").trim();
  if (!value || !MD5_HEX_RE.test(value)) return "";
  const n = Number(size);
  const px = Number.isFinite(n) && n > 0 ? Math.round(n) : 250;
  return `https://e-cdns-images.dzcdn.net/images/cover/${value}/${px}x${px}-000000-80-0-0.jpg`;
}

export function coverFromTrack(track, { includeSmallAlbumCover = false, size = 250 } = {}) {
  const raw = track && typeof track === "object" ? track : null;
  if (!raw) return "";
  const albumCover = includeSmallAlbumCover
    ? String(raw?.album?.cover_medium || raw?.album?.cover_small || raw?.album?.cover || "")
    : String(raw?.album?.cover_medium || raw?.album?.cover || "");
  return albumCover || String(raw?.cover || "") || md5ToCoverUrl(raw?.ALB_PICTURE, { size }) || "";
}

export function compactTrackJson(track) {
  const raw = track && typeof track === "object" ? track : null;
  if (!raw) return null;
  const id = Number(raw?.id || raw?.SNG_ID);
  if (!Number.isFinite(id) || id <= 0) return null;

  const album = raw?.album && typeof raw.album === "object" ? raw.album : null;
  const artist = raw?.artist && typeof raw.artist === "object" ? raw.artist : null;
  const coverFallback = coverFromTrack(raw, { includeSmallAlbumCover: true });

  return {
    id,
    title: String(raw?.title || raw?.SNG_TITLE || ""),
    duration: Number(raw?.duration || raw?.DURATION || 0) || 0,
    preview: String(raw?.preview || ""),
    explicit: Boolean(raw?.explicit_lyrics || raw?.EXPLICIT_LYRICS),
    artist: artist ? { id: Number(artist?.id) || null, name: String(artist?.name || "") } : { id: null, name: String(raw?.ART_NAME || "") },
    album: album
      ? {
          id: Number(album?.id) || null,
          title: String(album?.title || raw?.ALB_TITLE || ""),
          cover_small: String(album?.cover_small || coverFallback || ""),
          cover_medium: String(album?.cover_medium || coverFallback || ""),
          cover: String(album?.cover || coverFallback || ""),
        }
      : {
          id: Number(raw?.ALB_ID) || null,
          title: String(raw?.ALB_TITLE || ""),
          cover_small: String(coverFallback || ""),
          cover_medium: String(coverFallback || ""),
          cover: String(coverFallback || ""),
        },
  };
}

export function withTrackJsonCover(trackJson, coverValue) {
  const cover = String(coverValue || "").trim();
  if (!trackJson || typeof trackJson !== "object" || !cover) return trackJson;
  const next = { ...trackJson, cover: String(trackJson.cover || cover) };
  if (next.album && typeof next.album === "object") {
    next.album = { ...next.album };
    next.album.cover_small = String(next.album.cover_small || cover);
    next.album.cover_medium = String(next.album.cover_medium || cover);
    next.album.cover = String(next.album.cover || cover);
  } else if (next.album === undefined) {
    next.album = { cover_small: cover, cover_medium: cover, cover };
  }
  return next;
}
