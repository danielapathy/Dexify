export function resolveTrackId(track) {
  const t = track && typeof track === "object" ? track : null;
  if (!t) return null;
  const raw0 = t?.raw && typeof t.raw === "object" ? t.raw : t;
  const raw = raw0?.raw && typeof raw0.raw === "object" ? raw0.raw : raw0;
  const id = Number(t?.id ?? raw?.id ?? raw?.SNG_ID ?? raw?.trackId ?? raw?.data?.SNG_ID ?? raw?.data?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function snapshotTrack(track) {
  const t = track && typeof track === "object" ? track : null;
  if (!t) return null;
  const raw0 = t?.raw && typeof t.raw === "object" ? t.raw : t;
  const raw = raw0?.raw && typeof raw0.raw === "object" ? raw0.raw : raw0;
  const id = resolveTrackId(t);
  const title = String(t?.title || raw?.title || raw?.SNG_TITLE || "");
  const artistName = String(t?.artist || raw?.artist?.name || raw?.ART_NAME || "");
  const duration = Number(t?.duration || raw?.duration || raw?.DURATION || 0) || 0;
  const preview = String(t?.preview || raw?.preview || "");
  const cover = String(t?.cover || raw?.cover || raw?.album?.cover_medium || raw?.album?.cover || "");
  const artist = raw?.artist && typeof raw.artist === "object" ? raw.artist : { name: artistName };
  const album =
    raw?.album && typeof raw.album === "object"
      ? raw.album
      : cover
        ? { cover_small: cover, cover_medium: cover, cover }
        : undefined;
  return {
    id,
    title,
    duration,
    preview,
    artist,
    album,
    ...(cover ? { cover } : {}),
  };
}

export function normalizeTrack(t) {
  if (!t || typeof t !== "object") return null;
  const id = Number(t?.id || t?.SNG_ID || t?.trackId || t?.data?.SNG_ID || t?.data?.id);
  const title = String(t?.title || t?.SNG_TITLE || t?.data?.SNG_TITLE || t?.data?.title || "");
  const artist = String(t?.artist?.name || t?.ART_NAME || t?.data?.ART_NAME || t?.data?.artist || "");
  const duration = Number(t?.duration || t?.DURATION || t?.data?.DURATION || t?.data?.duration || 0) || 0;
  const preview = String(t?.preview || t?.data?.preview || "");
  const md5 = String(t?.ALB_PICTURE || t?.data?.ALB_PICTURE || "");
  const md5Cover =
    md5 && /^[a-f0-9]{32}$/i.test(md5)
      ? `https://e-cdns-images.dzcdn.net/images/cover/${md5}/100x100-000000-80-0-0.jpg`
      : "";
  const album =
    t?.album && typeof t.album === "object" ? t.album : t?.data?.album && typeof t.data.album === "object" ? t.data.album : null;
  const cover = String(album?.cover_small || album?.cover_medium || album?.cover || t?.cover || t?.data?.cover || md5Cover || "") || "";
  return { id: Number.isFinite(id) ? id : null, title, artist, duration, preview, cover, raw: t };
}

