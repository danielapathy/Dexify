import { formatFansCountText } from "../utils.js";
import { buildDeezerImageUrl, cleanTargetToPage, isFlowSectionTitle } from "../deezerImages.js";
import { renderPageSkeleton } from "../skeletons.js";

function isFn(fn) {
  return typeof fn === "function";
}

export function createPageRenderer({ entityCache, renderEmptyText } = {}) {
  const renderEmpty = isFn(renderEmptyText) ? renderEmptyText : () => {};
  const cache = entityCache && typeof entityCache === "object" ? entityCache : null;

  const renderPageInto = async (container, route, entry) => {
    const el = container && container.nodeType === 1 ? container : null;
    if (!el) return true;

    el.innerHTML = "";
    renderPageSkeleton(el, { sections: 3, cardsPerSection: 10 });
    cache?.setAccent?.(entry, null);

    const page = cleanTargetToPage(route?.page);
    const title = String(route?.title || page || "Page");
    if (!page) {
      renderEmpty(el, "Invalid page.");
      return true;
    }

    if (!window.__authHasARL) {
      renderEmpty(el, "Log in to browse pages.");
      return true;
    }

    if (!window.dz?.getPage) {
      renderEmpty(el, "Page views are available in Electron only (missing window.dz).");
      return true;
    }

    const thisReq = (entry.renderReq = Number(entry?.renderReq || 0) + 1);
    try {
      const res = await window.dz.getPage({ page });
      if (entry?.renderReq !== thisReq) return false;
      if (!res?.ok) {
        const e = res?.error
          ? `${String(res.error)}${res?.message ? `: ${String(res.message)}` : ""}`
          : String(res?.message || "unknown");
        renderEmpty(el, "Failed to load (" + String(e) + ").");
        return true;
      }

      const gw = res.result && typeof res.result === "object" ? res.result : {};
      const results =
        gw?.results && typeof gw.results === "object"
          ? gw.results
          : gw?.RESULTS && typeof gw.RESULTS === "object"
            ? gw.RESULTS
            : gw;
      const sections =
        (Array.isArray(results?.sections) && results.sections) ||
        (Array.isArray(results?.SECTIONS) && results.SECTIONS) ||
        (Array.isArray(gw?.sections) && gw.sections) ||
        (Array.isArray(gw?.SECTIONS) && gw.SECTIONS) ||
        [];

      el.innerHTML = "";

      const header = document.createElement("div");
      header.className = "entity-header";

      const coverEl = document.createElement("div");
      coverEl.className = "entity-cover";
      coverEl.style.background = "rgba(255, 255, 255, 0.08)";
      coverEl.innerHTML =
        '<div style="height:100%;display:grid;place-items:center;"><i class="ri-compass-3-line" style="font-size:44px;color:rgba(255,255,255,0.84)"></i></div>';

      const meta = document.createElement("div");
      meta.className = "entity-meta";
      const h1 = document.createElement("div");
      h1.className = "entity-title";
      h1.textContent = title || "Explore";
      const sub = document.createElement("div");
      sub.className = "entity-subtitle";
      sub.textContent = "Explore";
      meta.appendChild(h1);
      meta.appendChild(sub);

      header.appendChild(coverEl);
      header.appendChild(meta);
      el.appendChild(header);

      const pickItems = (sec) => {
        if (!sec || typeof sec !== "object") return [];
        if (Array.isArray(sec.items)) return sec.items;
        if (Array.isArray(sec.ITEMS)) return sec.ITEMS;
        const data = sec.data && typeof sec.data === "object" ? sec.data : null;
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data?.ITEMS)) return data.ITEMS;
        return [];
      };

      const renderPageSection = (sec) => {
        const secTitle = String(sec?.title || sec?.TITLE || "").trim();
        if (secTitle && isFlowSectionTitle(secTitle)) return;
        const items = pickItems(sec);
        if (items.length === 0) return;

        const section = document.createElement("section");
        section.className = "made-for";

        const header = document.createElement("div");
        header.className = "made-for__header";

        const titles = document.createElement("div");
        titles.className = "made-for__titles";
        const h2 = document.createElement("h2");
        h2.className = "h2 h2--small";
        h2.textContent = secTitle || "Explore";
        titles.appendChild(h2);
        header.appendChild(titles);
        section.appendChild(header);

        const carousel = document.createElement("div");
        carousel.className = "carousel";
        carousel.setAttribute("role", "list");

        for (const item of items.slice(0, 18)) {
          const a = document.createElement("a");
          a.className = "big-card";
          a.href = "#";
          a.setAttribute("role", "listitem");
          a.dataset.target = String(item?.target || item?.TARGET || item?.data?.target || item?.data?.TARGET || "");

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
          t.textContent = String(
            item?.title ||
              item?.TITLE ||
              item?.data?.SNG_TITLE ||
              item?.data?.ALB_TITLE ||
              item?.data?.title ||
              item?.data?.name ||
              "",
          );

          const subtitle = document.createElement("div");
          subtitle.className = "big-card__subtitle";
          subtitle.textContent = formatFansCountText(
            String(item?.subtitle || item?.SUBTITLE || item?.data?.ART_NAME || item?.data?.artist || ""),
          );

          a.appendChild(cover);
          a.appendChild(t);
          a.appendChild(subtitle);
          carousel.appendChild(a);
        }

        section.appendChild(carousel);
        el.appendChild(section);
      };

      for (const s of sections) renderPageSection(s);

      if (el.querySelectorAll(".made-for").length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = "Nothing to show here yet.";
        el.appendChild(empty);
      }

      if (entry) entry.tracks = [];
      return true;
    } catch (e) {
      if (entry?.renderReq !== thisReq) return false;
      renderEmpty(el, String(e?.message || e || "Failed to load"));
      return true;
    }
  };

  return { renderPageInto };
}

