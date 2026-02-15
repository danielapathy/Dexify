export function renderCustomPlaylistPage(container, route, { lib, registerTrackList, formatDuration, navigate, downloadBadges }) {
  const id = String(route?.id || "");
  if (!id || !container) return false;

  const playlist = lib.getCustomPlaylist(id);
  if (!playlist) {
    container.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = "Playlist not found";
    container.appendChild(empty);
    return true;
  }

  container.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "entity-header";
  header.dataset.dbg = "playlist-header";
  header.dataset.dbgType = "header";
  header.dataset.dbgId = id;

  const coverEl = document.createElement("div");
  coverEl.className = "entity-cover";
  const coverSrc = String(playlist.cover || "").trim();
  const hasCustomCover = Boolean(playlist.customCover);
  
  if (coverSrc) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = coverSrc;
    coverEl.appendChild(img);
  } else {
    coverEl.classList.add("entity-cover--placeholder");
    const icon = document.createElement("i");
    icon.className = "ri-music-2-fill";
    icon.setAttribute("aria-hidden", "true");
    icon.style.fontSize = "48px";
    icon.style.color = "rgba(255,255,255,0.5)";
    coverEl.appendChild(icon);
    coverEl.style.display = "grid";
    coverEl.style.placeItems = "center";
    coverEl.style.background = "rgba(255,255,255,0.06)";
  }
  
  // Add upload/delete overlay
  const overlay = document.createElement("div");
  overlay.className = "entity-cover__upload-overlay";
  
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  
  const overlayBtn = document.createElement("button");
  overlayBtn.type = "button";
  overlayBtn.className = "entity-cover__upload-btn";
  
  if (hasCustomCover) {
    // Show delete button
    overlayBtn.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
    overlayBtn.setAttribute("aria-label", "Remove cover");
    overlayBtn.dataset.tooltip = "Remove cover";
    overlayBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      lib.clearCustomPlaylistCover?.(id);
      // Refresh page to show regenerated composite
      setTimeout(() => navigate({ name: "customPlaylist", id, refresh: true }, { replace: true }), 100);
    });
  } else {
    // Show upload button
    overlayBtn.innerHTML = '<i class="ri-upload-2-line" aria-hidden="true"></i>';
    overlayBtn.setAttribute("aria-label", "Upload cover");
    overlayBtn.dataset.tooltip = "Upload cover";
    overlayBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fileInput.click();
    });
  }
  
  fileInput.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      lib.setCustomPlaylistCover?.(id, dataUrl);
      // Refresh page to show new cover
      setTimeout(() => navigate({ name: "customPlaylist", id, refresh: true }, { replace: true }), 100);
    };
    reader.readAsDataURL(file);
  });
  
  overlay.appendChild(overlayBtn);
  overlay.appendChild(fileInput);
  coverEl.appendChild(overlay);

  const meta = document.createElement("div");
  meta.className = "entity-meta";

  // Editable title
  const titleEl = document.createElement("div");
  titleEl.className = "entity-title";
  titleEl.contentEditable = "true";
  titleEl.spellcheck = false;
  titleEl.textContent = String(playlist.title || "");
  titleEl.dataset.dbg = "playlist-title-input";
  titleEl.dataset.dbgType = "input";
  titleEl.dataset.dbgDesc = "Editable playlist title";
  titleEl.style.outline = "none";
  titleEl.style.cursor = "text";
  titleEl.style.borderBottom = "2px solid transparent";
  titleEl.addEventListener("focus", () => {
    titleEl.style.borderBottom = "2px solid rgba(255,255,255,0.3)";
  });
  titleEl.addEventListener("blur", () => {
    titleEl.style.borderBottom = "2px solid transparent";
    const newTitle = String(titleEl.textContent || "").trim();
    if (newTitle && newTitle !== playlist.title) {
      lib.renameCustomPlaylist(id, newTitle);
    }
  });
  titleEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); titleEl.blur(); }
  });

  const sub = document.createElement("div");
  sub.className = "entity-subtitle";
  const trackCount = Array.isArray(playlist.trackIds) ? playlist.trackIds.length : 0;
  sub.textContent = `Custom Playlist • ${trackCount} track${trackCount !== 1 ? "s" : ""}`;

  meta.appendChild(titleEl);
  meta.appendChild(sub);

  // Actions
  const actions = document.createElement("div");
  actions.className = "entity-actions";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "entity-action-btn is-primary";
  playBtn.setAttribute("aria-label", "Play");
  playBtn.dataset.tooltip = "Play";
  playBtn.dataset.dbg = "entity-action-play";
  playBtn.dataset.dbgType = "button";
  playBtn.dataset.dbgDesc = "Play custom playlist";
  playBtn.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';
  playBtn.addEventListener("click", () => {
    if (!window.__player) return;
    const tracks = buildTracksForPlayback(playlist);
    if (tracks.length === 0) return;
    lib.markCustomPlaylistPlayed(id);
    void window.__player.setQueueAndPlay(tracks, 0, {
      context: { type: "customPlaylist", id, title: playlist.title, cover: playlist.cover || "" },
    });
  });
  actions.appendChild(playBtn);
  meta.appendChild(actions);

  header.appendChild(coverEl);
  header.appendChild(meta);
  container.appendChild(header);

  // Track list
  const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  const tracksMap = playlist.tracks && typeof playlist.tracks === "object" ? playlist.tracks : {};

  if (trackIds.length > 0) {
    const trackList = document.createElement("div");
    trackList.className = "entity-tracks entity-tracks--dl";
    trackList.dataset.customPlaylist = "1";

    const tracksForRegister = [];
    let index = 1;
    for (const tid of trackIds) {
      const t = tracksMap[String(tid)];
      if (!t) continue;

      const trackObj = {
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
      };
      tracksForRegister.push(trackObj);

      const row = document.createElement("div");
      row.className = "entity-track";
      row.dataset.trackIndex = String(index - 1);
      row.dataset.trackId = String(tid);
      row.dataset.dbg = "track-row";
      row.dataset.dbgType = "track-row";
      row.dataset.dbgId = String(tid);
      row.dataset.dbgDesc = String(t.title || "");
      row.dataset.customPlaylistId = id;
      if (t.albumId) row.dataset.albumId = String(t.albumId);

      const idx = document.createElement("div");
      idx.className = "entity-track__index";
      const num = document.createElement("span");
      num.className = "entity-track__num";
      num.textContent = String(index++);
      const play2 = document.createElement("span");
      play2.className = "entity-track__hoverPlay";
      play2.setAttribute("aria-hidden", "true");
      play2.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';
      const viz = document.createElement("span");
      viz.className = "entity-track__viz";
      viz.setAttribute("aria-hidden", "true");
      viz.innerHTML = '<span class="playing-viz"><span></span><span></span><span></span></span>';
      idx.appendChild(num);
      idx.appendChild(play2);
      idx.appendChild(viz);
      row.appendChild(idx);

      const main = document.createElement("div");
      main.className = "entity-track__main";
      const tt = document.createElement("div");
      tt.className = "entity-track__title";
      tt.textContent = String(t.title || "");
      const ta = document.createElement("div");
      ta.className = "entity-track__artist";
      ta.textContent = String(t.artist || "");
      main.appendChild(tt);
      main.appendChild(ta);
      row.appendChild(main);

      const dl = document.createElement("span");
      dl.className = "entity-track__download";
      dl.setAttribute("aria-hidden", "true");
      dl.innerHTML = '<i class="ri-download-2-line" aria-hidden="true"></i>';
      row.appendChild(dl);

      const dur = document.createElement("div");
      dur.className = "entity-track__duration";
      dur.textContent = formatDuration(t.duration || 0);
      row.appendChild(dur);

      if (downloadBadges?.applyToRow) {
        try { downloadBadges.applyToRow(row); } catch {}
      }

      trackList.appendChild(row);
    }

    registerTrackList(trackList, tracksForRegister, {
      pageContext: { type: "customPlaylist", id, title: playlist.title },
    });
    container.appendChild(trackList);
  } else {
    // Empty state
    const emptyState = document.createElement("div");
    emptyState.className = "custom-playlist-empty";
    emptyState.dataset.dbg = "playlist-empty-state";
    emptyState.dataset.dbgType = "empty-state";
    emptyState.innerHTML = `
      <div style="text-align:center;padding:48px 24px;color:rgba(255,255,255,0.5);">
        <i class="ri-music-2-line" style="font-size:48px;margin-bottom:12px;display:block;" aria-hidden="true"></i>
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;">Let's find something for your playlist</div>
        <div style="font-size:14px;">Right-click any track and choose "Add to playlist"</div>
      </div>
    `;
    container.appendChild(emptyState);
  }

  // Recommended section
  renderRecommendedSection(container, playlist, { lib, id, formatDuration, navigate });

  return true;
}

