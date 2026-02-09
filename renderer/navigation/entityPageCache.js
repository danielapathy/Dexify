function isElement(node) {
  return Boolean(node && node.nodeType === 1);
}

export function createEntityPageCache({ entityView, maxEntries = 12 } = {}) {
  const root = isElement(entityView) ? entityView : null;
  const MAX = Number.isFinite(maxEntries) && maxEntries > 0 ? Math.trunc(maxEntries) : 12;

  // key -> { key, root, tracks, accent, lastUsedAt, renderedAt, renderReq }
  const cache = new Map();
  let activeEntry = null;
  const leaveTimers = new WeakMap(); // root -> timeoutId

  const applyAccent = (entry) => {
    if (!root) return;
    try {
      if (entry?.accent) root.style.setProperty("--entity-accent", entry.accent);
      else root.style.removeProperty("--entity-accent");
    } catch {}
  };

  const evictIfNeeded = () => {
    if (cache.size <= MAX) return;
    const entries = Array.from(cache.values());
    entries.sort((a, b) => (a.lastUsedAt || 0) - (b.lastUsedAt || 0));
    for (const e of entries) {
      if (cache.size <= MAX) break;
      if (activeEntry && e.key === activeEntry.key) continue;
      try {
        e.root?.remove?.();
      } catch {}
      cache.delete(e.key);
    }
  };

  const mountEntry = (entry) => {
    if (!root || !entry?.root) return;

    const prev = activeEntry?.root && activeEntry.root.isConnected ? activeEntry.root : null;
    const next = entry.root;
    if (prev === next) return;

    // If we’re reactivating a page that was mid-leave, cancel the pending removal and restore interactivity.
    const nextLeaveTimer = leaveTimers.get(next);
    if (nextLeaveTimer) {
      clearTimeout(nextLeaveTimer);
      leaveTimers.delete(next);
    }
    next.classList.remove("is-leaving");
    next.style.removeProperty("pointerEvents");

    applyAccent(entry);

    next.classList.add("entity-page");
    next.classList.add("is-enter");
    next.style.removeProperty("position");
    next.style.removeProperty("inset");
    next.style.pointerEvents = "auto";

    if (!next.isConnected) root.appendChild(next);

    // Animate old page out without affecting layout height.
    if (prev) {
      const prevLeaveTimer = leaveTimers.get(prev);
      if (prevLeaveTimer) {
        clearTimeout(prevLeaveTimer);
        leaveTimers.delete(prev);
      }
      prev.classList.add("is-leaving");
      prev.classList.remove("is-active");
      prev.style.position = "absolute";
      prev.style.inset = "0";
      prev.style.pointerEvents = "none";
      const t = setTimeout(() => {
        try {
          // If this page became active again, don’t tear it down.
          if (activeEntry?.root === prev) return;
          prev.classList.remove("is-leaving");
          prev.classList.remove("is-enter");
          prev.style.removeProperty("position");
          prev.style.removeProperty("inset");
          prev.style.removeProperty("pointerEvents");
          prev.remove();
        } catch {}
      }, 190);
      leaveTimers.set(prev, t);
    }

    requestAnimationFrame(() => {
      next.classList.remove("is-enter");
      next.classList.add("is-active");
    });

    entry.lastUsedAt = Date.now();
    activeEntry = entry;
    evictIfNeeded();
  };

  const ensureEntry = (key) => {
    const k = String(key || "");
    if (!k) return null;
    const existing = cache.get(k);
    if (existing) return existing;
    const pageRoot = document.createElement("div");
    const entry = { key: k, root: pageRoot, tracks: [], accent: null, lastUsedAt: Date.now(), renderedAt: 0, renderReq: 0 };
    cache.set(k, entry);
    evictIfNeeded();
    return entry;
  };

  const getActiveEntry = () => activeEntry;

  const setAccent = (entry, accent) => {
    const a = accent ? String(accent) : "";
    if (!entry) return;
    entry.accent = a ? a : null;
    if (activeEntry?.key === entry?.key) applyAccent(entry);
  };

  return { ensureEntry, mountEntry, getActiveEntry, setAccent };
}

