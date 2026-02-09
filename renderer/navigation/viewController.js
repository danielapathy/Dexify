export function createViewController({ views, scrollEl, refreshAuthChrome, initialViewName }) {
  const viewHideTimers = new WeakMap();
  let currentView = "home";

  const cancelPendingHide = (el) => {
    const t = viewHideTimers.get(el);
    if (t) {
      clearTimeout(t);
      viewHideTimers.delete(el);
    }
  };

  const liftedViewState = new WeakMap(); // el -> { parent, nextSibling, ghostEl }
  const liftedViews = new Set(); // Elements currently moved into the transition layer.
  let viewTransitionLayer = null;

  const ensureViewTransitionLayer = () => {
    if (viewTransitionLayer && viewTransitionLayer.isConnected) return viewTransitionLayer;
    viewTransitionLayer = document.createElement("div");
    viewTransitionLayer.className = "view-transition-layer";
    viewTransitionLayer.hidden = true;
    scrollEl.appendChild(viewTransitionLayer);
    return viewTransitionLayer;
  };

  const liftViewForScrollReset = (el, { fromScrollTop, toScrollTop }) => {
    if (!el) return false;
    if (!el.isConnected) return false;

    const layer = ensureViewTransitionLayer();
    if (!layer) return false;

    // Position the overlay in the *target* viewport so it stays visible after we set scrollTop.
    layer.style.top = `${Math.max(0, Number(toScrollTop) || 0)}px`;
    layer.hidden = false;

    const ghost = document.createElement("div");
    ghost.className = "view-transition-layer__ghost";
    const delta = Number(fromScrollTop) - Number(toScrollTop);
    ghost.style.transform = `translateY(${-delta}px)`;
    layer.appendChild(ghost);

    liftedViewState.set(el, { parent: el.parentNode, nextSibling: el.nextSibling, ghostEl: ghost });
    liftedViews.add(el);
    ghost.appendChild(el);
    el.hidden = false;
    el.style.pointerEvents = "none";
    return true;
  };

  const restoreLiftedView = (el) => {
    const st = liftedViewState.get(el);
    if (!st) return;
    liftedViewState.delete(el);
    liftedViews.delete(el);

    try {
      el.style.removeProperty("pointerEvents");
    } catch {}

    try {
      const parent = st.parent;
      if (parent) parent.insertBefore(el, st.nextSibling);
    } catch {}

    try {
      st.ghostEl?.remove?.();
    } catch {}

    if (viewTransitionLayer && viewTransitionLayer.isConnected) {
      if (viewTransitionLayer.childElementCount === 0) {
        viewTransitionLayer.hidden = true;
        viewTransitionLayer.style.removeProperty("top");
      }
    }
  };

  const restoreAllLiftedViews = () => {
    if (liftedViews.size === 0) return;
    // Copy to avoid mutation during iteration.
    for (const el of Array.from(liftedViews)) restoreLiftedView(el);
  };

  const init = () => {
    // Ensure first paint reflects the initial route (avoid a "home flash" before we render history[0]).
    const initialName = String(initialViewName || "home");
    for (const [name, el] of Object.entries(views)) {
      if (!el) continue;
      el.hidden = name !== initialName;
    }

    // Initialize view classes so the first transition doesn't flash.
    for (const [name, el] of Object.entries(views)) {
      if (!el) continue;
      el.classList.add("view");
      if (el.hidden) el.classList.add("is-view-hidden");
      else {
        currentView = name;
        el.classList.add("is-view-active");
        el.classList.remove("is-view-hidden");
      }
    }
  };

  init();

  const showView = (name, { scrollTop } = {}) => {
    const nextName = String(name || "home");
    const nextEl = views[nextName];
    if (!nextEl) return;
    try {
      if (scrollEl) scrollEl.classList.toggle("is-signed-out", nextName === "signedOut");
    } catch {}
    refreshAuthChrome?.();
    const emitViewChanged = () => {
      try {
        window.dispatchEvent(new CustomEvent("nav:viewChanged", { detail: { name: nextName } }));
      } catch {}
    };
    // Never leave any view stuck inside the transition layer.
    restoreAllLiftedViews();
    if (currentView === nextName) {
      const wantsScroll = Number.isFinite(Number(scrollTop));
      const toScrollTop = wantsScroll ? Math.max(0, Number(scrollTop)) : null;
      if (wantsScroll && scrollEl) scrollEl.scrollTop = toScrollTop;
      cancelPendingHide(nextEl);
      nextEl.hidden = false;
      nextEl.classList.add("is-view-active");
      nextEl.classList.remove("is-view-hidden");
      emitViewChanged();
      return;
    }

    const prevEl = views[currentView];
    currentView = nextName;

    // If a view was previously "lifted" into the transition layer and then we navigate back to it
    // quickly, put it back before showing it again.
    restoreLiftedView(nextEl);
    if (prevEl) restoreLiftedView(prevEl);

    const wantsScroll = Number.isFinite(Number(scrollTop));
    const fromScrollTop = scrollEl ? Number(scrollEl.scrollTop) : 0;
    const toScrollTop = wantsScroll ? Math.max(0, Number(scrollTop)) : fromScrollTop;

    // Ensure all views have a consistent baseline class.
    for (const el of Object.values(views)) {
      if (!el) continue;
      el.classList.add("view");
    }

    // Fade out previous view (hide after transition).
    if (prevEl) {
      cancelPendingHide(prevEl);
      if (wantsScroll && scrollEl && Math.abs(fromScrollTop - toScrollTop) > 2) {
        liftViewForScrollReset(prevEl, { fromScrollTop, toScrollTop });
      }
      prevEl.classList.add("is-view-hidden");
      prevEl.classList.remove("is-view-active");
      const hideTimer = setTimeout(() => {
        restoreLiftedView(prevEl);
        prevEl.hidden = true;
        viewHideTimers.delete(prevEl);
      }, 340);
      viewHideTimers.set(prevEl, hideTimer);
    }

    if (wantsScroll && scrollEl) {
      scrollEl.scrollTop = toScrollTop;
    }

    // Fade in next view.
    cancelPendingHide(nextEl);
    nextEl.hidden = false;
    nextEl.style.pointerEvents = "auto";
    nextEl.classList.add("is-view-hidden");
    nextEl.classList.remove("is-view-active");
    requestAnimationFrame(() => {
      nextEl.classList.add("is-view-active");
      nextEl.classList.remove("is-view-hidden");
      emitViewChanged();
    });
  };

  return { showView, restoreAllLiftedViews, getCurrentView: () => currentView };
}
