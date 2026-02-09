export function createPlayerLikeControls({
  state,
  lib,
  resolveTrackId,
  setLikeIcon,
  getDownloadQualityRaw,
  rememberDownloadMeta,
}) {
  const refreshLikeStatus = async () => {
    const trackId = resolveTrackId(state.track);
    if (!trackId) return;
    state.liked = lib.isTrackSaved(trackId);
    setLikeIcon(state.liked);
  };

  const toggleLike = async () => {
    const trackId = resolveTrackId(state.track);
    if (!trackId) return;

    const nextLiked = !state.liked;
    state.liked = nextLiked;
    setLikeIcon(nextLiked);
    try {
      if (nextLiked) {
        const raw0 = state.track?.raw && typeof state.track.raw === "object" ? state.track.raw : null;
        const raw1 = raw0?.raw && typeof raw0.raw === "object" ? raw0.raw : raw0;
        const rawId = Number(raw1?.id || raw1?.SNG_ID);
        const payload =
          Number.isFinite(rawId) && rawId > 0
            ? raw1
            : {
                id: trackId,
                title: String(state.track.title || ""),
                duration: Number(state.track.duration) || 0,
                artist: { name: String(state.track.artist || "") },
                ...(state.track.cover
                  ? { album: { cover_small: String(state.track.cover), cover_medium: String(state.track.cover), cover: String(state.track.cover) } }
                  : {}),
              };
        const ok = lib.addSavedTrack(payload);
        if (!ok) throw new Error("save_failed");
      } else {
        const ok = lib.removeSavedTrack(trackId);
        if (!ok) throw new Error("unsave_failed");
      }

      if (nextLiked && window.dl?.downloadTrack) {
        const quality = getDownloadQualityRaw();
        rememberDownloadMeta(state.track);
        const uuid = `dl_${trackId}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
        try {
          lib.upsertDownloadedTrack?.({
            track: state.track.raw || state.track,
            fileUrl: "",
            downloadPath: "",
            quality,
            uuid,
          });
        } catch {}
        const trackPayload = state.track?.raw && typeof state.track.raw === "object" ? state.track.raw : state.track;
        const albumPayload =
          trackPayload?.album && typeof trackPayload.album === "object"
            ? trackPayload.album
            : state.track?.album && typeof state.track.album === "object"
              ? state.track.album
              : null;
        void window.dl.downloadTrack({ id: trackId, quality, uuid, track: trackPayload, album: albumPayload });
      }
    } catch {
      state.liked = !nextLiked;
      setLikeIcon(state.liked);
    }
  };

  return { refreshLikeStatus, toggleLike };
}
