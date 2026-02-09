function getGapPx(containerEl, fallbackPx = 12) {
  try {
    const cs = getComputedStyle(containerEl);
    const g = parseFloat(cs.gap || cs.columnGap || "0");
    return Number.isFinite(g) && g >= 0 ? g : fallbackPx;
  } catch {
    return fallbackPx;
  }
}

export function createPlayerMetaFit({
  rootEl,
  leftEl,
  metaEl,
  coverEl,
  likeBtn,
  titleEl,
  artistEl,
} = {}) {
  const root = rootEl && rootEl.nodeType === 1 ? rootEl : null;
  const left = leftEl && leftEl.nodeType === 1 ? leftEl : null;
  const meta = metaEl && metaEl.nodeType === 1 ? metaEl : null;
  const cover = coverEl && coverEl.nodeType === 1 ? coverEl : null;
  const like = likeBtn && likeBtn.nodeType === 1 ? likeBtn : null;
  const title = titleEl && titleEl.nodeType === 1 ? titleEl : null;
  const artist = artistEl && artistEl.nodeType === 1 ? artistEl : null;

  const sync = () => {
    if (!root || !left || !meta) return;

    const leftRect = left.getBoundingClientRect();
    const coverRect = cover?.getBoundingClientRect?.();
    const likeRect = like?.getBoundingClientRect?.();

    const gap = getGapPx(left, 12);
    const paddingBuffer = 10; // keep a little breathing room between meta and the like button
    const maxW = (() => {
      if (coverRect && likeRect) {
        const usable = likeRect.left - coverRect.right - gap * 2 - paddingBuffer;
        return Math.max(120, Math.floor(usable));
      }
      const coverW = coverRect?.width || 56;
      const likeW = likeRect?.width || 34;
      return Math.max(120, Math.floor(leftRect.width - coverW - likeW - gap * 2 - paddingBuffer));
    })();
    meta.style.maxWidth = `${maxW}px`;

    const needsFade =
      (title && title.scrollWidth > title.clientWidth + 2) || (artist && artist.scrollWidth > artist.clientWidth + 2);
    meta.classList.toggle("is-fading", Boolean(needsFade));
  };

  const wire = () => {
    if (!root) return;
    try {
      if (typeof ResizeObserver === "function") {
        const ro = new ResizeObserver(() => sync());
        ro.observe(root);
        return () => {
          try {
            ro.disconnect();
          } catch {}
        };
      }
      const onResize = () => sync();
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    } catch {
      return null;
    }
  };

  return { sync, wire };
}

