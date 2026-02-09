import { parseTarget } from "../deezerImages.js";
import { getDownloadQualityRaw } from "../settings.js";

import { buildItem } from "./menuDom.js";
import { refreshDownloadsIfVisible, refreshLikedIfVisible, resolvePageContext } from "./pageContext.js";

import { getAlbumIdFromTrack, getArtistIdFromTrack, normalizeTrackFromAny } from "./trackResolver.js";

export function createContextMenuBuilders({ lib }) {
  const parsePlaylistIdFromUuid = (uuidRaw) => {
    const uuid = String(uuidRaw || "").trim();
    const m = uuid.match(/^playlist_(\d+)_track_/);
    const n = m ? Number(m[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const countDownloadedForAlbum = (albumId) => {
    const idNum = Number(albumId);
    if (!Number.isFinite(idNum) || idNum <= 0) return 0;
    try {
      const st = lib.load?.() || {};
      const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      let count = 0;
      for (const row of Object.values(downloaded)) {
        const entry = row && typeof row === "object" ? row : null;
        if (!entry) continue;
        const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
        if (!fileUrl) continue;
        if (Number(entry?.albumId) === idNum) count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  };

  const countDownloadedForPlaylist = (playlistId) => {
    const idNum = Number(playlistId);
    if (!Number.isFinite(idNum) || idNum <= 0) return 0;
    try {
      const st = lib.load?.() || {};
      const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      let count = 0;
      for (const row of Object.values(downloaded)) {
        const entry = row && typeof row === "object" ? row : null;
        if (!entry) continue;
        const fileUrl = entry?.download?.fileUrl ? String(entry.download.fileUrl) : "";
        if (!fileUrl) continue;
        const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
        if (uuid.startsWith(`playlist_${idNum}_track_`)) count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  };

  const reconcileSavedEntitiesAfterTrackDelete = ({ albumId, playlistIds }) => {
    const aid = Number(albumId);
    if (Number.isFinite(aid) && aid > 0) {
      const remaining = countDownloadedForAlbum(aid);
      if (remaining <= 0) {
        try {
          if (lib.isAlbumSaved?.(aid)) lib.removeSavedAlbum?.(aid);
        } catch {}
      }
    }

    const ids = Array.isArray(playlistIds) ? playlistIds : [];
    for (const pid0 of ids) {
      const pid = Number(pid0);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      const remaining = countDownloadedForPlaylist(pid);
      if (remaining > 0) continue;
      try {
        if (lib.isPlaylistSaved?.(pid)) lib.removeSavedPlaylist?.(pid);
      } catch {}
    }
  };

  const buildTrackMenu = async ({ track, context }) => {
    const t = normalizeTrackFromAny(track);
    if (!t) return [];

    const trackId = Number(t?.id || t?.SNG_ID);
    const fallbackIds = (() => {
      try {
        if (!lib?.load) return { albumId: null, artistId: null };
        const st = lib.load() || {};
        const saved = st?.savedTracks && typeof st.savedTracks === "object" ? st.savedTracks[String(trackId)] : null;
        const dl = st?.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks[String(trackId)] : null;
        const albumId0 = Number(saved?.albumId || dl?.albumId || dl?.trackJson?.album?.id || 0);
        const artistId0 = Number(saved?.artistId || dl?.artistId || dl?.trackJson?.artist?.id || 0);
        return {
          albumId: Number.isFinite(albumId0) && albumId0 > 0 ? albumId0 : null,
          artistId: Number.isFinite(artistId0) && artistId0 > 0 ? artistId0 : null,
        };
      } catch {
        return { albumId: null, artistId: null };
      }
    })();

    let albumId = getAlbumIdFromTrack(t) || fallbackIds.albumId;
    let artistId = getArtistIdFromTrack(t) || fallbackIds.artistId;

    if (!albumId && window.dz?.getTrack && typeof window.dz.getTrack === "function") {
      try {
        const res = await window.dz.getTrack({ id: trackId });
        const rawTrack = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
        const n = Number(rawTrack?.album?.id || rawTrack?.ALB_ID || rawTrack?.album_id || rawTrack?.data?.ALB_ID || 0);
        if (Number.isFinite(n) && n > 0) albumId = n;
      } catch {}
    }

    if (!artistId && window.dz?.getTrack && typeof window.dz.getTrack === "function") {
      try {
        const res = await window.dz.getTrack({ id: trackId });
        const rawTrack = res?.ok && res?.track && typeof res.track === "object" ? res.track : null;
        const n = Number(rawTrack?.artist?.id || rawTrack?.ART_ID || rawTrack?.artist_id || rawTrack?.data?.ART_ID || 0);
        if (Number.isFinite(n) && n > 0) artistId = n;
      } catch {}
    }

    // Offline fallback: if the track has an album id but no artist id (common for sparse local metadata),
    // load the offline album payload to recover the artist id without requiring auth.
    if (!artistId && albumId && window.dl?.getOfflineTracklist) {
      try {
        const r = await window.dl.getOfflineTracklist({ type: "album", id: String(albumId) });
        const data = r?.data && typeof r.data === "object" ? r.data : null;
        const n = Number(data?.artist?.id || data?.artist?.ART_ID || data?.ART_ID || 0);
        if (Number.isFinite(n) && n > 0) artistId = n;
      } catch {}
    }

    const quality = getDownloadQualityRaw();
    const resolved = window.dl?.resolveTrack ? await window.dl.resolveTrack({ id: trackId, quality }) : null;
    const gotQuality = resolved?.quality ? String(resolved.quality) : "";
    const isDownloadedAny = Boolean(resolved?.ok && resolved?.exists && resolved?.fileUrl);
    const isDownloadedPreferred = isDownloadedAny && gotQuality && String(gotQuality) === String(quality);

    const items = [];

    items.push(
      buildItem({
        label: "Add to queue",
        icon: "ri-add-line",
        onClick: async () => {
          try {
            window.__player?.enqueue?.([t]);
          } catch {}
        },
      }),
    );

    const liked = Boolean(lib.isTrackSaved?.(trackId));
    items.push(
      buildItem({
        label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: liked ? "ri-heart-fill" : "ri-heart-line",
        onClick: async () => {
          try {
            if (liked) lib.removeSavedTrack(trackId);
            else lib.addSavedTrack(t);
          } catch {}
          refreshLikedIfVisible();
        },
      }),
    );

    items.push({ kind: "sep" });

    if (albumId) {
      items.push(
        buildItem({
          label: "Go to album",
          icon: "ri-album-line",
          onClick: async () => {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "album", id: String(albumId), scrollTop: 0 });
          },
        }),
      );
    }

    if (artistId) {
      items.push(
        buildItem({
          label: "Go to artist",
          icon: "ri-user-3-line",
          onClick: async () => {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: "artist", id: String(artistId), scrollTop: 0 });
          },
        }),
      );
    }

    items.push(
      buildItem({
        label: isDownloadedPreferred ? "Downloaded" : "Download song",
        icon: "ri-download-2-line",
        disabled: isDownloadedPreferred,
        onClick: async () => {
          if (!window.dl?.downloadTrack) return;
          const uuid = `dl_${trackId}_${quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1}`;
          // Keep IPC payload small to avoid blocking the renderer on structured clone.
          // Download metadata is still recovered via `dl:event` sync and local library healing.
          const payload = { id: trackId, quality, uuid };
          try {
            const res = window.dl.downloadTrack(payload);
            if (res && typeof res.then === "function") res.catch(() => {});
          } catch {}
          refreshDownloadsIfVisible();
        },
      }),
    );

    if (context === "downloads") {
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Delete download",
          icon: "ri-delete-bin-6-line",
          danger: true,
          disabled: !isDownloadedAny,
          onClick: async () => {
            if (!window.dl?.deleteFromDisk) return;
            const pre = (() => {
              try {
                const st = lib.load?.() || {};
                const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
                return downloaded[String(trackId)] && typeof downloaded[String(trackId)] === "object" ? downloaded[String(trackId)] : null;
              } catch {
                return null;
              }
            })();
            const reconcileAlbumId = Number(pre?.albumId || albumId || 0);
            const playlistIds = (() => {
              const out = new Set();
              const pid = parsePlaylistIdFromUuid(pre?.download?.uuid);
              if (Number.isFinite(pid) && pid > 0) out.add(pid);
              return Array.from(out);
            })();

            const ok = await window.dl.deleteFromDisk({ id: trackId });
            try {
              await window.dl?.scanLibrary?.();
            } catch {}
            try {
              lib.removeDownloadedTrack?.(trackId);
            } catch {}
            try {
              reconcileSavedEntitiesAfterTrackDelete({
                albumId: reconcileAlbumId,
                playlistIds,
              });
            } catch {}
            try {
              window.__downloadsUI?.removeTrack?.(trackId);
            } catch {}
            if (!ok?.ok) refreshDownloadsIfVisible();
          },
        }),
      );
    }

    if (context === "recents") {
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Remove from Recents",
          icon: "ri-eye-off-line",
          onClick: async () => {
            try {
              lib.removeRecentTrack?.(trackId);
            } catch {}
          },
        }),
      );
    }

    if (context === "liked" || context === "downloads" || context === "playlist" || context === "album") {
      const canSelectMultiple = context === "playlist" || context === "album" ? isDownloadedAny : true;
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Select multiple",
          icon: "ri-checkbox-multiple-line",
          disabled: !canSelectMultiple,
          onClick: async () => {
            if (!canSelectMultiple) return;
            try {
              window.__trackMultiSelect?.select?.(trackId);
            } catch {}
          },
        }),
      );
    }

    return items;
  };

  const buildCardMenu = async ({ card }) => {
    const target = String(card?.dataset?.target || "");
    const entityType = String(card?.dataset?.entityType || "");
    const entityId = String(card?.dataset?.entityId || "");
    const parsed = target ? parseTarget(target) : null;
    const quality = getDownloadQualityRaw();

    const asEntityType = parsed?.kind || (entityType ? entityType : "");
    const asEntityId = parsed?.id || (entityId ? entityId : "");

    if (asEntityType === "album" || asEntityType === "playlist" || asEntityType === "artist" || asEntityType === "smarttracklist") {
      const items = [];
      const kindLabel =
        asEntityType === "artist"
          ? "artist"
          : asEntityType === "album"
            ? "album"
            : asEntityType === "playlist"
              ? "playlist"
              : "item";

      items.push(
        buildItem({
          label:
            asEntityType === "artist"
              ? "Go to artist"
              : asEntityType === "album"
                ? "Go to album"
                : asEntityType === "playlist"
                  ? "Go to playlist"
                  : `Open ${kindLabel}`,
          icon: asEntityType === "artist" ? "ri-user-3-line" : asEntityType === "album" ? "ri-album-line" : "ri-external-link-line",
          onClick: async () => {
            window.__spotifyNav?.navigate?.({ name: "entity", entityType: asEntityType, id: String(asEntityId), scrollTop: 0 });
          },
        }),
      );

      if (asEntityType === "album" || asEntityType === "playlist") {
        const rootEl = card && card.nodeType === 1 ? card : null;
        const metaTitle = String(rootEl?.querySelector?.(".big-card__title, .library-item__title")?.textContent || "").trim();
        const metaSubtitle = String(rootEl?.querySelector?.(".big-card__subtitle, .library-item__subtitle")?.textContent || "").trim();
        const metaCover = String(rootEl?.querySelector?.(".big-card__cover img, img.cover--img")?.getAttribute?.("src") || "").trim();
        const idNum = Number(asEntityId);
        const getDownloadedCount = () => {
          if (!Number.isFinite(idNum) || idNum <= 0) return 0;
          if (asEntityType === "album") return countDownloadedForAlbum(idNum);
          if (asEntityType === "playlist") return countDownloadedForPlaylist(idNum);
          return 0;
        };

        const dlCount = getDownloadedCount();

        if (dlCount > 0) {
          items.push({ kind: "sep" });
          const deleteLabel = `Delete from library`;
          items.push(
            buildItem({
              label: deleteLabel,
              icon: "ri-delete-bin-6-line",
              danger: true,
              onClick: async () => {
                try {
                  if (asEntityType === "album" && window.dl?.deleteAlbumFromDisk) {
                    await window.dl.deleteAlbumFromDisk({ id: idNum });
                  } else if (asEntityType === "playlist" && window.dl?.deletePlaylistFromDisk) {
                    await window.dl.deletePlaylistFromDisk({ id: idNum });
                  }
                  try { await window.dl?.scanLibrary?.(); } catch {}
                } catch {}
                try {
                  const st = lib.load?.() || {};
                  const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
                  for (const [tid, row] of Object.entries(downloaded)) {
                    const entry = row && typeof row === "object" ? row : null;
                    if (!entry) continue;
                    if (asEntityType === "album" && Number(entry?.albumId) === idNum) {
                      try { lib.removeDownloadedTrack?.(Number(tid)); } catch {}
                    } else if (asEntityType === "playlist") {
                      const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
                      if (uuid.startsWith(`playlist_${idNum}_track_`)) {
                        try { lib.removeDownloadedTrack?.(Number(tid)); } catch {}
                      }
                    }
                  }
                } catch {}
              },
            }),
          );
        }

        items.push({ kind: "sep" });
        items.push(
          buildItem({
            label: "Download",
            icon: "ri-download-2-line",
            onClick: async () => {
              if (!window.dl?.downloadUrl) return;
              try {
                if (Number.isFinite(idNum) && idNum > 0) {
                  if (asEntityType === "album") {
                    lib.addSavedAlbum?.({
                      id: idNum,
                      title: metaTitle,
                      cover_medium: metaCover,
                      cover: metaCover,
                    });
                  } else {
                    lib.addSavedPlaylist?.({
                      id: idNum,
                      title: metaTitle,
                      picture_medium: metaCover,
                      picture: metaCover,
                    });
                  }
                }
              } catch {}
              try {
                const res = window.dl.downloadUrl({ url: `https://www.deezer.com/${asEntityType}/${asEntityId}`, quality });
                if (res && typeof res.then === "function") res.catch(() => {});
              } catch {}
            },
          }),
        );
      }

      return items;
    }

    if (parsed?.kind === "track") {
      const id = Number(parsed.id);
      if (!Number.isFinite(id) || id <= 0) return [];
      const title = String(card.querySelector(".big-card__title")?.textContent || "").trim();
      const artist = String(card.querySelector(".big-card__subtitle")?.textContent || "").trim();
      const cover = String(card.querySelector(".big-card__cover img")?.getAttribute?.("src") || "").trim();
      const artistId = Number(card?.dataset?.artistId || 0);
      const albumId = Number(card?.dataset?.albumId || 0);
      return buildTrackMenu({
        track: {
          id,
          title,
          artist: { id: Number.isFinite(artistId) && artistId > 0 ? artistId : null, name: artist },
          album: cover
            ? { id: Number.isFinite(albumId) && albumId > 0 ? albumId : null, cover_medium: cover, cover_small: cover, cover: cover }
            : undefined,
        },
        context: resolvePageContext(),
      });
    }

    return [];
  };

  return { buildTrackMenu, buildCardMenu };
}
