export function wireLibraryRecentsMenu({
  recentsBtn,
  getSortMode,
  getLibraryViewMode,
  applySortAndView,
  sortKey,
  viewKey,
} = {}) {
  const btn = recentsBtn && recentsBtn.nodeType === 1 ? recentsBtn : null;
  if (!btn) return null;
  if (document.getElementById("libraryRecentsMenu")) return document.getElementById("libraryRecentsMenu");

  const menu = document.createElement("div");
  menu.id = "libraryRecentsMenu";
  menu.className = "library-recents-menu";
  menu.hidden = true;
  menu.tabIndex = -1;
  document.body.appendChild(menu);

  // Register with global dropdown system
  if (!window.__dropdownMenus) window.__dropdownMenus = new Set();

  const closeAllDropdowns = (except) => {
    for (const closeFunc of window.__dropdownMenus) {
      if (closeFunc !== except) closeFunc();
    }
  };

  let isAnimating = false;

  const setOpen = (open) => {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      const rect = btn.getBoundingClientRect();
      const x = Math.round(rect.right - 260);
      const y = Math.round(rect.bottom + 10);
      menu.style.left = `${Math.max(12, x)}px`;
      menu.style.top = `${Math.max(12, y)}px`;
      menu.hidden = false;
      menu.classList.add("is-opening");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          menu.classList.remove("is-opening");
          menu.focus();
        });
      });
    } else {
      if (menu.hidden) return;
      isAnimating = true;
      menu.classList.add("is-closing");
      setTimeout(() => {
        menu.classList.remove("is-closing");
        menu.hidden = true;
        isAnimating = false;
      }, 150);
    }
  };

  const isOpen = () => !menu.hidden && !isAnimating;

  const close = () => setOpen(false);
  window.__dropdownMenus.add(close);

  const renderMenu = () => {
    const sort = typeof getSortMode === "function" ? getSortMode() : "recent";
    const view = typeof getLibraryViewMode === "function" ? getLibraryViewMode() : "default";
    menu.innerHTML = `
      <div class="library-recents-menu__section">
        <div class="library-recents-menu__label">Sort by</div>
        <button type="button" class="library-recents-menu__item${sort === "recent" ? " is-active" : ""}" data-sort="recent">
          <span>Recents</span>
          <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
        </button>
        <button type="button" class="library-recents-menu__item${sort === "recently-added" ? " is-active" : ""}" data-sort="recently-added">
          <span>Recently added</span>
          <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
        </button>
        <button type="button" class="library-recents-menu__item${sort === "alpha" ? " is-active" : ""}" data-sort="alpha">
          <span>Alphabetical</span>
          <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
        </button>
        <button type="button" class="library-recents-menu__item${sort === "creator" ? " is-active" : ""}" data-sort="creator">
          <span>Creator</span>
          <i class="ri-check-line library-recents-menu__check" aria-hidden="true"></i>
        </button>
      </div>
      <div class="library-recents-menu__sep" aria-hidden="true"></div>
      <div class="library-recents-menu__section">
        <div class="library-recents-menu__label">View as</div>
        <div class="library-recents-menu__viewRow" role="group" aria-label="View as">
          <button type="button" class="library-recents-menu__iconBtn${view === "compact" ? " is-active" : ""}" data-view="compact" data-tooltip="Compact" aria-label="Compact">
            <i class="ri-menu-line" aria-hidden="true"></i>
          </button>
          <button type="button" class="library-recents-menu__iconBtn${view === "default" ? " is-active" : ""}" data-view="default" data-tooltip="Default List" aria-label="Default List">
            <i class="ri-list-check-2" aria-hidden="true"></i>
          </button>
          <button type="button" class="library-recents-menu__iconBtn${view === "compact-grid" ? " is-active" : ""}" data-view="compact-grid" data-tooltip="Compact Grid" aria-label="Compact Grid">
            <i class="ri-grid-line" aria-hidden="true"></i>
          </button>
          <button type="button" class="library-recents-menu__iconBtn${view === "default-grid" ? " is-active" : ""}" data-view="default-grid" data-tooltip="Default Grid" aria-label="Default Grid">
            <i class="ri-layout-grid-line" aria-hidden="true"></i>
          </button>
        </div>
      </div>
    `;
  };

  renderMenu();

  menu.addEventListener("click", (event) => {
    const btn2 = event.target?.closest?.("button");
    if (!btn2) return;
    const s = btn2.dataset.sort;
    const v = btn2.dataset.view;
    if (s) {
      try {
        localStorage.setItem(String(sortKey || ""), s);
      } catch {}
      applySortAndView?.();
      renderMenu();
      return;
    }
    if (v) {
      try {
        localStorage.setItem(String(viewKey || ""), v);
      } catch {}
      applySortAndView?.();
      renderMenu();
    }
  });

  document.addEventListener("click", (event) => {
    if (!isOpen()) return;
    if (menu.contains(event.target)) return;
    if (btn.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    if (event.key === "Escape") setOpen(false);
  });

  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isOpen()) {
      setOpen(false);
      return;
    }
    closeAllDropdowns(close);
    renderMenu();
    setOpen(true);
  });

  return menu;
}
