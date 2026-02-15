import { parseTarget } from "../deezerImages.js";
import { getDownloadQualityRaw } from "../settings.js";

import { buildItem, hideMenu } from "./menuDom.js";
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

  const getPlaylistDownloadedState = async (playlistId) => {
    const idNum = Number(playlistId);
    if (!Number.isFinite(idNum) || idNum <= 0) return { remaining: 0, confidentEmpty: false };

    let tracklistCount = null;
    let tracklistTotal = 0;
    try {
      if (window.dl?.getOfflineTracklist) {
        const r = await window.dl.getOfflineTracklist({ type: "playlist", id: String(idNum) });
        const tracks = Array.isArray(r?.data?.tracks) ? r.data.tracks : [];
        tracklistTotal = tracks.length;
        let count = 0;
        for (const t of tracks) {
          if (t && !t.__missing) count += 1;
        }
        tracklistCount = count;
        if (count > 0) return { remaining: count, confidentEmpty: true };
      }
    } catch {}

    let playlistRowFound = false;
    let listPlaylistsCount = null;
    if (window.dl?.listPlaylists) {
      try {
        const res = await window.dl.listPlaylists();
        const rows = Array.isArray(res?.playlists) ? res.playlists : [];
        for (const row of rows) {
          if (Number(row?.playlistId || row?.id) !== idNum) continue;
          playlistRowFound = true;
          const dl = Number(row?.downloaded);
          if (Number.isFinite(dl) && dl >= 0) listPlaylistsCount = dl;
          if (Number.isFinite(dl) && dl > 0) return { remaining: dl, confidentEmpty: true };
          break;
        }
      } catch {}
    }

    if (window.dl?.listDownloads) {
      try {
        const res = await window.dl.listDownloads();
        const rows = Array.isArray(res?.tracks) ? res.tracks : [];
        let count = 0;
        for (const row of rows) {
          const uuid = String(row?.uuid || "");
          const fileUrl = String(row?.fileUrl || "").trim();
          if (!fileUrl) continue;
          if (uuid.startsWith(`playlist_${idNum}_track_`)) count += 1;
        }
        if (count > 0) return { remaining: count, confidentEmpty: true };
      } catch {}
    }

    const confidentEmpty =
      tracklistCount === 0 &&
      tracklistTotal > 0 &&
      playlistRowFound &&
      Number.isFinite(listPlaylistsCount) &&
      listPlaylistsCount === 0;
    return { remaining: 0, confidentEmpty };
  };

  const countDownloadedForPlaylist = async (playlistId) => {
    const state = await getPlaylistDownloadedState(playlistId);
    return state.remaining;
  };

  const reconcileSavedEntitiesAfterTrackDelete = async ({ albumId, playlistIds }) => {
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
      const playlistState = await getPlaylistDownloadedState(pid);
      if (playlistState.remaining > 0 || !playlistState.confidentEmpty) continue;
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

    // "Add to playlist" submenu
    items.push({
      label: "Add to playlist",
      icon: "ri-play-list-add-line",
      submenu: true,
      buildSubmenu: (subPanel, menuRoot) => {
        const customPlaylists = lib.listCustomPlaylists?.() || [];
        const folders = lib.listFolders?.() || [];

        // Build folder → custom playlist mapping (only folders containing custom playlists)
        const folderChildPlaylists = new Map();
        const playlistIdsInFolders = new Set();
        for (const f of folders) {
          const children = Array.isArray(f.children) ? f.children : [];
          const cpChildren = [];
          for (const c of children) {
            if (c.type === "customPlaylist" && c.id) {
              const cp = customPlaylists.find((p) => String(p.id) === String(c.id));
              if (cp) { cpChildren.push(cp); playlistIdsInFolders.add(String(cp.id)); }
            }
          }
          if (cpChildren.length > 0) folderChildPlaylists.set(f, cpChildren);
        }
        // Top-level playlists = those not inside any folder
        const topLevelPlaylists = customPlaylists.filter((p) => !playlistIdsInFolders.has(String(p.id)));

        // Search input
        const searchWrap = document.createElement("div");
        searchWrap.className = "context-menu__sub-search";
        searchWrap.innerHTML = '<i class="ri-search-line context-menu__sub-search-icon" aria-hidden="true"></i>';
        const searchInput = document.createElement("input");
        searchInput.type = "text";
        searchInput.placeholder = "Find a playlist";
        searchInput.className = "context-menu__sub-search-input";
        searchInput.dataset.dbg = "submenu-playlist-search";
        searchInput.dataset.dbgType = "input";
        searchWrap.appendChild(searchInput);
        subPanel.appendChild(searchWrap);

        // New playlist option
        const newBtn = document.createElement("button");
        newBtn.type = "button";
        newBtn.className = "context-menu__item";
        newBtn.dataset.dbg = "ctx-new-playlist";
        newBtn.dataset.dbgType = "context-menu-item";
        newBtn.dataset.dbgDesc = "Create new playlist and add track";
        newBtn.innerHTML = `
          <span class="context-menu__icon"><i class="ri-add-line" aria-hidden="true"></i></span>
          <span class="context-menu__label">New playlist</span>
        `;
        newBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const p = lib.createCustomPlaylist?.();
          if (p) lib.addTrackToCustomPlaylist?.(p.id, t);
          hideMenu(menuRoot);
        });
        subPanel.appendChild(newBtn);

        // New Folder option with nested submenu
        const newFolderWrap = document.createElement("div");
        newFolderWrap.className = "context-menu__folder-submenu-wrap";
        const newFolderBtn = document.createElement("button");
        newFolderBtn.type = "button";
        newFolderBtn.className = "context-menu__item context-menu__item--submenu";
        newFolderBtn.dataset.dbg = "ctx-new-folder";
        newFolderBtn.dataset.dbgType = "context-menu-item";
        newFolderBtn.innerHTML = `
          <span class="context-menu__icon"><i class="ri-folder-add-line" aria-hidden="true"></i></span>
          <span class="context-menu__label">New Folder</span>
          <span class="context-menu__right"><i class="ri-arrow-right-s-line" aria-hidden="true"></i></span>
        `;
        const newFolderSub = document.createElement("div");
        newFolderSub.className = "context-menu__folder-subpanel";
        newFolderSub.hidden = true;
        let newFolderBuilt = false;
        const buildNewFolderSub = () => {
          if (newFolderBuilt) return;
          newFolderBuilt = true;
          // Create folder and add a new playlist inside it
          const createAndAddBtn = document.createElement("button");
          createAndAddBtn.type = "button";
          createAndAddBtn.className = "context-menu__item";
          createAndAddBtn.innerHTML = `
            <span class="context-menu__icon"><i class="ri-folder-add-line" aria-hidden="true"></i></span>
            <span class="context-menu__label">Create folder</span>
          `;
          createAndAddBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const f = lib.createFolder?.();
            if (f) {
              const p = lib.createCustomPlaylist?.();
              if (p) {
                lib.addTrackToCustomPlaylist?.(p.id, t);
                lib.addChildToFolder?.(f.id, { type: "customPlaylist", id: p.id });
              }
            }
            hideMenu(menuRoot);
          });
          newFolderSub.appendChild(createAndAddBtn);
          // Add to existing folders
          for (const f of folders) {
            const row = document.createElement("button");
            row.type = "button";
            row.className = "context-menu__item";
            row.innerHTML = `
              <span class="context-menu__icon"><i class="ri-folder-3-fill" aria-hidden="true"></i></span>
              <span class="context-menu__label">${String(f.title || "Untitled")}</span>
            `;
            row.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const p = lib.createCustomPlaylist?.();
              if (p) {
                lib.addTrackToCustomPlaylist?.(p.id, t);
                lib.addChildToFolder?.(f.id, { type: "customPlaylist", id: p.id });
              }
              hideMenu(menuRoot);
            });
            newFolderSub.appendChild(row);
          }
        };
        let nfHoverTimer = 0, nfLeaveTimer = 0;
        const nfClearTimers = () => { clearTimeout(nfHoverTimer); clearTimeout(nfLeaveTimer); };
        newFolderWrap.addEventListener("mouseenter", () => {
          nfClearTimers();
          nfHoverTimer = setTimeout(() => { buildNewFolderSub(); newFolderSub.hidden = false; }, 80);
        });
        newFolderWrap.addEventListener("mouseleave", () => {
          nfClearTimers();
          nfLeaveTimer = setTimeout(() => { newFolderSub.hidden = true; }, 200);
        });
        newFolderSub.addEventListener("mouseenter", () => { nfClearTimers(); });
        newFolderSub.addEventListener("mouseleave", () => {
          nfClearTimers();
          nfLeaveTimer = setTimeout(() => { newFolderSub.hidden = true; }, 200);
        });
        newFolderWrap.appendChild(newFolderBtn);
        newFolderWrap.appendChild(newFolderSub);
        subPanel.appendChild(newFolderWrap);

        // Separator
        const sep = document.createElement("div");
        sep.className = "context-menu__sub-sep";
        subPanel.appendChild(sep);

        // Playlist & folder list (max 5 items visible, fixed height)
        const listContainer = document.createElement("div");
        listContainer.className = "context-menu__sub-list";

        const buildPlaylistRow = (p) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "context-menu__item";
          row.dataset.dbg = "ctx-add-to-playlist";
          row.dataset.dbgType = "context-menu-item";
          row.dataset.dbgId = String(p.id);
          row.dataset.dbgDesc = String(p.title || "");
          row.innerHTML = `
            <span class="context-menu__icon"><i class="ri-music-2-fill" aria-hidden="true"></i></span>
            <span class="context-menu__label">${String(p.title || "Untitled")}</span>
          `;
          row.addEventListener("click", (e2) => {
            e2.preventDefault();
            e2.stopPropagation();
            lib.addTrackToCustomPlaylist?.(p.id, t);
            hideMenu(menuRoot);
          });
          return row;
        };

        const buildFolderRow = (folder, childPlaylists) => {
          const wrap = document.createElement("div");
          wrap.className = "context-menu__folder-submenu-wrap";
          const row = document.createElement("button");
          row.type = "button";
          row.className = "context-menu__item context-menu__item--submenu";
          row.dataset.dbg = "ctx-folder-playlist";
          row.dataset.dbgId = String(folder.id);
          row.innerHTML = `
            <span class="context-menu__icon"><i class="ri-folder-3-fill" aria-hidden="true"></i></span>
            <span class="context-menu__label">${String(folder.title || "Untitled")}</span>
            <span class="context-menu__right"><i class="ri-arrow-right-s-line" aria-hidden="true"></i></span>
          `;
          const folderSub = document.createElement("div");
          folderSub.className = "context-menu__folder-subpanel";
          folderSub.hidden = true;
          let folderBuilt = false;
          const buildFolderContent = () => {
            if (folderBuilt) return;
            folderBuilt = true;
            // Search inside folder only if >5 items
            let folderSearchInput = null;
            if (childPlaylists.length > 5) {
              const fSearchWrap = document.createElement("div");
              fSearchWrap.className = "context-menu__sub-search";
              fSearchWrap.innerHTML = '<i class="ri-search-line context-menu__sub-search-icon" aria-hidden="true"></i>';
              folderSearchInput = document.createElement("input");
              folderSearchInput.type = "text";
              folderSearchInput.placeholder = "Find a playlist";
              folderSearchInput.className = "context-menu__sub-search-input";
              fSearchWrap.appendChild(folderSearchInput);
              folderSub.appendChild(fSearchWrap);
            }
            const folderList = document.createElement("div");
            folderList.style.maxHeight = "220px";
            folderList.style.overflowY = "auto";
            const renderFolderList = (filter) => {
              folderList.innerHTML = "";
              const needle = String(filter || "").trim().toLowerCase();
              const filtered = needle
                ? childPlaylists.filter((p) => String(p.title || "").toLowerCase().includes(needle))
                : childPlaylists;
              const visible = filtered.slice(0, 5);
              for (const cp of visible) {
                folderList.appendChild(buildPlaylistRow(cp));
              }
              if (visible.length === 0 && needle) {
                const empty = document.createElement("div");
                empty.className = "context-menu__sub-empty";
                empty.textContent = "No playlists found";
                folderList.appendChild(empty);
              }
            };
            renderFolderList("");
            folderSub.appendChild(folderList);
            if (folderSearchInput) {
              folderSearchInput.addEventListener("input", () => renderFolderList(folderSearchInput.value));
            }
          };
          let fHoverTimer = 0, fLeaveTimer = 0;
          const fClearTimers = () => { clearTimeout(fHoverTimer); clearTimeout(fLeaveTimer); };
          wrap.addEventListener("mouseenter", () => {
            fClearTimers();
            fHoverTimer = setTimeout(() => { buildFolderContent(); folderSub.hidden = false; }, 80);
          });
          wrap.addEventListener("mouseleave", () => {
            fClearTimers();
            fLeaveTimer = setTimeout(() => { folderSub.hidden = true; }, 200);
          });
          folderSub.addEventListener("mouseenter", () => { fClearTimers(); });
          folderSub.addEventListener("mouseleave", () => {
            fClearTimers();
            fLeaveTimer = setTimeout(() => { folderSub.hidden = true; }, 200);
          });
          wrap.appendChild(row);
          wrap.appendChild(folderSub);
          return wrap;
        };

        const renderList = (filter) => {
          listContainer.innerHTML = "";
          const needle = String(filter || "").trim().toLowerCase();

          // Build combined list: top-level playlists + folders with custom playlists
          const entries = [];
          for (const p of topLevelPlaylists) {
            entries.push({ kind: "playlist", playlist: p, title: String(p.title || "") });
          }
          for (const [f, cps] of folderChildPlaylists) {
            entries.push({ kind: "folder", folder: f, children: cps, title: String(f.title || "") });
          }

          const filtered = needle
            ? entries.filter((e) => {
                if (e.kind === "playlist") return e.title.toLowerCase().includes(needle);
                // For folders, match folder title or any child playlist title
                if (e.title.toLowerCase().includes(needle)) return true;
                return e.children.some((cp) => String(cp.title || "").toLowerCase().includes(needle));
              })
            : entries;

          const visible = filtered.slice(0, 5);
          for (const entry of visible) {
            if (entry.kind === "playlist") {
              listContainer.appendChild(buildPlaylistRow(entry.playlist));
            } else {
              listContainer.appendChild(buildFolderRow(entry.folder, entry.children));
            }
          }
          if (visible.length === 0 && needle) {
            const empty = document.createElement("div");
            empty.className = "context-menu__sub-empty";
            empty.textContent = "No playlists found";
            listContainer.appendChild(empty);
          }
        };
        renderList("");
        subPanel.appendChild(listContainer);

        searchInput.addEventListener("input", () => renderList(searchInput.value));
        requestAnimationFrame(() => searchInput.focus());
      },
    });

    // "Remove from this playlist" when viewing a custom playlist
    const pageContext = resolvePageContext();
    if (pageContext?.type === "customPlaylist" && pageContext?.id) {
      const cpId = pageContext.id;
      items.push(
        buildItem({
          label: "Remove from this playlist",
          icon: "ri-indeterminate-circle-line",
          danger: true,
          onClick: () => {
            lib.removeTrackFromCustomPlaylist?.(cpId, trackId);
            // Live-refresh the page
            try {
              window.__spotifyNav?.navigate?.({ name: "customPlaylist", id: cpId, refresh: true }, { replace: true });
            } catch {}
          },
        }),
      );
    }

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

    const isInsideCustomPlaylist = pageContext?.type === "customPlaylist" && pageContext?.id;
    if (isDownloadedAny && !isInsideCustomPlaylist) {
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Delete download",
          icon: "ri-delete-bin-6-line",
          danger: true,
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
              // Also include the current page's entity if it's a playlist/album,
              // so reconciliation checks it even when the track's uuid doesn't
              // contain a playlist prefix (e.g. "dl_*" standalone downloads).
              try {
                const route = window.__navRoute && typeof window.__navRoute === "object" ? window.__navRoute : null;
                if (String(route?.name || "") === "entity") {
                  const routeType = String(route?.entityType || "");
                  const routeId = Number(route?.id);
                  if (routeType === "playlist" && Number.isFinite(routeId) && routeId > 0) out.add(routeId);
                }
              } catch {};
              return Array.from(out);
            })();

            const ok = await window.dl.deleteFromDisk({ id: trackId });
            try {
              await window.dl?.scanLibrary?.();
            } catch {}
            // Only remove from localStorage if the track is truly gone from the
            // main process — playlist mirrors may have survived the deletion.
            let trackStillExists = false;
            if (window.dl?.resolveTrack) {
              try {
                const r = await window.dl.resolveTrack({ id: trackId });
                trackStillExists = Boolean(r?.ok && r?.exists && r?.fileUrl);
              } catch {}
            }
            if (!trackStillExists) {
              try {
                lib.removeDownloadedTrack?.(trackId);
              } catch {}
            }
            try {
              await reconcileSavedEntitiesAfterTrackDelete({
                albumId: reconcileAlbumId,
                playlistIds,
              });
            } catch {}
            try {
              window.__downloadsUI?.removeTrack?.(trackId);
            } catch {}
            refreshDownloadsIfVisible();
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

    const contextName = typeof context === "object" ? context?.type : context;
    if (contextName === "liked" || contextName === "downloads" || contextName === "playlist" || contextName === "album" || contextName === "customPlaylist") {
      const canSelectMultiple = contextName === "playlist" || contextName === "album" ? isDownloadedAny : true;
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

      if (asEntityType === "album") {
        let albumArtistId = null;
        if (window.dl?.getOfflineTracklist) {
          try {
            const r = await window.dl.getOfflineTracklist({ type: "album", id: String(asEntityId) });
            const data = r?.data && typeof r.data === "object" ? r.data : null;
            const n = Number(data?.artist?.id || data?.artist?.ART_ID || data?.ART_ID || 0);
            if (Number.isFinite(n) && n > 0) albumArtistId = n;
          } catch {}
        }
        if (!albumArtistId && window.dz?.getTracklist && typeof window.dz.getTracklist === "function") {
          try {
            const res = await window.dz.getTracklist({ type: "album", id: asEntityId });
            const data = res?.data && typeof res.data === "object" ? res.data : null;
            const n = Number(data?.artist?.id || data?.artist?.ART_ID || data?.ART_ID || 0);
            if (Number.isFinite(n) && n > 0) albumArtistId = n;
          } catch {}
        }
        if (albumArtistId) {
          items.push(
            buildItem({
              label: "Go to artist",
              icon: "ri-user-3-line",
              onClick: async () => {
                window.__spotifyNav?.navigate?.({ name: "entity", entityType: "artist", id: String(albumArtistId), scrollTop: 0 });
              },
            }),
          );
        }
      }

      if (asEntityType === "album" || asEntityType === "playlist") {
        const rootEl = card && card.nodeType === 1 ? card : null;
        const metaTitle = String(rootEl?.querySelector?.(".big-card__title, .library-item__title")?.textContent || "").trim();
        const metaSubtitle = String(rootEl?.querySelector?.(".big-card__subtitle, .library-item__subtitle")?.textContent || "").trim();
        const metaCover = String(rootEl?.querySelector?.(".big-card__cover img, img.cover--img")?.getAttribute?.("src") || "").trim();
        const idNum = Number(asEntityId);
        const getDownloadedCount = async () => {
          if (!Number.isFinite(idNum) || idNum <= 0) return 0;
          if (asEntityType === "album") return countDownloadedForAlbum(idNum);
          if (asEntityType === "playlist") return countDownloadedForPlaylist(idNum);
          return 0;
        };

        const dlCount = await getDownloadedCount();

        if (dlCount > 0) {
          items.push({ kind: "sep" });
          const deleteLabel = `Delete from library`;
          items.push(
            buildItem({
              label: deleteLabel,
              icon: "ri-delete-bin-6-line",
              danger: true,
              onClick: async () => {
                const affectedPlaylistIds = new Set();
                // Collect track IDs that belong to this entity BEFORE deletion
                // so we can clean up localStorage afterwards.
                const preDeleteTrackIds = new Set();
                try {
                  if (asEntityType === "album") {
                    // Before deleting, find playlists that contain tracks from this album
                    const st = lib.load?.() || {};
                    const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
                    for (const [tid, row] of Object.entries(downloaded)) {
                      const entry = row && typeof row === "object" ? row : null;
                      if (!entry) continue;
                      if (Number(entry?.albumId) !== idNum) continue;
                      preDeleteTrackIds.add(Number(tid));
                      const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
                      const m = uuid.match(/^playlist_(\d+)_track_/);
                      if (m) { const pid = Number(m[1]); if (Number.isFinite(pid) && pid > 0) affectedPlaylistIds.add(pid); }
                    }
                  } else if (asEntityType === "playlist") {
                    // Use the offline tracklist (main process) to get the full list of
                    // tracks in this playlist before we delete anything.
                    if (window.dl?.getOfflineTracklist) {
                      try {
                        const r = await window.dl.getOfflineTracklist({ type: "playlist", id: String(idNum) });
                        const tracks = Array.isArray(r?.data?.tracks) ? r.data.tracks : [];
                        for (const t of tracks) {
                          const tid = Number(t?.id || t?.SNG_ID);
                          if (Number.isFinite(tid) && tid > 0) preDeleteTrackIds.add(tid);
                        }
                      } catch {}
                    }
                    // Also collect from localStorage in case offline tracklist is incomplete
                    const st = lib.load?.() || {};
                    const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
                    for (const [tid, row] of Object.entries(downloaded)) {
                      const entry = row && typeof row === "object" ? row : null;
                      if (!entry) continue;
                      const uuid = entry?.download?.uuid ? String(entry.download.uuid) : "";
                      if (uuid.startsWith(`playlist_${idNum}_track_`)) preDeleteTrackIds.add(Number(tid));
                    }
                  }
                } catch {}
                try {
                  if (asEntityType === "album" && window.dl?.deleteAlbumFromDisk) {
                    await window.dl.deleteAlbumFromDisk({ id: idNum });
                  } else if (asEntityType === "playlist" && window.dl?.deletePlaylistFromDisk) {
                    await window.dl.deletePlaylistFromDisk({ id: idNum });
                  }
                  try { await window.dl?.scanLibrary?.(); } catch {}
                } catch {}
                // Remove all tracks that belonged to this entity from localStorage.
                // For playlists we use the pre-collected set (covers all uuid formats).
                // For albums, only remove tracks that are truly gone from the main
                // process — playlist mirrors may have survived deleteAlbumFromDisk.
                try {
                  const st = lib.load?.() || {};
                  const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
                  for (const [tid, row] of Object.entries(downloaded)) {
                    const entry = row && typeof row === "object" ? row : null;
                    if (!entry) continue;
                    const tidNum = Number(tid);
                    if (asEntityType === "album" && Number(entry?.albumId) === idNum) {
                      // Check if the track still has a valid audio file (e.g. playlist mirror survived).
                      let stillExists = false;
                      if (window.dl?.resolveTrack) {
                        try {
                          const r = await window.dl.resolveTrack({ id: tidNum });
                          stillExists = Boolean(r?.ok && r?.exists && r?.fileUrl);
                        } catch {}
                      }
                      if (!stillExists) {
                        try { lib.removeDownloadedTrack?.(tidNum); } catch {}
                      }
                    } else if (asEntityType === "playlist" && preDeleteTrackIds.has(tidNum)) {
                      try { lib.removeDownloadedTrack?.(tidNum); } catch {}
                    }
                  }
                  // For playlist deletion, also remove any tracks from the pre-collected
                  // set that may have already been removed from downloadedTracks.
                  if (asEntityType === "playlist") {
                    for (const tid of preDeleteTrackIds) {
                      try { lib.removeDownloadedTrack?.(tid); } catch {}
                    }
                  }
                } catch {}
                // Explicitly remove the deleted entity from Your Library
                try {
                  if (asEntityType === "album") {
                    if (lib.isAlbumSaved?.(idNum)) lib.removeSavedAlbum?.(idNum);
                  } else if (asEntityType === "playlist") {
                    if (lib.isPlaylistSaved?.(idNum)) lib.removeSavedPlaylist?.(idNum);
                  }
                } catch {}
                // When deleting an album, reconcile any playlists that had tracks from it
                if (asEntityType === "album" && affectedPlaylistIds.size > 0) {
                  for (const pid of affectedPlaylistIds) {
                    try {
                      const playlistState = await getPlaylistDownloadedState(pid);
                      if (playlistState.remaining > 0 || !playlistState.confidentEmpty) continue;
                      if (lib.isPlaylistSaved?.(pid)) lib.removeSavedPlaylist?.(pid);
                    } catch {}
                  }
                }
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

  const countDownloadedForCustomPlaylist = (playlistId) => {
    try {
      const playlist = lib.getCustomPlaylist?.(playlistId);
      if (!playlist) return 0;
      const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
      const st = lib.load?.() || {};
      const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
      let count = 0;
      for (const tid of trackIds) {
        const entry = downloaded[String(tid)];
        if (entry && typeof entry === "object" && entry.download?.fileUrl) count++;
      }
      return count;
    } catch {
      return 0;
    }
  };

  const buildCustomPlaylistSidebarMenu = ({ customPlaylistId }) => {
    const id = String(customPlaylistId || "");
    if (!id) return [];
    const playlist = lib.getCustomPlaylist?.(id);
    if (!playlist) return [];

    const items = [];

    items.push(
      buildItem({
        label: "Play",
        icon: "ri-play-fill",
        onClick: () => {
          if (!window.__player) return;
          const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
          const tracksMap = playlist.tracks && typeof playlist.tracks === "object" ? playlist.tracks : {};
          const tracks = [];
          for (const tid of trackIds) {
            const t = tracksMap[String(tid)];
            if (!t) continue;
            tracks.push({
              id: tid,
              title: String(t.title || ""),
              artist: { name: String(t.artist || ""), id: null },
              album: { id: t.albumId || null, title: String(t.albumTitle || ""), cover_medium: String(t.albumCover || ""), cover: String(t.albumCover || "") },
              duration: Number(t.duration) || 0,
              cover: String(t.albumCover || ""),
            });
          }
          if (tracks.length > 0) {
            lib.markCustomPlaylistPlayed?.(id);
            void window.__player.setQueueAndPlay(tracks, 0, { context: { type: "customPlaylist", id, title: playlist.title } });
          }
        },
      }),
    );

    // Delete downloaded tracks option
    const dlCount = countDownloadedForCustomPlaylist(id);
    if (dlCount > 0) {
      items.push({ kind: "sep" });
      items.push(
        buildItem({
          label: "Delete from library",
          icon: "ri-delete-bin-6-line",
          danger: true,
          onClick: async () => {
            const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
            const preDeleteTrackIds = new Set();
            
            // Collect downloaded track IDs
            try {
              const st = lib.load?.() || {};
              const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
              for (const tid of trackIds) {
                const entry = downloaded[String(tid)];
                if (entry && typeof entry === "object" && entry.download?.fileUrl) {
                  preDeleteTrackIds.add(Number(tid));
                }
              }
            } catch {}
            
            // Delete tracks from disk
            for (const tid of preDeleteTrackIds) {
              try {
                if (window.dl?.deleteFromDisk) {
                  await window.dl.deleteFromDisk({ id: tid });
                }
              } catch {}
            }
            
            // Scan library
            try {
              await window.dl?.scanLibrary?.();
            } catch {}
            
            // Remove from localStorage
            for (const tid of preDeleteTrackIds) {
              try {
                lib.removeDownloadedTrack?.(tid);
              } catch {}
            }
            
            refreshDownloadsIfVisible();
          },
        }),
      );
    }

    // Download option
    items.push({ kind: "sep" });
    items.push(
      buildItem({
        label: "Download",
        icon: "ri-download-2-line",
        onClick: async () => {
          if (!window.dl?.downloadTrack) return;
          const quality = getDownloadQualityRaw();
          const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
          const st = lib.load?.() || {};
          const downloaded = st.downloadedTracks && typeof st.downloadedTracks === "object" ? st.downloadedTracks : {};
          
          // Download undownloaded tracks
          for (const tid of trackIds) {
            const entry = downloaded[String(tid)];
            const isDownloaded = entry && typeof entry === "object" && entry.download?.fileUrl;
            if (!isDownloaded) {
              try {
                const qualitySuffix = quality === "flac" ? 9 : quality === "mp3_320" ? 3 : 1;
                const uuid = `customPlaylist_${id}_track_${tid}_${qualitySuffix}`;
                const res = window.dl.downloadTrack({ id: tid, quality, uuid });
                if (res && typeof res.then === "function") res.catch(() => {});
              } catch {}
            }
          }
        },
      }),
    );

    items.push({ kind: "sep" });

    items.push(
      buildItem({
        label: "Delete playlist",
        icon: "ri-delete-bin-6-line",
        danger: true,
        onClick: () => {
          lib.deleteCustomPlaylist?.(id);
          window.__spotifyNav?.navigate?.({ name: "home" });
        },
      }),
    );

    return items;
  };

  const buildFolderSidebarMenu = ({ folderId }) => {
    const id = String(folderId || "");
    if (!id) return [];
    const folder = lib.getFolder?.(id);
    if (!folder) return [];

    const items = [];

    items.push(
      buildItem({
        label: "Play all",
        icon: "ri-play-fill",
        onClick: async () => {
          if (!window.__player) return;
          const children = Array.isArray(folder.children) ? folder.children : [];
          const tracks = [];
          for (const child of children) {
            if (child.type === "customPlaylist") {
              const cp = lib.getCustomPlaylist?.(child.id);
              if (!cp) continue;
              const tids = Array.isArray(cp.trackIds) ? cp.trackIds : [];
              const map = cp.tracks && typeof cp.tracks === "object" ? cp.tracks : {};
              for (const tid of tids) {
                const t = map[String(tid)];
                if (!t) continue;
                tracks.push({
                  id: tid,
                  title: String(t.title || ""),
                  artist: { name: String(t.artist || ""), id: null },
                  album: { id: t.albumId || null, title: String(t.albumTitle || ""), cover_medium: String(t.albumCover || ""), cover: String(t.albumCover || "") },
                  duration: Number(t.duration) || 0,
                  cover: String(t.albumCover || ""),
                });
              }
            }
          }
          if (tracks.length > 0) {
            lib.markFolderPlayed?.(id);
            void window.__player.setQueueAndPlay(tracks, 0, { context: { type: "folder", id, title: folder.title } });
          }
        },
      }),
    );

    items.push({ kind: "sep" });

    items.push(
      buildItem({
        label: "Delete folder",
        icon: "ri-delete-bin-6-line",
        danger: true,
        onClick: () => {
          lib.deleteFolder?.(id);
          window.__spotifyNav?.navigate?.({ name: "home" });
        },
      }),
    );

    return items;
  };

  return { buildTrackMenu, buildCardMenu, buildCustomPlaylistSidebarMenu, buildFolderSidebarMenu };
}
