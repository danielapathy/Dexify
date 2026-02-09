export function wirePlayerEventBindings({
  el,
  audio,
  state,
  formatDuration,
  updateRangeFill,
  hasAudioSrc,
  persistPlayback,
  setPlayIcon,
  emitState,
  togglePlayPause,
  playPrev,
  playNext,
  toggleLike,
}) {
  if (el.playBtn) el.playBtn.addEventListener("click", () => void togglePlayPause());
  if (el.prevBtn) el.prevBtn.addEventListener("click", () => void playPrev());
  if (el.nextBtn) el.nextBtn.addEventListener("click", () => void playNext());
  if (el.likeBtn) el.likeBtn.addEventListener("click", () => void toggleLike());

  // Volume mute toggle state
  let isMuted = false;
  let volumeBeforeMute = 78;

  const volumeWrap = el.volume?.closest?.(".volume");
  const volumeBtn = volumeWrap?.querySelector?.("button.icon-btn");
  const volumeIcon = volumeBtn?.querySelector?.("i");

  const updateVolumeIcon = () => {
    if (!volumeIcon) return;
    const vol = isMuted ? 0 : Number(el.volume?.value || 0);
    volumeIcon.classList.remove("ri-volume-up-line", "ri-volume-down-line", "ri-volume-mute-line");
    if (vol === 0 || isMuted) {
      volumeIcon.classList.add("ri-volume-mute-line");
    } else if (vol < 50) {
      volumeIcon.classList.add("ri-volume-down-line");
    } else {
      volumeIcon.classList.add("ri-volume-up-line");
    }
  };

  const setMuted = (muted) => {
    isMuted = muted;
    if (el.volume) {
      el.volume.disabled = muted;
      el.volume.classList.toggle("is-muted", muted);
    }
    if (volumeWrap) {
      volumeWrap.classList.toggle("is-muted", muted);
    }
    audio.muted = muted;
    updateVolumeIcon();
  };

  if (volumeBtn) {
    volumeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isMuted) {
        // Unmute: restore previous volume
        if (el.volume) {
          el.volume.value = String(volumeBeforeMute);
          audio.volume = Math.max(0, Math.min(1, volumeBeforeMute / 100));
          updateRangeFill(el.volume);
        }
        setMuted(false);
      } else {
        // Mute: save current volume and mute
        volumeBeforeMute = Number(el.volume?.value || 78);
        setMuted(true);
      }
    });
  }

  if (el.volume) {
    const setVol = () => {
      const v = Number(el.volume.value || 0);
      audio.volume = Math.max(0, Math.min(1, v / 100));
      updateRangeFill(el.volume);
      // If user adjusts volume slider, unmute
      if (isMuted && v > 0) {
        setMuted(false);
      }
      updateVolumeIcon();
    };
    el.volume.addEventListener("input", setVol);
    setVol();
    updateVolumeIcon();
  }

  let isSeeking = false;
  let seekEndTimer = null;

  if (el.seek) {
    const beginSeek = () => {
      isSeeking = true;
      if (seekEndTimer) {
        clearTimeout(seekEndTimer);
        seekEndTimer = null;
      }
    };
    const endSeekSoon = () => {
      if (seekEndTimer) clearTimeout(seekEndTimer);
      seekEndTimer = setTimeout(() => {
        isSeeking = false;
        seekEndTimer = null;
      }, 0);
    };

    try {
      el.seek.addEventListener("pointerdown", beginSeek);
      window.addEventListener("pointerup", endSeekSoon);
      window.addEventListener("pointercancel", endSeekSoon);
    } catch {}
    try {
      el.seek.addEventListener("mousedown", beginSeek);
      window.addEventListener("mouseup", endSeekSoon);
    } catch {}
    try {
      el.seek.addEventListener("touchstart", beginSeek, { passive: true });
      window.addEventListener("touchend", endSeekSoon, { passive: true });
      window.addEventListener("touchcancel", endSeekSoon, { passive: true });
    } catch {}
    try {
      el.seek.addEventListener("blur", endSeekSoon);
    } catch {}

    el.seek.addEventListener("input", () => {
      updateRangeFill(el.seek);
      const preview = Number(el.seek.value || 0);
      if (Number.isFinite(preview) && el.timeCur) el.timeCur.textContent = formatDuration(preview);
    });
    el.seek.addEventListener("change", () => {
      const v = Number(el.seek.value || 0);
      if (Number.isFinite(v)) {
        const max = Number(el.seek.max || 0);
        const clamped = Math.max(0, Number.isFinite(max) && max > 0 ? Math.min(v, max) : v);
        const hasSrc = hasAudioSrc();
        if (hasSrc) {
          try {
            audio.currentTime = clamped;
          } catch {}
          if (el.timeCur) el.timeCur.textContent = formatDuration(clamped);
          persistPlayback(true, clamped);
        } else {
          state.resumeFrom = Math.max(0, Math.floor(clamped));
          if (el.timeCur) el.timeCur.textContent = formatDuration(state.resumeFrom);
          persistPlayback(true, state.resumeFrom);
        }
      }
      isSeeking = false;
      if (seekEndTimer) {
        clearTimeout(seekEndTimer);
        seekEndTimer = null;
      }
    });
  }

  audio.addEventListener("timeupdate", () => {
    if (!state.track) return;
    const cur = audio.currentTime || 0;
    if (!isSeeking) {
      if (el.timeCur) el.timeCur.textContent = formatDuration(cur);
      if (el.seek) {
        el.seek.value = String(Math.floor(cur));
        updateRangeFill(el.seek);
      }
    }
    persistPlayback();
  });

  audio.addEventListener("loadedmetadata", () => {
    const total = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (el.timeTotal) el.timeTotal.textContent = formatDuration(total || (state.track?.duration || 0));
    if (el.seek) {
      el.seek.max = String(Math.max(1, Math.floor(total || state.track?.duration || 1)));
      updateRangeFill(el.seek);
    }
  });

  audio.addEventListener("ended", () => void playNext());
  audio.addEventListener("pause", () => {
    state.isPlaying = false;
    setPlayIcon(false);
    emitState();
    persistPlayback(true);
  });
  audio.addEventListener("play", () => {
    state.isPlaying = true;
    setPlayIcon(true);
    emitState();
  });

  // Album art click -> play/pause; metadata text handles navigation
  if (el.cover) {
    el.cover.style.cursor = "pointer";
    el.cover.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      // Cover click should behave like the play/pause control (title/artist handle navigation).
      try {
        void togglePlayPause();
      } catch {}
    });

    // Right-click context menu for player album art
    el.cover.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const track0 = state.track;
      if (!track0) return;
      const raw0 = track0?.raw && typeof track0.raw === "object" ? track0.raw : null;
      const trackId = Number(
        track0?.id ||
          track0?.SNG_ID ||
          raw0?.id ||
          raw0?.SNG_ID ||
          raw0?.trackId ||
          raw0?.data?.id ||
          raw0?.data?.SNG_ID ||
          0,
      );
      const track = (() => {
        if (!Number.isFinite(trackId) || trackId <= 0) return track0;
        try {
          const st = window.__localLibrary?.load?.() || {};
          const saved = st?.savedTracks && typeof st.savedTracks === "object" ? st.savedTracks[String(trackId)] : null;
          const dl = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks[String(trackId)] : null;
          const albumId = Number(saved?.albumId || dl?.albumId || dl?.trackJson?.album?.id || 0);
          const artistId = Number(saved?.artistId || dl?.artistId || dl?.trackJson?.artist?.id || 0);
          const next = { ...track0 };
          if (Number.isFinite(albumId) && albumId > 0) {
            next.albumId = Number(next.albumId || albumId);
            next.album = { ...(next.album && typeof next.album === "object" ? next.album : {}), id: albumId };
          }
          if (Number.isFinite(artistId) && artistId > 0) {
            next.artistId = Number(next.artistId || artistId);
            const artistName = String(next?.artist?.name || next?.artist || dl?.artist || saved?.artist || "").trim();
            next.artist = { ...(next.artist && typeof next.artist === "object" ? next.artist : {}), id: artistId, name: artistName };
          }
          return next;
        } catch {
          return track0;
        }
      })();
      if (typeof window.__contextMenu?.openTrackMenu === "function") {
        window.__contextMenu.openTrackMenu({ track, x: event.clientX, y: event.clientY, context: "player" });
      }
    });
  }

  // Title/artist click -> navigate to album/artist respectively
  if (el.title) {
    el.title.style.cursor = "pointer";
    el.title.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const track = state.track;
      let raw = track?.raw && typeof track.raw === "object" ? track.raw : null;
      for (let i = 0; i < 3; i++) {
        if (!raw || typeof raw !== "object") break;
        const next = raw.raw && typeof raw.raw === "object" ? raw.raw : null;
        if (!next) break;
        raw = next;
      }
      const albumId = Number(
        track?.album?.id ||
          track?.albumId ||
          track?.ALB_ID ||
          track?.album_id ||
          track?.data?.ALB_ID ||
          track?.data?.album?.id ||
          raw?.album?.id ||
          raw?.albumId ||
          raw?.album_id ||
          raw?.ALB_ID ||
          raw?.data?.ALB_ID ||
          raw?.data?.album?.id,
      );
      if (Number.isFinite(albumId) && albumId > 0) {
        window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
        return;
      }

      const trackId = Number(track?.id || track?.SNG_ID || raw?.id || raw?.SNG_ID || raw?.trackId || raw?.data?.id || raw?.data?.SNG_ID || 0);
      if (Number.isFinite(trackId) && trackId > 0) {
        try {
          const st = window.__localLibrary?.load?.() || {};
          const saved = st?.savedTracks && typeof st.savedTracks === "object" ? st.savedTracks[String(trackId)] : null;
          const dl = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks[String(trackId)] : null;
          const n = Number(saved?.albumId || dl?.albumId || dl?.trackJson?.album?.id || 0);
          if (Number.isFinite(n) && n > 0) {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(n), scrollTop: 0 });
            return;
          }
        } catch {}
      }
      if (window.dz?.getTrack && typeof window.dz.getTrack === "function" && Number.isFinite(trackId) && trackId > 0) {
        window.dz
          .getTrack({ id: trackId })
          .then((res) => {
            const t2 = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
            const n = Number(t2?.album?.id || t2?.ALB_ID || t2?.album_id || t2?.data?.ALB_ID || 0);
            if (!Number.isFinite(n) || n <= 0) return;
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(n), scrollTop: 0 });
          })
          .catch(() => {});
      }
    });
  }

  if (el.artist) {
    el.artist.style.cursor = "pointer";
    el.artist.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const track = state.track;
      let raw = track?.raw && typeof track.raw === "object" ? track.raw : null;
      for (let i = 0; i < 3; i++) {
        if (!raw || typeof raw !== "object") break;
        const next = raw.raw && typeof raw.raw === "object" ? raw.raw : null;
        if (!next) break;
        raw = next;
      }
      const trackId = Number(
        track?.id ||
          track?.SNG_ID ||
          raw?.id ||
          raw?.SNG_ID ||
          raw?.trackId ||
          raw?.data?.id ||
          raw?.data?.SNG_ID ||
          0,
      );
      const albumId = Number(
        track?.album?.id ||
          track?.albumId ||
          track?.ALB_ID ||
          track?.album_id ||
          track?.data?.ALB_ID ||
          track?.data?.album?.id ||
          raw?.album?.id ||
          raw?.albumId ||
          raw?.album_id ||
          raw?.ALB_ID ||
          raw?.data?.ALB_ID ||
          raw?.data?.album?.id ||
          0,
      );
      const artistId = Number(
        track?.artist?.id ||
          track?.artistId ||
          track?.ART_ID ||
          track?.artist_id ||
          track?.data?.ART_ID ||
          track?.data?.artist?.id ||
          raw?.artist?.id ||
          raw?.artistId ||
          raw?.artist_id ||
          raw?.ART_ID ||
          raw?.data?.ART_ID ||
          raw?.data?.artist?.id,
      );
      const cleanArtistId =
        Number.isFinite(artistId) && artistId > 0
          ? artistId
          : (() => {
              if (!Number.isFinite(trackId) || trackId <= 0) return null;
              try {
                const st = window.__localLibrary?.load?.() || {};
                const saved = st?.savedTracks && typeof st.savedTracks === "object" ? st.savedTracks[String(trackId)] : null;
                const dl = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks[String(trackId)] : null;
                const n = Number(saved?.artistId || dl?.artistId || dl?.trackJson?.artist?.id || 0);
                return Number.isFinite(n) && n > 0 ? n : null;
              } catch {
                return null;
              }
            })();

      if (cleanArtistId) {
        window.__spotifyNav?.navigate?.({ name: "entity", entityType: "artist", id: String(cleanArtistId), scrollTop: 0 });
        return;
      }

      const dzFallback = () => {
        // Last-resort: fetch track metadata (helps restored/minimal tracks that lost artistId).
        if (window.dz?.getTrack && typeof window.dz.getTrack === "function" && Number.isFinite(trackId) && trackId > 0) {
          window.dz
            .getTrack({ id: trackId })
            .then((res) => {
              const t2 = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
              const n = Number(t2?.artist?.id || t2?.ART_ID || t2?.artist_id || t2?.data?.ART_ID || 0);
              if (!Number.isFinite(n) || n <= 0) return;
              window.__spotifyNav?.navigate?.({ name: "entity", entityType: "artist", id: String(n), scrollTop: 0 });
            })
            .catch(() => {});
        }
      };

      // Offline fallback: if we can resolve the current album locally, recover artist id from it.
      if (window.dl?.getOfflineTracklist && Number.isFinite(albumId) && albumId > 0) {
        window.dl
          .getOfflineTracklist({ type: "album", id: String(albumId) })
          .then((r) => {
            const data = r?.data && typeof r.data === "object" ? r.data : null;
            const n = Number(data?.artist?.id || data?.artist?.ART_ID || data?.ART_ID || 0);
            if (Number.isFinite(n) && n > 0) {
              window.__spotifyNav?.navigate?.({ name: "entity", entityType: "artist", id: String(n), scrollTop: 0 });
              return;
            }
            dzFallback();
          })
          .catch(() => dzFallback());
        return;
      }

      dzFallback();
    });
  }
}
