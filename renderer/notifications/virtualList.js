/**
 * Virtual list for efficiently rendering large lists.
 * Only renders items visible in the viewport plus a buffer.
 */
export function createVirtualList({
  container,
  itemHeight = 164,
  bufferCount = 5,
  onRenderItem,
  onRecycleItem,
}) {
  let items = [];
  let scrollContainer = null;
  let contentEl = null;
  let spacerTop = null;
  let spacerBottom = null;
  let renderedRange = { start: 0, end: 0 };
  let elementPool = new Map(); // index -> element
  let isCompact = false;
  let compactLimit = 10;

  const init = () => {
    container.innerHTML = "";
    container.style.position = "relative";

    spacerTop = document.createElement("div");
    spacerTop.className = "virtual-list__spacer-top";
    spacerTop.style.height = "0px";

    contentEl = document.createElement("div");
    contentEl.className = "virtual-list__content";

    spacerBottom = document.createElement("div");
    spacerBottom.className = "virtual-list__spacer-bottom";
    spacerBottom.style.height = "0px";

    container.appendChild(spacerTop);
    container.appendChild(contentEl);
    container.appendChild(spacerBottom);

    // Find the scroll container (main__scroll)
    scrollContainer = container.closest(".main__scroll");
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    }

    // Also listen to window resize
    window.addEventListener("resize", onScroll, { passive: true });
  };

  const getVisibleRange = () => {
    if (!scrollContainer) return { start: 0, end: Math.min(20, items.length) };

    const effectiveItems = isCompact ? Math.min(items.length, compactLimit) : items.length;
    if (effectiveItems === 0) return { start: 0, end: 0 };

    const containerRect = container.getBoundingClientRect();
    const scrollRect = scrollContainer.getBoundingClientRect();

    // Calculate visible area relative to container
    const visibleTop = Math.max(0, scrollRect.top - containerRect.top);
    const visibleBottom = Math.max(0, scrollRect.bottom - containerRect.top);

    const startIndex = Math.max(0, Math.floor(visibleTop / itemHeight) - bufferCount);
    const endIndex = Math.min(effectiveItems, Math.ceil(visibleBottom / itemHeight) + bufferCount);

    return { start: startIndex, end: endIndex };
  };

  const onScroll = () => {
    requestAnimationFrame(render);
  };

  const render = () => {
    const effectiveItems = isCompact ? Math.min(items.length, compactLimit) : items.length;
    const totalHeight = effectiveItems * itemHeight;
    const { start, end } = getVisibleRange();

    // Update spacers
    spacerTop.style.height = `${start * itemHeight}px`;
    spacerBottom.style.height = `${Math.max(0, (effectiveItems - end) * itemHeight)}px`;

    // Remove elements outside the new range
    for (const [index, el] of elementPool.entries()) {
      if (index < start || index >= end) {
        if (onRecycleItem) onRecycleItem(el, items[index], index);
        el.remove();
        elementPool.delete(index);
      }
    }

    // Add elements in the new range
    const fragment = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      if (!elementPool.has(i) && items[i]) {
        const el = onRenderItem(items[i], i);
        if (el) {
          el.dataset.virtualIndex = String(i);
          elementPool.set(i, el);
          fragment.appendChild(el);
        }
      }
    }

    if (fragment.childNodes.length > 0) {
      contentEl.appendChild(fragment);
    }

    // Sort elements by index for correct visual order
    const sortedEls = Array.from(elementPool.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, el]) => el);

    for (const el of sortedEls) {
      if (el.parentNode === contentEl) {
        contentEl.appendChild(el);
      }
    }

    renderedRange = { start, end };
  };

  const setItems = (newItems) => {
    items = Array.isArray(newItems) ? newItems : [];
    render();
  };

  const setCompact = (compact, limit = 10) => {
    isCompact = compact;
    compactLimit = limit;
    render();
  };

  const getItemCount = () => items.length;
  const hasMore = () => items.length > compactLimit;

  const refresh = () => {
    render();
  };

  const destroy = () => {
    if (scrollContainer) {
      scrollContainer.removeEventListener("scroll", onScroll);
    }
    window.removeEventListener("resize", onScroll);
    elementPool.clear();
    container.innerHTML = "";
  };

  // Get element by item (for updates)
  const getElementByIndex = (index) => elementPool.get(index);

  // Update a specific item
  const updateItem = (index, item) => {
    if (index >= 0 && index < items.length) {
      items[index] = item;
      const el = elementPool.get(index);
      if (el && onRenderItem) {
        // Re-render this specific item
        const newEl = onRenderItem(item, index);
        if (newEl && el.parentNode) {
          newEl.dataset.virtualIndex = String(index);
          el.parentNode.replaceChild(newEl, el);
          elementPool.set(index, newEl);
        }
      }
    }
  };

  init();

  return {
    setItems,
    setCompact,
    getItemCount,
    hasMore,
    refresh,
    destroy,
    getElementByIndex,
    updateItem,
    getItems: () => items,
  };
}
