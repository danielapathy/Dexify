import { getLocalLibrary } from "./localLibrary.js";

function toNumId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstCoverFromTrackJson(trackJson) {
  const t = trackJson && typeof trackJson === "object" ? trackJson : null;
  if (!t) return "";
  const alb = t?.album && typeof t.album === "object" ? t.album : null;
  return String(alb?.cover_medium || alb?.cover_small || alb?.cover || t?.cover || "").trim();
}

export function wireLibraryHealthCheck() {
  const lib = getLocalLibrary();

  const run = async () => {
    // 1) Heal missing download cover files on disk (main process).
    try {
      await window.dl?.healLibrary?.({ max: 80 });
    } catch {}

    // 2) Build a map of cover URLs from the downloads DB so localStorage (recents/likes)
    // can always display album art even if the original track payload was missing covers.
    let downloadRows = [];
    try {
      const res = await window.dl?.listDownloads?.();
      downloadRows = Array.isArray(res?.tracks) ? res.tracks : [];
    } catch {
      downloadRows = [];
    }

    const coverByTrackId = new Map();
    const coverByAlbumId = new Map();
    for (const row of downloadRows) {
      const tid = toNumId(row?.trackId || row?.track?.id);
      const aid = toNumId(row?.album?.id || row?.track?.album?.id || row?.track?.ALB_ID || row?.track?.data?.ALB_ID);
      const cover = String(row?.coverUrl || row?.album?.cover_medium || row?.album?.cover || "").trim();
      if (tid && cover) coverByTrackId.set(tid, cover);
      if (aid && cover && !coverByAlbumId.has(aid)) coverByAlbumId.set(aid, cover);
    }

    // 3) Patch local library state (recents/downloaded/saved) when artwork is missing.
    // This is intentionally conservative: only fills blanks, never overwrites existing art.
    const changed = lib.mutate((state, { markDirty }) => {
      const saved = state.savedTracks && typeof state.savedTracks === "object" ? state.savedTracks : {};
      const downloaded = state.downloadedTracks && typeof state.downloadedTracks === "object" ? state.downloadedTracks : {};
      const savedAlbums = state.savedAlbums && typeof state.savedAlbums === "object" ? state.savedAlbums : {};
      const recentTracks = Array.isArray(state.recentTracks) ? state.recentTracks : [];

      for (const item of Object.values(saved)) {
        if (!item || typeof item !== "object") continue;
        const has = String(item.albumCover || "").trim();
        if (has) continue;
        const tid = toNumId(item.id);
        const aid = toNumId(item.albumId);
        const cover = (tid && coverByTrackId.get(tid)) || (aid && coverByAlbumId.get(aid)) || "";
        if (cover) {
          item.albumCover = cover;
          markDirty();
        }
      }

      for (const item of Object.values(savedAlbums)) {
        if (!item || typeof item !== "object") continue;
        const has = String(item.cover || "").trim();
        if (has) continue;
        const aid = toNumId(item.id);
        const cover = (aid && coverByAlbumId.get(aid)) || "";
        if (cover) {
          item.cover = cover;
          markDirty();
        }
      }

      for (const item of Object.values(downloaded)) {
        if (!item || typeof item !== "object") continue;
        const has = String(item.albumCover || "").trim();
        if (has) continue;
        const tid = toNumId(item.id);
        const aid = toNumId(item.albumId);
        const cover =
          (tid && coverByTrackId.get(tid)) ||
          (aid && coverByAlbumId.get(aid)) ||
          firstCoverFromTrackJson(item.trackJson) ||
          "";
        if (cover) {
          item.albumCover = cover;
          if (item.trackJson && typeof item.trackJson === "object") {
            item.trackJson = { ...item.trackJson };
            item.trackJson.cover = String(item.trackJson.cover || cover);
            if (item.trackJson.album && typeof item.trackJson.album === "object") {
              item.trackJson.album = { ...item.trackJson.album };
              item.trackJson.album.cover_small = String(item.trackJson.album.cover_small || cover);
              item.trackJson.album.cover_medium = String(item.trackJson.album.cover_medium || cover);
              item.trackJson.album.cover = String(item.trackJson.album.cover || cover);
            }
          }
          markDirty();
        }
      }

      for (const r of recentTracks) {
        if (!r || typeof r !== "object") continue;
        const has = String(r.albumCover || "").trim();
        if (has) continue;
        const tid = toNumId(r.id);
        const aid = toNumId(r.albumId);
        const cover =
          (tid && coverByTrackId.get(tid)) ||
          (aid && coverByAlbumId.get(aid)) ||
          firstCoverFromTrackJson(r.trackJson) ||
          "";
        if (cover) {
          r.albumCover = cover;
          if (r.trackJson && typeof r.trackJson === "object") {
            r.trackJson = { ...r.trackJson };
            r.trackJson.cover = String(r.trackJson.cover || cover);
            if (r.trackJson.album && typeof r.trackJson.album === "object") {
              r.trackJson.album = { ...r.trackJson.album };
              r.trackJson.album.cover_small = String(r.trackJson.album.cover_small || cover);
              r.trackJson.album.cover_medium = String(r.trackJson.album.cover_medium || cover);
              r.trackJson.album.cover = String(r.trackJson.album.cover || cover);
            }
          }
          markDirty();
        }
      }
    });

    return changed;
  };

  setTimeout(() => {
    void run();
  }, 900);
}