function buildTracksForPlayback(playlist) {
  const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  const tracksMap = playlist.tracks && typeof playlist.tracks === "object" ? playlist.tracks : {};
  const result = [];
  for (const tid of trackIds) {
    const t = tracksMap[String(tid)];
    if (!t) continue;
    result.push({
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
  return result;
}

function renderRecommendedSection(container, playlist, { lib, id, formatDuration, navigate }) {
  const existingIds = new Set(Array.isArray(playlist.trackIds) ? playlist.trackIds : []);
  const state = lib.load();
  const candidates = [];
  const seen = new Set();

  // Gather from recent tracks, saved tracks, downloaded tracks
  const sources = [
    ...(Array.isArray(state.recentTracks) ? state.recentTracks : []),
    ...Object.values(state.savedTracks || {}),
  ];

  for (const t of sources) {
    const tid = Number(t?.id);
    if (!Number.isFinite(tid) || tid <= 0) continue;
    if (existingIds.has(tid) || seen.has(tid)) continue;
    seen.add(tid);
    candidates.push({
      id: tid,
      title: String(t?.title || t?.SNG_TITLE || ""),
      artist: String(t?.artist?.name || t?.ART_NAME || t?.artist || ""),
      albumId: Number(t?.album?.id || t?.albumId || t?.ALB_ID) || null,
      albumTitle: String(t?.album?.title || t?.albumTitle || t?.ALB_TITLE || ""),
      albumCover: String(t?.albumCover || t?.album?.cover_medium || t?.album?.cover_small || t?.album?.cover || t?.cover || "").trim(),
      duration: Number(t?.duration || t?.DURATION) || 0,
    });
    if (candidates.length >= 20) break;
  }

  if (candidates.length === 0) return;

  const section = document.createElement("section");
  section.className = "recommended-section";
  section.dataset.dbg = "recommended-section";
  section.dataset.dbgType = "section";
  section.dataset.dbgDesc = "Recommended tracks";

  const sectionHeader = document.createElement("div");
  sectionHeader.className = "made-for__header";
  const titles = document.createElement("div");
  titles.className = "made-for__titles";
  const h2 = document.createElement("h2");
  h2.className = "h2 h2--small";
  h2.textContent = "Recommended";
  titles.appendChild(h2);
  sectionHeader.appendChild(titles);
  section.appendChild(sectionHeader);

  const recList = document.createElement("div");
  recList.className = "entity-tracks";

  for (const c of candidates) {
    const row = document.createElement("div");
    row.className = "entity-track entity-track--rec";
    row.dataset.dbg = "rec-track";
    row.dataset.dbgType = "track-row";
    row.dataset.dbgId = String(c.id);

    const main = document.createElement("div");
    main.className = "entity-track__main";
    const tt = document.createElement("div");
    tt.className = "entity-track__title";
    tt.textContent = c.title;
    const ta = document.createElement("div");
    ta.className = "entity-track__artist";
    ta.textContent = c.artist;
    main.appendChild(tt);
    main.appendChild(ta);
    row.appendChild(main);

    const dur = document.createElement("div");
    dur.className = "entity-track__duration";
    dur.textContent = formatDuration(c.duration);
    row.appendChild(dur);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "icon-btn rec-add-btn";
    addBtn.setAttribute("aria-label", "Add to playlist");
    addBtn.dataset.dbg = "rec-add-btn";
    addBtn.dataset.dbgType = "button";
    addBtn.dataset.dbgId = String(c.id);
    addBtn.dataset.dbgDesc = `Add ${c.title} to playlist`;
    addBtn.innerHTML = '<i class="ri-add-circle-line" aria-hidden="true"></i>';
    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const track = {
        id: c.id,
        title: c.title,
        artist: { name: c.artist },
        album: { id: c.albumId, title: c.albumTitle, cover_medium: c.albumCover, cover: c.albumCover },
        duration: c.duration,
      };
      const added = lib.addTrackToCustomPlaylist(id, track);
      if (added) {
        row.style.opacity = "0.3";
        row.style.pointerEvents = "none";
        addBtn.disabled = true;
        // Live-refresh the page
        if (typeof navigate === "function") {
          setTimeout(() => navigate({ name: "customPlaylist", id, refresh: true }, { replace: true }), 180);
        }
      }
    });
    row.appendChild(addBtn);

    recList.appendChild(row);
  }

  section.appendChild(recList);
  container.appendChild(section);
}
