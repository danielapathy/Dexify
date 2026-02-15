export async function renderFolderPage(container, route, { lib, navigate }) {
  const id = String(route?.id || "");
  if (!id || !container) return false;

  const folder = lib.getFolder(id);
  if (!folder) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "Folder not found";
    container.appendChild(empty);
    return true;
  }

  container.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "entity-header";
  header.dataset.dbg = "folder-header";
  header.dataset.dbgType = "header";
  header.dataset.dbgId = id;

  const coverEl = document.createElement("div");
  coverEl.className = "entity-cover entity-cover--placeholder";
  coverEl.style.display = "grid";
  coverEl.style.placeItems = "center";
  coverEl.style.background = "linear-gradient(135deg, rgba(112,112,112,0.9) 0%, rgba(60,60,60,0.95) 100%)";
  const folderIcon = document.createElement("i");
  folderIcon.className = "ri-folder-3-fill";
  folderIcon.setAttribute("aria-hidden", "true");
  folderIcon.style.fontSize = "48px";
  folderIcon.style.color = "rgba(255,255,255,0.7)";
  coverEl.appendChild(folderIcon);

  const meta = document.createElement("div");
  meta.className = "entity-meta";

  // Editable title
  const titleEl = document.createElement("div");
  titleEl.className = "entity-title";
  titleEl.contentEditable = "true";
  titleEl.spellcheck = false;
  titleEl.textContent = String(folder.title || "");
  titleEl.dataset.dbg = "folder-title-input";
  titleEl.dataset.dbgType = "input";
  titleEl.dataset.dbgDesc = "Editable folder title";
  titleEl.style.outline = "none";
  titleEl.style.cursor = "text";
  titleEl.style.borderBottom = "2px solid transparent";
  titleEl.addEventListener("focus", () => {
    titleEl.style.borderBottom = "2px solid rgba(255,255,255,0.3)";
  });
  titleEl.addEventListener("blur", () => {
    titleEl.style.borderBottom = "2px solid transparent";
    const newTitle = String(titleEl.textContent || "").trim();
    if (newTitle && newTitle !== folder.title) {
      lib.renameFolder(id, newTitle);
    }
  });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
  });

  const childCount = Array.isArray(folder.children) ? folder.children.length : 0;
  const sub = document.createElement("div");
  sub.className = "entity-subtitle";
  sub.textContent = `Folder • ${childCount} item${childCount !== 1 ? "s" : ""}`;

  meta.appendChild(titleEl);
  meta.appendChild(sub);

  // Play button
  const actions = document.createElement("div");
  actions.className = "entity-actions";
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "entity-action-btn is-primary";
  playBtn.setAttribute("aria-label", "Play all");
  playBtn.dataset.tooltip = "Play all";
  playBtn.dataset.dbg = "entity-action-play-all";
  playBtn.dataset.dbgType = "button";
  playBtn.dataset.dbgDesc = "Play all folder contents";
  playBtn.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';
  playBtn.addEventListener("click", async () => {
    if (!window.__player) return;
    const tracks = await collectFolderTracks(folder, lib);
    if (tracks.length === 0) return;
    lib.markFolderPlayed(id);
    void window.__player.setQueueAndPlay(tracks, 0, {
      context: { type: "folder", id, title: folder.title },
    });
  });
  actions.appendChild(playBtn);
  meta.appendChild(actions);

  header.appendChild(coverEl);
  header.appendChild(meta);
  container.appendChild(header);

  // Children list
  const children = Array.isArray(folder.children) ? folder.children : [];
  if (children.length > 0) {
    const grid = document.createElement("div");
    grid.className = "carousel";
    grid.setAttribute("role", "list");
    grid.style.padding = "16px 0";

    for (const child of children) {
      const card = document.createElement("a");
      card.className = "big-card";
      card.href = "#";
      card.setAttribute("role", "listitem");
      card.dataset.dbg = "folder-child";
      card.dataset.dbgType = "card";
      card.dataset.dbgId = String(child.id || "");

      let titleText = "";
      let subtitleText = "";
      let coverUrl = "";

      if (child.type === "customPlaylist") {
        const cp = lib.getCustomPlaylist(child.id);
        titleText = cp ? String(cp.title || "Playlist") : "Unknown Playlist";
        const trackCount = cp && Array.isArray(cp.trackIds) ? cp.trackIds.length : 0;
        subtitleText = `Playlist • ${trackCount} tracks`;
        coverUrl = cp ? String(cp.cover || "") : "";
        card.dataset.target = `customPlaylist:${child.id}`;
      } else if (child.type === "album") {
        const state = lib.load();
        const album = state.savedAlbums?.[String(child.id)];
        if (album) {
          titleText = String(album.title || "Album");
          subtitleText = String(album.artist || "Album");
          coverUrl = String(album.cover || "");
        } else {
          // Fallback: fetch metadata from offline download database
          try {
            if (window.dl?.getOfflineTracklist) {
              const r = await window.dl.getOfflineTracklist({ type: "album", id: String(child.id) });
              const data = r?.data && typeof r.data === "object" ? r.data : null;
              if (data) {
                titleText = String(data.title || data.ALB_TITLE || "Album").trim() || "Album";
                const artistName = String(data.artist?.name || data.artist?.ART_NAME || data.ART_NAME || "").trim();
                subtitleText = artistName || "Album";
                coverUrl = String(data.cover_medium || data.cover || data.picture_medium || data.picture || "").trim();
              } else {
                titleText = `Album #${child.id}`;
                subtitleText = "Album";
              }
            } else {
              titleText = `Album #${child.id}`;
              subtitleText = "Album";
            }
          } catch {
            titleText = `Album #${child.id}`;
            subtitleText = "Album";
          }
        }
        card.dataset.target = `/album/${child.id}`;
      } else if (child.type === "playlist") {
        const state = lib.load();
        const pl = state.playlists?.[String(child.id)];
        if (pl) {
          titleText = String(pl.title || "Playlist");
          subtitleText = String(pl.creator || "Playlist");
          coverUrl = String(pl.cover || "");
        } else {
          // Fallback: fetch metadata from offline download database
          try {
            if (window.dl?.getOfflineTracklist) {
              const r = await window.dl.getOfflineTracklist({ type: "playlist", id: String(child.id) });
              const data = r?.data && typeof r.data === "object" ? r.data : null;
              if (data) {
                titleText = String(data.title || "Playlist").trim() || "Playlist";
                const creator = String(data.creator?.name || "").trim();
                subtitleText = creator ? `Playlist • ${creator}` : "Playlist";
                coverUrl = String(data.picture_medium || data.picture || data.cover_medium || data.cover || "").trim();
              } else {
                titleText = `Playlist #${child.id}`;
                subtitleText = "Playlist";
              }
            } else {
              titleText = `Playlist #${child.id}`;
              subtitleText = "Playlist";
            }
          } catch {
            titleText = `Playlist #${child.id}`;
            subtitleText = "Playlist";
          }
        }
        card.dataset.target = `/playlist/${child.id}`;
      }

      card.dataset.dbgDesc = titleText;

      const cover2 = document.createElement("div");
      cover2.className = "big-card__cover";
      if (coverUrl) {
        const img2 = document.createElement("img");
        img2.alt = "";
        img2.loading = "lazy";
        img2.src = coverUrl;
        cover2.appendChild(img2);
      } else if (child.type === "customPlaylist") {
        cover2.style.display = "grid";
        cover2.style.placeItems = "center";
        cover2.style.background = "rgba(255,255,255,0.06)";
        const ic = document.createElement("i");
        ic.className = "ri-music-2-fill";
        ic.style.fontSize = "32px";
        ic.style.color = "rgba(255,255,255,0.4)";
        cover2.appendChild(ic);
      }

      const t2 = document.createElement("div");
      t2.className = "big-card__title";
      t2.textContent = titleText;
      const st2 = document.createElement("div");
      st2.className = "big-card__subtitle";
      st2.textContent = subtitleText;

      card.appendChild(cover2);
      card.appendChild(t2);
      card.appendChild(st2);

      card.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (child.type === "customPlaylist") {
          navigate({ name: "customPlaylist", id: child.id });
        } else if (child.type === "album") {
          navigate({ name: "entity", entityType: "album", id: String(child.id) });
        } else if (child.type === "playlist") {
          navigate({ name: "entity", entityType: "playlist", id: String(child.id) });
        }
      });

      grid.appendChild(card);
    }

    container.appendChild(grid);
  } else {
    const emptyState = document.createElement("div");
    emptyState.style.cssText = "text-align:center;padding:48px 24px;color:rgba(255,255,255,0.5);";
    emptyState.innerHTML = `
      <i class="ri-folder-open-line" style="font-size:48px;margin-bottom:12px;display:block;" aria-hidden="true"></i>
      <div style="font-size:18px;font-weight:700;margin-bottom:6px;">This folder is empty</div>
      <div style="font-size:14px;">Right-click playlists or albums and choose "Add to folder"</div>
    `;
    container.appendChild(emptyState);
  }

  return true;
}

