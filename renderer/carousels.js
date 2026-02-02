function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function makeNavButton(direction) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `carousel-nav carousel-nav--${direction}`;
  btn.setAttribute("aria-label", direction === "left" ? "Scroll left" : "Scroll right");
  btn.innerHTML = direction === "left"
    ? '<i class="ri-arrow-left-s-line icon" aria-hidden="true"></i>'
    : '<i class="ri-arrow-right-s-line icon" aria-hidden="true"></i>';
  return btn;
}

function enhanceCarousel(carousel) {
  if (!carousel || carousel.nodeType !== 1) return;
  if (carousel.dataset.carouselEnhanced === "1") return;
  carousel.dataset.carouselEnhanced = "1";

  const wrapper = document.createElement("div");
  wrapper.className = "carousel-wrap";

  const parent = carousel.parentNode;
  if (!parent) return;
  parent.insertBefore(wrapper, carousel);
  wrapper.appendChild(carousel);

  const leftBtn = makeNavButton("left");
  const rightBtn = makeNavButton("right");
  wrapper.appendChild(leftBtn);
  wrapper.appendChild(rightBtn);

  const scrollByAmount = (dir) => {
    const w = carousel.clientWidth || 0;
    const delta = Math.max(260, Math.round(w * 0.86));
    const next = carousel.scrollLeft + (dir === "left" ? -delta : delta);
    carousel.scrollTo({ left: clamp(next, 0, carousel.scrollWidth), behavior: "smooth" });
  };

  leftBtn.addEventListener("click", () => scrollByAmount("left"));
  rightBtn.addEventListener("click", () => scrollByAmount("right"));

  let raf = 0;
  const update = () => {
    raf = 0;
    const max = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
    const x = Math.max(0, Math.min(max, carousel.scrollLeft));
    const scrollable = max > 2;

    wrapper.classList.toggle("is-scrollable", scrollable);
    wrapper.classList.toggle("carousel-wrap--fade-left", scrollable && x > 4);
    wrapper.classList.toggle("carousel-wrap--fade-right", scrollable && x < max - 4);

    leftBtn.classList.toggle("is-hidden", !scrollable || x <= 4);
    rightBtn.classList.toggle("is-hidden", !scrollable || x >= max - 4);
  };

  const scheduleUpdate = () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  };

  carousel.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });

  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => scheduleUpdate());
    ro.observe(carousel);
    ro.observe(wrapper);
  }

  scheduleUpdate();
}

export function wireCarousels() {
  const root = document.querySelector(".main__scroll") || document.body;
  if (!root) return;

  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches?.(".carousel")) enhanceCarousel(node);
    const found = node.querySelectorAll ? Array.from(node.querySelectorAll(".carousel")) : [];
    for (const el of found) enhanceCarousel(el);
  };

  scan(root);

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes || []) scan(n);
    }
  });
  obs.observe(root, { childList: true, subtree: true });
}

