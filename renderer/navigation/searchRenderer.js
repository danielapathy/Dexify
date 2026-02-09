import { formatDuration, formatRecordTypeLabel } from "../utils.js";
import { renderSearchResultsSkeleton } from "../skeletons.js";
import { registerTrackList } from "../contextMenu.js";

function isElement(node) {
  return Boolean(node && node.nodeType === 1);
}

export function createSearchRenderer({ showView, searchInput, queryLabel, searchResults, setSearchFilterActive } = {}) {
  const resultsEl = isElement(searchResults) ? searchResults : null;
  const inputEl = isElement(searchInput) ? searchInput : null;
  const labelEl = isElement(queryLabel) ? queryLabel : null;
  const show = typeof showView === "function" ? showView : null;
  const setFilterActive = typeof setSearchFilterActive === "function" ? setSearchFilterActive : null;

  const renderSearchSkeleton = (label) => {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = String(label || "");
    resultsEl.appendChild(empty);
  };

  const renderTracksList = (title, items) => {
    const tracks = Array.isArray(items) ? items : [];
    if (tracks.length === 0 || !resultsEl) return;

    const section = document.createElement("section");
    section.className = "search-tracks";

    const h2 = document.createElement("h2");
    h2.className = "search-tracks__title";
    h2.textContent = title;
    section.appendChild(h2);

    const list = document.createElement("div");
    list.className = "search-tracklist";
    registerTrackList(list, tracks, { pageContext: "search" });

    let idx = 0;
    for (const t of tracks) {
      const trackId = Number(t?.id || t?.SNG_ID);
      const row = document.createElement("div");
      row.className = "search-track";
      row.dataset.trackIndex = String(idx++);
      if (Number.isFinite(trackId) && trackId > 0) row.dataset.trackId = String(trackId);
      const albumId = Number(t?.album?.id || t?.ALB_ID || t?.ALBUM_ID || t?.album_id || t?.data?.ALB_ID || 0);
      if (Number.isFinite(albumId) && albumId > 0) row.dataset.albumId = String(albumId);
      const artistId = Number(t?.artist?.id || t?.ART_ID || t?.artist_id || t?.data?.ART_ID || 0);
      if (Number.isFinite(artistId) && artistId > 0) row.dataset.artistId = String(artistId);

      const cover = document.createElement("div");
      cover.className = "search-track__cover";
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      const md5 = String(t?.ALB_PICTURE || "");
      const md5Cover =
        md5 && /^[a-f0-9]{32}$/i.test(md5)
          ? `https://e-cdns-images.dzcdn.net/images/cover/${md5}/80x80-000000-80-0-0.jpg`
          : "";
      const src = String(t?.album?.cover_small || t?.album?.cover_medium || t?.album?.cover || md5Cover || "");
      if (src) img.src = src;
      cover.appendChild(img);
      const play = document.createElement("span");
      play.className = "search-track__hoverPlay";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill icon" aria-hidden="true"></i>';
      cover.appendChild(play);

      const main = document.createElement("div");
      main.className = "search-track__main";
      const tt = document.createElement("div");
      tt.className = "search-track__title";
      tt.textContent = String(t?.title || t?.SNG_TITLE || "");

      const sub = document.createElement("div");
      sub.className = "search-track__subtitle";

      const explicit = Boolean(t?.explicit_lyrics || t?.EXPLICIT_LYRICS);
      if (explicit) {
        const badge = document.createElement("span");
        badge.className = "badge-explicit";
        badge.textContent = "E";
        sub.appendChild(badge);
      }

      const artist = document.createElement("span");
      artist.textContent = String(t?.artist?.name || t?.ART_NAME || "");
      sub.appendChild(artist);

      main.appendChild(tt);
      main.appendChild(sub);

      const dur = document.createElement("div");
      dur.className = "search-track__duration";
      dur.textContent = formatDuration(t?.duration || t?.DURATION || 0);

      row.appendChild(cover);
      row.appendChild(main);
      row.appendChild(dur);
      list.appendChild(row);
    }

    section.appendChild(list);
    resultsEl.appendChild(section);
  };

  const renderSection = (title, items, { kind }) => {
    if (!Array.isArray(items) || items.length === 0 || !resultsEl) return;

    const section = document.createElement("section");
    section.className = "made-for";

    const header = document.createElement("div");
    header.className = "made-for__header";

    const titles = document.createElement("div");
    titles.className = "made-for__titles";

    const h2 = document.createElement("h2");
    h2.className = "h2 h2--small";
    h2.textContent = title;
    titles.appendChild(h2);
    header.appendChild(titles);
    section.appendChild(header);

    const carousel = document.createElement("div");
    carousel.className = "carousel";
    carousel.setAttribute("role", "list");

    for (const item of items) {
      const a = document.createElement("a");
      a.className = "big-card";
      a.href = "#";
      a.setAttribute("role", "listitem");
      a.dataset.kind = kind;

      const cover = document.createElement("div");
      cover.className = "big-card__cover";
      if (kind === "artist") cover.classList.add("big-card__cover--circle");

      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      if (item?.image) img.src = item.image;
      cover.appendChild(img);

      if (kind !== "artist") {
        const play = document.createElement("span");
        play.className = "hover-play hover-play--cover";
        play.setAttribute("aria-hidden", "true");
        play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
        cover.appendChild(play);
      }

      const t = document.createElement("div");
      t.className = "big-card__title";
      t.textContent = String(item?.title || "");

      const subtitle = document.createElement("div");
      subtitle.className = "big-card__subtitle";
      subtitle.textContent = String(item?.subtitle || "");

      a.appendChild(cover);
      a.appendChild(t);
      a.appendChild(subtitle);

      if (item?.entityType && item?.id) {
        a.dataset.entityType = String(item.entityType);
        a.dataset.entityId = String(item.id);
      } else {
        a.setAttribute("aria-disabled", "true");
      }

      carousel.appendChild(a);
    }

    section.appendChild(carousel);
    resultsEl.appendChild(section);
  };

  const normalizeSearchItem = (kind, item) => {
    if (!item || typeof item !== "object") return null;

    if (kind === "track") {
      const albumId = item?.album?.id;
      return {
        title: item?.title,
        subtitle: item?.artist?.name || "",
        image: item?.album?.cover_medium || item?.album?.cover || "",
        entityType: albumId ? "album" : null,
        id: albumId ? String(albumId) : null,
      };
    }

    if (kind === "album") {
      const typeLabel = formatRecordTypeLabel(item?.record_type || item?.recordType, { fallback: "Album" });
      const artist = item?.artist?.name || "";
      return {
        title: item?.title,
        subtitle: artist ? `${typeLabel} • ${artist}` : typeLabel,
        image: item?.cover_medium || item?.cover || "",
        entityType: "album",
        id: String(item?.id || ""),
      };
    }

    if (kind === "artist") {
      return {
        title: item?.name,
        subtitle: "Artist",
        image: item?.picture_medium || item?.picture || "",
        entityType: "artist",
        id: String(item?.id || ""),
      };
    }

    if (kind === "playlist") {
      return {
        title: item?.title,
        subtitle: "Playlist",
        image: item?.picture_medium || item?.picture || "",
        entityType: "playlist",
        id: String(item?.id || ""),
      };
    }

    return null;
  };

  let searchReq = 0;
  const renderSearch = async ({ q, filter, scrollTop } = {}) => {
    const query = String(q || "").trim();
    if (!query || query.length < 2) {
      show?.("home", { scrollTop: 0 });
      return;
    }

    show?.("search", { scrollTop });
    try {
      if (inputEl) inputEl.value = query;
    } catch {}
    try {
      if (labelEl) labelEl.textContent = `Results for “${query}”`;
    } catch {}
    try {
      setFilterActive?.(filter);
    } catch {}

    if (!window.__authHasARL) {
      renderSearchSkeleton("Log in to search.");
      return;
    }

    if (!window.dz || typeof window.dz.search !== "function") {
      renderSearchSkeleton("Search is available in Electron only (missing window.dz).");
      return;
    }

    const thisReq = ++searchReq;
    renderSearchResultsSkeleton(resultsEl, { kind: String(filter || "all"), metricsEl: inputEl });

    try {
      const load = async (kind, limit) => {
        const res = await window.dz.search({ term: query, type: kind, start: 0, nb: limit });
        if (!res?.ok) return { kind, items: [], error: res?.error || res?.message || "failed" };
        const data = Array.isArray(res?.results?.data) ? res.results.data : [];
        return { kind, items: data, error: "" };
      };

      const kind = String(filter || "all");
      if (kind === "all") {
        const [tracks, albums, artists, playlists] = await Promise.all([
          load("track", 10),
          load("album", 10),
          load("artist", 10),
          load("playlist", 10),
        ]);

        if (thisReq !== searchReq) return;
        resultsEl.innerHTML = "";

        const artistItems = artists.items.map((x) => normalizeSearchItem("artist", x)).filter(Boolean).slice(0, 4);
        if (artistItems.length > 0) renderSection("Artists", artistItems, { kind: "artist" });

        let any = false;
        const trackItems = Array.isArray(tracks.items) ? tracks.items : [];
        if (trackItems.length > 0) {
          any = true;
          renderTracksList("Tracks", trackItems);
        }

        const sections = [
          { title: "Albums", kind: "album", items: albums.items },
          { title: "Playlists", kind: "playlist", items: playlists.items },
        ];
        for (const sec of sections) {
          const normalized = sec.items.map((x) => normalizeSearchItem(sec.kind, x)).filter(Boolean);
          if (normalized.length === 0) continue;
          any = true;
          renderSection(sec.title, normalized, { kind: sec.kind });
        }

        if (!any) {
          renderSearchSkeleton("No results found.");
        }
        return;
      }

      const result = await load(kind, 50);
      if (thisReq !== searchReq) return;
      resultsEl.innerHTML = "";

      if (kind === "track") {
        const trackItems = Array.isArray(result.items) ? result.items : [];
        if (trackItems.length === 0) {
          renderSearchSkeleton("No results found.");
          return;
        }
        renderTracksList("Tracks", trackItems);
      } else {
        const normalized = result.items.map((x) => normalizeSearchItem(kind, x)).filter(Boolean);
        if (normalized.length === 0) {
          renderSearchSkeleton("No results found.");
          return;
        }
        renderSection(`${kind[0].toUpperCase()}${kind.slice(1)}s`, normalized, { kind });
      }
    } catch (e) {
      if (thisReq !== searchReq) return;
      renderSearchSkeleton(String(e?.message || e || "Search failed"));
    }
  };

  return { renderSearch };
}
