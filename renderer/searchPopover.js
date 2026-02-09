import { renderSearchPopoverSkeleton } from "./skeletons.js";

function cleanQuery(value) {
  return String(value || "").trim();
}

function createCover(imgUrl) {
  const cover = document.createElement("div");
  cover.className = "search-suggest__cover";
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  const src = String(imgUrl || "").trim();
  if (src) img.src = src;
  cover.appendChild(img);
  return cover;
}

function createRow({ kind, title, subtitle, coverUrl, payload }) {
  const row = document.createElement("div");
  row.className = `search-suggest search-suggest--${String(kind || "")}`;
  row.dataset.kind = String(kind || "");
  row.__payload = payload || null;

  const cover = createCover(coverUrl);
  if (kind === "artist") cover.classList.add("search-suggest__cover--circle");
  if (kind === "track") {
    const play = document.createElement("span");
    play.className = "search-suggest__play";
    play.setAttribute("aria-hidden", "true");
    play.innerHTML = '<i class="ri-play-fill icon" aria-hidden="true"></i>';
    cover.appendChild(play);
  }
  row.appendChild(cover);

  const main = document.createElement("div");
  main.className = "search-suggest__main";
  const t = document.createElement("div");
  t.className = "search-suggest__title";
  t.textContent = String(title || "");
  const st = document.createElement("div");
  st.className = "search-suggest__subtitle";
  st.textContent = String(subtitle || "");
  main.appendChild(t);
  main.appendChild(st);
  row.appendChild(main);
  return row;
}

function createActionRow({ label, q }) {
  const row = document.createElement("div");
  row.className = "search-suggest search-suggest--action";
  row.dataset.kind = "action";
  row.dataset.action = "openSearch";
  row.dataset.q = q;

  const main = document.createElement("div");
  main.className = "search-suggest__action";
  main.innerHTML = "";
  const left = document.createElement("span");
  left.textContent = label;
  const right = document.createElement("i");
  right.className = "ri-arrow-right-line icon";
  right.setAttribute("aria-hidden", "true");
  main.appendChild(left);
  main.appendChild(right);
  row.appendChild(main);
  return row;
}

function normalizeTrack(t) {
  if (!t || typeof t !== "object") return null;
  const id = Number(t?.id || t?.SNG_ID);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    kind: "track",
    title: String(t?.title || t?.SNG_TITLE || ""),
    subtitle: String(t?.artist?.name || t?.ART_NAME || ""),
    coverUrl: String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || ""),
    payload: t,
  };
}

function normalizeEntity(kind, item) {
  if (!item || typeof item !== "object") return null;
  const id = String(item?.id || "").trim();
  if (!id) return null;
  if (kind === "album") {
    return {
      kind: "album",
      title: String(item?.title || ""),
      subtitle: String(item?.artist?.name || ""),
      coverUrl: String(item?.cover_small || item?.cover_medium || item?.cover || ""),
      payload: { entityType: "album", id },
    };
  }
  if (kind === "artist") {
    return {
      kind: "artist",
      title: String(item?.name || ""),
      subtitle: "Artist",
      coverUrl: String(item?.picture_small || item?.picture_medium || item?.picture || ""),
      payload: { entityType: "artist", id },
    };
  }
  if (kind === "playlist") {
    return {
      kind: "playlist",
      title: String(item?.title || ""),
      subtitle: "Playlist",
      coverUrl: String(item?.picture_small || item?.picture_medium || item?.picture || ""),
      payload: { entityType: "playlist", id },
    };
  }
  return null;
}

export function wireSearchPopover({
  searchInput,
  popoverEl,
  listEl,
  getDz,
  onOpenSearchPage,
  onNavigateEntity,
  onPlayTrack,
  minChars = 2,
}) {
  let isOpen = false;
  let req = 0;
  let blurTimer = null;
  let debounceTimer = null;

  const close = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    req += 1;
    isOpen = false;
    popoverEl.hidden = true;
    listEl.innerHTML = "";
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    popoverEl.hidden = false;
  };

  const renderResults = (items, q) => {
    listEl.innerHTML = "";
    for (const it of items) {
      listEl.appendChild(
        createRow({
          kind: it.kind,
          title: it.title,
          subtitle: it.subtitle,
          coverUrl: it.coverUrl,
          payload: it.payload,
        }),
      );
    }
    listEl.appendChild(createActionRow({ label: `See all results for “${q}”`, q }));
  };

  const load = async () => {
    const q = cleanQuery(searchInput.value);
    if (q.length < minChars) {
      close();
      return;
    }

    const dz = getDz?.();
    if (!dz || typeof dz.search !== "function") {
      close();
      return;
    }

    open();
    renderSearchPopoverSkeleton(listEl, { rows: 6, metricsEl: searchInput });
    const thisReq = ++req;

    try {
      const [tracks, albums, artists, playlists] = await Promise.all([
        dz.search({ term: q, type: "track", start: 0, nb: 4 }),
        dz.search({ term: q, type: "album", start: 0, nb: 2 }),
        dz.search({ term: q, type: "artist", start: 0, nb: 2 }),
        dz.search({ term: q, type: "playlist", start: 0, nb: 2 }),
      ]);
      if (thisReq !== req) return;

      const outArtists = [];
      const outTracks = [];
      const outAlbums = [];
      const outPlaylists = [];

      const tdata = Array.isArray(tracks?.results?.data) ? tracks.results.data : [];
      for (const t of tdata) {
        const n = normalizeTrack(t);
        if (n) outTracks.push(n);
      }
      const adata = Array.isArray(albums?.results?.data) ? albums.results.data : [];
      for (const a of adata) {
        const n = normalizeEntity("album", a);
        if (n) outAlbums.push(n);
      }
      const rdata = Array.isArray(artists?.results?.data) ? artists.results.data : [];
      for (const a of rdata) {
        const n = normalizeEntity("artist", a);
        if (n) outArtists.push(n);
      }
      const pdata = Array.isArray(playlists?.results?.data) ? playlists.results.data : [];
      for (const p of pdata) {
        const n = normalizeEntity("playlist", p);
        if (n) outPlaylists.push(n);
      }

      // Order: artists first, then tracks/albums, then playlists.
      const out = [...outArtists, ...outTracks, ...outAlbums, ...outPlaylists];
      renderResults(out.slice(0, 8), q);
    } catch {
      if (thisReq !== req) return;
      listEl.innerHTML = "";
      listEl.appendChild(createActionRow({ label: `Search for “${q}”`, q }));
    }
  };

  const debouncedLoad = (() => {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void load();
      }, 140);
    };
  })();

  searchInput.addEventListener("input", () => debouncedLoad());
  searchInput.addEventListener("focus", () => void load());
  searchInput.addEventListener("blur", () => {
    blurTimer = setTimeout(() => close(), 140);
  });

  popoverEl.addEventListener("mousedown", () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
  });

  window.addEventListener("nav:viewChanged", () => {
    close();
  });

  popoverEl.addEventListener("click", (event) => {
    const row = event.target?.closest?.(".search-suggest");
    if (!row) return;
    const kind = String(row.dataset.kind || "");
    if (kind === "action") {
      const q = cleanQuery(row.dataset.q);
      if (q.length >= minChars) onOpenSearchPage?.(q);
      close();
      return;
    }

    if (kind === "track") {
      const t = row.__payload;
      if (t) onPlayTrack?.(t);
      close();
      return;
    }

    const payload = row.__payload;
    if (payload?.entityType && payload?.id) {
      onNavigateEntity?.(payload);
      close();
    }
  });

  return { open, close, refresh: load };
}
