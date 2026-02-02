import { buildDeezerImageUrl, isFlowSectionTitle, parseTarget } from "./deezerImages.js";
import { makeSkelBlock, makeSkelLine, measureClassTextMetrics } from "./skeletons/primitives.js";
import { formatFansCountText } from "./utils.js";

function getDeezerSectionsContainer() {
  return document.querySelector("[data-deezer-sections]");
}

function renderDeezerSectionsSkeleton(container) {
  container.innerHTML = "";

  const cardTitleMetrics = measureClassTextMetrics("big-card__title");
  const cardSubtitleMetrics = measureClassTextMetrics("big-card__subtitle");
  const cardTitleH = `${Math.max(12, Math.round(cardTitleMetrics.lineHeight))}px`;
  const cardSubtitleH = `${Math.max(11, Math.round(cardSubtitleMetrics.lineHeight))}px`;

  const skeletonSection = (title) => {
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

    for (let i = 0; i < 10; i++) {
      const card = document.createElement("a");
      card.className = "big-card big-card--skeleton";
      card.href = "#";
      card.setAttribute("aria-disabled", "true");

      const cover = document.createElement("div");
      cover.className = "big-card__cover";
      cover.appendChild(makeSkelBlock({ className: "skel--cover" }));

      const titleLine = document.createElement("div");
      titleLine.className = "big-card__title";
      titleLine.appendChild(makeSkelLine({ width: "74%", height: cardTitleH }));

      const subtitleLine = document.createElement("div");
      subtitleLine.className = "big-card__subtitle";
      subtitleLine.appendChild(makeSkelLine({ width: "92%", height: cardSubtitleH }));

      card.appendChild(cover);
      card.appendChild(titleLine);
      card.appendChild(subtitleLine);
      carousel.appendChild(card);
    }

    section.appendChild(carousel);
    container.appendChild(section);
  };

  skeletonSection("Loading…");
  skeletonSection("Continue streaming");
}

function renderDeezerSections(container, appState) {
  const sections = Array.isArray(appState?.sections) ? appState.sections : [];
  container.innerHTML = "";

  const buildSection = (sec) => {
    const title = String(sec?.title || "");
    if (isFlowSectionTitle(title)) return null;
    const items = Array.isArray(sec?.items) ? sec.items : [];
    if (!title || items.length === 0) return null;

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

    const take = items.slice(0, 16);
    for (const item of take) {
      const a = document.createElement("a");
      a.className = "big-card is-enter";
      a.href = "#";
      a.setAttribute("role", "listitem");
      a.dataset.target = String(item?.target || "");

      const parsed = a.dataset.target ? parseTarget(a.dataset.target) : null;
      if (parsed?.kind === "track") {
        const artistId = Number(item?.data?.ART_ID || item?.data?.artist?.id || 0);
        const albumId = Number(item?.data?.ALB_ID || item?.data?.album?.id || 0);
        if (Number.isFinite(artistId) && artistId > 0) a.dataset.artistId = String(artistId);
        if (Number.isFinite(albumId) && albumId > 0) a.dataset.albumId = String(albumId);
      }

      const cover = document.createElement("div");
      cover.className = "big-card__cover";

      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      const src = buildDeezerImageUrl(item, { size: 256 });
      if (src) img.src = src;
      cover.appendChild(img);

      const play = document.createElement("span");
      play.className = "hover-play hover-play--cover";
      play.setAttribute("aria-hidden", "true");
      play.innerHTML = '<i class="ri-play-fill hover-play__icon" aria-hidden="true"></i>';
      cover.appendChild(play);

      const t = document.createElement("div");
      t.className = "big-card__title";
      t.textContent = String(item?.title || item?.data?.SNG_TITLE || item?.data?.ALB_TITLE || "");

      const subtitle = document.createElement("div");
      subtitle.className = "big-card__subtitle";
      subtitle.textContent = formatFansCountText(String(item?.subtitle || item?.data?.ART_NAME || ""));

      a.appendChild(cover);
      a.appendChild(t);
      a.appendChild(subtitle);

      carousel.appendChild(a);
    }

    section.appendChild(carousel);
    return section;
  };

  for (const sec of sections) {
    const el = buildSection(sec);
    if (el) container.appendChild(el);
  }

  requestAnimationFrame(() => {
    for (const el of container.querySelectorAll(".big-card.is-enter")) {
      el.classList.remove("is-enter");
    }
  });
}

