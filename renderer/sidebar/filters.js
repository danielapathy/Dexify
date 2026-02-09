export function wireLibraryFilters() {
  const filterButtons = Array.from(document.querySelectorAll(".library__filters .pill[data-filter]"));
  if (filterButtons.length === 0) return;

  const list = document.getElementById("libraryList") || document.querySelector(".library__list");
  if (!list) return;
  const rail = document.querySelector("[data-library-filters-rail]");
  const viewport = document.querySelector("[data-library-filters-viewport]");
  const prevBtn = rail?.querySelector?.('[data-library-filters-nav="prev"]') || null;
  const nextBtn = rail?.querySelector?.('[data-library-filters-nav="next"]') || null;

  const pinnedRoutes = new Set(["liked", "downloads"]);
  const FILTER_KEY = "spotify.libraryFilter";

  const isValidFilter = (filter) => {
    const f = String(filter || "");
    if (!f) return false;
    return filterButtons.some((b) => b.dataset.filter === f);
  };

  const applyFilter = (filter) => {
    const activeFilter = isValidFilter(filter) ? String(filter) : "all";
    for (const button of filterButtons) {
      const isActive = button.dataset.filter === activeFilter;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    }
    try {
      localStorage.setItem(FILTER_KEY, activeFilter);
    } catch {}

    const items = Array.from(list.querySelectorAll(".library-item[data-category]"));
    let firstVisible = null;
    for (const item of items) {
      const route = String(item.dataset.route || "");
      const shouldShow =
        pinnedRoutes.has(route) ||
        activeFilter === "all" ||
        (activeFilter && item.dataset.category === activeFilter);
      item.hidden = !shouldShow;
      if (shouldShow && !firstVisible) firstVisible = item;
    }

    if (firstVisible) {
      for (const item of items) item.classList.toggle("is-active", item === firstVisible);
    }
  };

  for (const button of filterButtons) {
    button.addEventListener("click", () => applyFilter(button.dataset.filter));
  }

  const updateOverflowState = () => {
    const root = rail && rail.nodeType === 1 ? rail : null;
    const scroller = viewport && viewport.nodeType === 1 ? viewport : null;
    if (!root || !scroller) return;

    const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    const left = Math.max(0, Number(scroller.scrollLeft) || 0);
    const right = Math.max(0, max - left);
    const hasOverflow = max > 2;
    const canLeft = hasOverflow && left > 2;
    const canRight = hasOverflow && right > 2;

    root.classList.toggle("is-overflowing", hasOverflow);
    root.classList.toggle("can-scroll-left", canLeft);
    root.classList.toggle("can-scroll-right", canRight);
  };

  const scrollFilters = (dir) => {
    const scroller = viewport && viewport.nodeType === 1 ? viewport : null;
    if (!scroller) return;
    const distance = Math.max(120, Math.round(scroller.clientWidth * 0.72));
    const next = Math.max(0, (Number(scroller.scrollLeft) || 0) + distance * dir);
    scroller.scrollTo({ left: next, behavior: "smooth" });
  };

  prevBtn?.addEventListener?.("click", () => scrollFilters(-1));
  nextBtn?.addEventListener?.("click", () => scrollFilters(1));
  viewport?.addEventListener?.("scroll", () => updateOverflowState(), { passive: true });
  window.addEventListener("resize", () => updateOverflowState());

  const stored = (() => {
    try {
      return String(localStorage.getItem(FILTER_KEY) || "");
    } catch {
      return "";
    }
  })();
  const initial =
    (isValidFilter(stored) && stored) ||
    filterButtons.find((b) => b.classList.contains("is-active"))?.dataset.filter ||
    "all";
  applyFilter(initial);
  requestAnimationFrame(() => updateOverflowState());
}
