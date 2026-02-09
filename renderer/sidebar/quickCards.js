import { getLocalLibrary } from "../localLibrary.js";

export function wireQuickCards() {
  const grid = document.getElementById("quickGrid");
  const lib = getLocalLibrary();

  const focusTopSearch = () => {
    const input = document.getElementById("topSearchInput");
    try {
      input?.focus?.();
    } catch {}
  };

  const createQuickEmpty = () => {
    const wrap = document.createElement("div");
    wrap.className = "quick-empty";

    const icon = document.createElement("div");
    icon.className = "quick-empty__icon";
    const iconGlyph = document.createElement("i");
    iconGlyph.className = "ri-emotion-happy-line";
    iconGlyph.setAttribute("aria-hidden", "true");
    icon.appendChild(iconGlyph);

    const text = document.createElement("div");
    text.className = "quick-empty__text";
    const strong = document.createElement("strong");
    strong.textContent = "No recents yet.";
    text.appendChild(strong);
    text.appendChild(document.createElement("br"));
    text.appendChild(document.createTextNode("Search and play something — it’ll show up here."));

    const actions = document.createElement("div");
    actions.className = "quick-empty__actions";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill is-active";
    btn.textContent = "Search music";
    btn.addEventListener("click", () => focusTopSearch());
    actions.appendChild(btn);

    wrap.appendChild(icon);
    wrap.appendChild(text);
    wrap.appendChild(actions);
    return wrap;
  };

  const normalizeRecentToPlayer = (r) => {
    const cover =
      String(
        r?.albumCover ||
          r?.trackJson?.album?.cover_medium ||
          r?.trackJson?.album?.cover_small ||
          r?.trackJson?.album?.cover ||
          r?.trackJson?.cover ||
          "",
      ).trim() || "";
    const raw = r?.trackJson && typeof r.trackJson === "object" ? { ...r.trackJson } : null;
    if (raw) {
      if (cover) {
        raw.cover = String(raw.cover || cover);
        if (raw.album && typeof raw.album === "object") {
          raw.album = { ...raw.album };
          raw.album.cover_small = String(raw.album.cover_small || cover);
          raw.album.cover_medium = String(raw.album.cover_medium || cover);
          raw.album.cover = String(raw.album.cover || cover);
        } else if (raw.album === undefined) {
          raw.album = { cover_small: cover, cover_medium: cover, cover };
        }
      }
      return raw;
    }
    return {
      id: Number(r?.id) || null,
      title: String(r?.title || ""),
      duration: Number(r?.duration) || 0,
      artist: { id: Number(r?.artistId) || null, name: String(r?.artist || "") },
      album: {
        cover_small: cover,
        cover_medium: cover,
        cover: cover,
        title: String(r?.albumTitle || ""),
        id: Number(r?.albumId) || null,
      },
      ...(cover ? { cover } : {}),
    };
  };

  const render = () => {
    if (!grid) return;
    grid.innerHTML = "";

    const recents = lib.listRecentTracks().slice(0, 8);
    if (recents.length === 0) {
      grid.appendChild(createQuickEmpty());
      return;
    }

    const queue = recents.map((r) => normalizeRecentToPlayer(r));

    let idx = 0;
    for (const t of recents) {
      const i = idx++;
      const a = document.createElement("a");
      a.className = "quick-card";
      a.href = "#";
      a.dataset.trackIndex = String(i);
      a.dataset.trackId = String(t?.id || "");
      const albumId = Number(t?.albumId || t?.trackJson?.album?.id) || 0;
      if (Number.isFinite(albumId) && albumId > 0) a.dataset.albumId = String(albumId);
      const artistId = Number(t?.artistId || t?.trackJson?.artist?.id) || 0;
      if (Number.isFinite(artistId) && artistId > 0) a.dataset.artistId = String(artistId);
      a.__payload = queue[i] || null;

      const cover = document.createElement("div");
      cover.className = "quick-card__cover";
      const coverUrl = String(
        t?.albumCover ||
          t?.trackJson?.album?.cover_medium ||
          t?.trackJson?.album?.cover_small ||
          t?.trackJson?.album?.cover ||
          "",
      ).trim();
      if (coverUrl) {
        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.src = coverUrl;
        cover.appendChild(img);
      } else {
        cover.classList.add("cover--liked-mini");
        const glyph = document.createElement("i");
        glyph.className = "ri-music-2-fill cover__icon cover__icon--mini";
        glyph.setAttribute("aria-hidden", "true");
        cover.appendChild(glyph);
      }

      const meta = document.createElement("div");
      meta.className = "quick-card__meta";
      const title = document.createElement("div");
      title.className = "quick-card__title";
      title.textContent = String(t?.title || "Track");
      const subtitle = document.createElement("div");
      subtitle.className = "quick-card__subtitle";
      subtitle.textContent = String(t?.artist || "");
      meta.appendChild(title);
      meta.appendChild(subtitle);

      const play = document.createElement("span");
      play.className = "hover-play";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';

      a.appendChild(cover);
      a.appendChild(meta);
      a.appendChild(play);

      a.addEventListener("click", (event) => {
        event.preventDefault();
        const cards = Array.from(grid.querySelectorAll(".quick-card"));
        for (const c of cards) c.classList.toggle("is-playing", c === a);
        if (window.__player?.setQueueAndPlay) void window.__player.setQueueAndPlay(queue, i);
      });

      grid.appendChild(a);
    }
  };

  render();
  window.addEventListener("local-library:changed", () => render());
}