async function collectFolderTracks(folder, lib) {
  const children = Array.isArray(folder.children) ? folder.children : [];
  const allTracks = [];

  for (const child of children) {
    if (child.type === "customPlaylist") {
      const cp = lib.getCustomPlaylist(child.id);
      if (!cp) continue;
      const trackIds = Array.isArray(cp.trackIds) ? cp.trackIds : [];
      const tracksMap = cp.tracks && typeof cp.tracks === "object" ? cp.tracks : {};
      for (const tid of trackIds) {
        const t = tracksMap[String(tid)];
        if (!t) continue;
        allTracks.push({
          id: tid,
          title: String(t.title || ""),
          artist: { name: String(t.artist || ""), id: null },
          album: {
            id: t.albumId || null,
            title: String(t.albumTitle || ""),
            cover_small: String(t.albumCover || ""),
            cover_medium: String(t.albumCover || ""),
            cover: String(t.albumCover || ""),
          },
          duration: Number(t.duration) || 0,
          cover: String(t.albumCover || ""),
        });
      }
    } else if (child.type === "album" || child.type === "playlist") {
      // Try to fetch tracklist from offline/online sources
      try {
        if (window.dl?.getOfflineTracklist) {
          const r = await window.dl.getOfflineTracklist({ type: child.type, id: String(child.id) });
          const data = r?.data && typeof r.data === "object" ? r.data : null;
          const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
          if (tracks.length > 0) {
            allTracks.push(...tracks);
            continue;
          }
        }
      } catch {}
      try {
        if (window.__authHasARL && window.dz?.getTracklist) {
          const r = await window.dz.getTracklist({ type: child.type, id: String(child.id) });
          const data = r?.data && typeof r.data === "object" ? r.data : null;
          const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
          if (tracks.length > 0) {
            allTracks.push(...tracks);
          }
        }
      } catch {}
    }
  }

  return allTracks;
}