function computeSectionsSignature(appState) {
  const sections = Array.isArray(appState?.sections) ? appState.sections : [];
  const ids = [];
  for (const sec of sections) {
    const items = Array.isArray(sec?.items) ? sec.items : [];
    for (const item of items.slice(0, 8)) {
      const t = String(item?.target || "");
      if (t) ids.push(t);
    }
  }
  return ids.join("|").toLowerCase();
}

export function wireDeezerSections() {
  const container = getDeezerSectionsContainer();
  if (!container) return;

  let inFlight = false;
  let lastSignature = null;
  let skeletonShownAt = 0;
  let hasRenderedFresh = false;

  const WARMUP_TIMEOUT_MS = 18_000;
  const WARMUP_POLL_MS = 1200;
  const warmupStartedAt = performance.now();

  const refresh = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      if (!window.deezer?.getAppState) {
        renderDeezerSectionsSkeleton(container);
        return;
      }

      const state = await window.deezer.getAppState();
      if (!state?.ok || !state?.appState) {
        renderDeezerSectionsSkeleton(container);
        return;
      }

      const sig = computeSectionsSignature(state.appState);
      if (sig && sig === lastSignature && hasRenderedFresh) return;

      const now = performance.now();
      if (!hasRenderedFresh && now - skeletonShownAt < 700) {
        await new Promise((r) => setTimeout(r, 700));
      }

      lastSignature = sig;
      renderDeezerSections(container, state.appState);
      hasRenderedFresh = true;
    } finally {
      inFlight = false;
    }
  };

  container.addEventListener("click", (event) => {
    const a = event.target?.closest?.("a.big-card");
    if (!a) return;
    const target = a.dataset.target;
    if (!target) return;
    event.preventDefault();

    const parsed = parseTarget(target);
    if (!parsed) return;
    if (parsed.kind === "album" || parsed.kind === "artist" || parsed.kind === "playlist") {
      window.__spotifyNav?.navigate?.({ name: "entity", entityType: parsed.kind, id: parsed.id });
      return;
    }
    if (parsed.kind === "track") {
      if (!window.__player) return;
      const id = Number(parsed.id);
      if (!Number.isFinite(id) || id <= 0) return;
      const title = a.querySelector(".big-card__title")?.textContent || "";
      const subtitle = a.querySelector(".big-card__subtitle")?.textContent || "";
      const cover = a.querySelector(".big-card__cover img")?.getAttribute?.("src") || "";
      const artistId = Number(a.dataset.artistId || 0);
      const albumId = Number(a.dataset.albumId || 0);
      void window.__player.setQueueAndPlay(
        [
          {
            id,
            title,
            artist: {
              id: Number.isFinite(artistId) && artistId > 0 ? artistId : null,
              name: subtitle,
            },
            album: {
              id: Number.isFinite(albumId) && albumId > 0 ? albumId : null,
              cover_medium: cover,
              cover_small: cover,
            },
          },
        ],
        0,
      );
      return;
    }
    if (parsed.kind === "smarttracklist") {
      const title = a.querySelector(".big-card__title")?.textContent || "";
      const subtitle = a.querySelector(".big-card__subtitle")?.textContent || "";
      const cover = a.querySelector(".big-card__cover img")?.getAttribute?.("src") || "";
      window.__spotifyNav?.navigate?.({
        name: "entity",
        entityType: "smarttracklist",
        id: parsed.id,
        title,
        subtitle,
        cover,
      });
      return;
    }
    if (parsed.kind === "channel") {
      window.__spotifyNav?.navigate?.({
        name: "page",
        page: parsed.page,
        title: a.querySelector(".big-card__title")?.textContent || "",
      });
      return;
    }
    if (parsed.kind === "page") {
      window.__spotifyNav?.navigate?.({
        name: "page",
        page: parsed.page,
        title: a.querySelector(".big-card__title")?.textContent || "",
      });
    }
  });

  renderDeezerSectionsSkeleton(container);
  skeletonShownAt = performance.now();

  window.__deezerSectionsRefresh = () => {
    lastSignature = null;
    renderDeezerSectionsSkeleton(container);
    skeletonShownAt = performance.now();
    void refresh();
  };

  const warmupInterval = setInterval(() => {
    if (hasRenderedFresh) {
      clearInterval(warmupInterval);
      setInterval(() => void refresh(), 8000);
      return;
    }
    const elapsed = performance.now() - warmupStartedAt;
    if (elapsed > WARMUP_TIMEOUT_MS) {
      clearInterval(warmupInterval);
      return;
    }
    void refresh();
  }, WARMUP_POLL_MS);

  requestAnimationFrame(() => requestAnimationFrame(() => void refresh()));
}
