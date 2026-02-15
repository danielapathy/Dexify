/**
 * Mobile UI controller.
 * Wires bottom-nav, library drawer, full-screen player, and
 * platform detection for Capacitor / narrow viewports.
 */

// ── Platform detection ───────────────────────────────

const isCapacitor = typeof window.Capacitor !== "undefined";
const isNarrow = () => window.innerWidth <= 600;

export function isMobile() {
  return document.documentElement.classList.contains("is-mobile");
}

export function applyMobileClass() {
  const root = document.documentElement;
  const force = isCapacitor || root.classList.contains("is-mobile-forced");
  root.classList.toggle("is-mobile", force || isNarrow());
  root.classList.toggle("is-capacitor", isCapacitor);
}

// ── Move chips into topbar on mobile ─────────────────

let chipsOriginalParent = null;
let chipsOriginalNextSibling = null;

function moveChipsToTopbar() {
  const chips = document.querySelector("#mainViewHome .chips");
  const topbar = document.querySelector(".topbar");
  if (!chips || !topbar) return;

  // Remember original position so we can restore on desktop
  if (!chipsOriginalParent) {
    chipsOriginalParent = chips.parentElement;
    chipsOriginalNextSibling = chips.nextElementSibling;
  }

  // Move chips into topbar
  topbar.appendChild(chips);
}

function restoreChipsFromTopbar() {
  const chips = document.querySelector(".topbar .chips");
  if (!chips || !chipsOriginalParent) return;

  // Put chips back in its original position inside the home view
  if (chipsOriginalNextSibling) {
    chipsOriginalParent.insertBefore(chips, chipsOriginalNextSibling);
  } else {
    chipsOriginalParent.appendChild(chips);
  }
}

// ── Bottom navigation ────────────────────────────────

function wireBottomNav() {
  const nav = document.getElementById("mobileNav");
  if (!nav) return;

  const items = Array.from(nav.querySelectorAll("[data-mobile-nav]"));

  nav.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mobile-nav]");
    if (!btn) return;

    const target = btn.dataset.mobileNav;

    if (target === "library") {
      openLibraryDrawer();
      return;
    }

    // Update active state
    for (const item of items) {
      item.classList.toggle("is-active", item === btn);
    }

    if (target === "home") {
      window.__spotifyNav?.navigate?.({ name: "home", scrollTop: 0 });
    } else if (target === "search") {
      window.__spotifyNav?.navigate?.({ name: "search", scrollTop: 0 });
      // Focus the search input after navigation
      setTimeout(() => {
        const input = document.getElementById("topSearchInput");
        if (input && isMobile()) input.focus();
      }, 100);
    }
  });
}

// ── Library drawer ───────────────────────────────────

function openLibraryDrawer() {
  const drawer = document.getElementById("mobileLibraryDrawer");
  if (!drawer) return;

  // Clone library items into the drawer
  syncLibraryDrawerItems();

  drawer.classList.add("is-open");
}

function closeLibraryDrawer() {
  const drawer = document.getElementById("mobileLibraryDrawer");
  if (!drawer) return;
  drawer.classList.remove("is-open");
}

function syncLibraryDrawerItems() {
  const source = document.getElementById("libraryList");
  const target = document.getElementById("mobileLibraryList");
  if (!source || !target) return;

  // Clone all library items
  target.innerHTML = "";
  const items = source.querySelectorAll(".library-item");
  for (const item of items) {
    const clone = item.cloneNode(true);
    // Forward clicks to the original item's route
    clone.addEventListener("click", (e) => {
      e.preventDefault();
      closeLibraryDrawer();
      // Trigger the same navigation as the original
      item.click();
    });
    target.appendChild(clone);
  }
}

function wireLibraryDrawer() {
  const drawer = document.getElementById("mobileLibraryDrawer");
  const closeBtn = document.getElementById("mobileLibraryClose");
  if (!drawer) return;

  if (closeBtn) {
    closeBtn.addEventListener("click", closeLibraryDrawer);
  }

  // Close when tapping the backdrop
  drawer.addEventListener("click", (e) => {
    if (e.target === drawer) closeLibraryDrawer();
  });
}

// ── Mini player → full-screen player ─────────────────

function wireFullScreenPlayer() {
  const miniPlayer = document.querySelector(".player");
  const fullPlayer = document.getElementById("mobilePlayerFull");
  const dismissBtn = document.getElementById("mobilePlayerDismiss");

  if (!miniPlayer || !fullPlayer) return;

  // Tap mini player to open full player
  miniPlayer.addEventListener("click", (e) => {
    if (!isMobile()) return;
    // Don't open if user tapped a control button
    if (e.target.closest("button, input, .play-btn")) return;
    openFullPlayer();
  });

  if (dismissBtn) {
    dismissBtn.addEventListener("click", closeFullPlayer);
  }

  // Sync play/pause from full player
  const fullPlayBtn = document.getElementById("mobilePlayerPlayBtn");
  const mainPlayBtn = document.getElementById("playerPlayBtn");
  if (fullPlayBtn && mainPlayBtn) {
    fullPlayBtn.addEventListener("click", () => {
      mainPlayBtn.click();
    });
  }

  // Sync prev/next
  const fullPrev = document.getElementById("mobilePlayerPrev");
  const fullNext = document.getElementById("mobilePlayerNext");
  const mainPrev = document.getElementById("playerPrevBtn");
  const mainNext = document.getElementById("playerNextBtn");

  if (fullPrev && mainPrev) fullPrev.addEventListener("click", () => mainPrev.click());
  if (fullNext && mainNext) fullNext.addEventListener("click", () => mainNext.click());

  // Forward like button to the main player's like button
  const fullLikeBtn = document.getElementById("mobilePlayerLikeBtn");
  const mainLikeBtn = document.getElementById("playerLikeBtn");
  if (fullLikeBtn && mainLikeBtn) {
    fullLikeBtn.addEventListener("click", () => mainLikeBtn.click());
  }

  // Instantly sync icon state when the main player's buttons change
  // (instead of waiting for the 500ms polling interval)
  if (mainPlayBtn) {
    const playObserver = new MutationObserver(() => syncFullPlayerState());
    playObserver.observe(mainPlayBtn, { attributes: true, attributeFilter: ["data-play"] });
    const playIcon = mainPlayBtn.querySelector('[data-icon="playpause"]');
    if (playIcon) playObserver.observe(playIcon, { attributes: true, attributeFilter: ["class"] });
  }
  if (mainLikeBtn) {
    const likeIcon = mainLikeBtn.querySelector("i");
    if (likeIcon) {
      const likeObserver = new MutationObserver(() => syncFullPlayerState());
      likeObserver.observe(likeIcon, { attributes: true, attributeFilter: ["class"] });
    }
  }
}

function openFullPlayer() {
  const fullPlayer = document.getElementById("mobilePlayerFull");
  if (!fullPlayer) return;

  syncFullPlayerState();
  fullPlayer.classList.add("is-open");
}

function closeFullPlayer() {
  const fullPlayer = document.getElementById("mobilePlayerFull");
  if (!fullPlayer) return;
  fullPlayer.classList.remove("is-open");
}

/**
 * Upscale a Deezer CDN cover URL to a larger size for the full-screen player.
 * e.g. .../250x250-000000-80-0-0.jpg → .../800x800-000000-80-0-0.jpg
 */
function upscaleCoverUrl(url, size = 800) {
  if (!url || typeof url !== "string") return url;
  return url.replace(/\/\d+x\d+(?=-\d)/, `/${size}x${size}`);
}

/** Copy current track info from the main player to the full-screen player. */
export function syncFullPlayerState() {
  const fields = [
    ["playerTitle", "mobilePlayerTitle", "textContent"],
    ["playerArtist", "mobilePlayerArtist", "textContent"],
    ["playerTimeCurrent", "mobilePlayerTimeCurrent", "textContent"],
    ["playerTimeTotal", "mobilePlayerTimeTotal", "textContent"],
  ];

  for (const [srcId, dstId, prop] of fields) {
    const src = document.getElementById(srcId);
    const dst = document.getElementById(dstId);
    if (src && dst) {
      try {
        dst[prop] = src[prop];
      } catch {}
    }
  }

  // Use HD cover art for the full-screen player
  const srcCover = document.getElementById("playerCover");
  const dstCover = document.getElementById("mobilePlayerCover");
  if (srcCover && dstCover && srcCover.src) {
    const hdSrc = upscaleCoverUrl(srcCover.src);
    if (dstCover.src !== hdSrc) dstCover.src = hdSrc;
  }

  // Sync seek bar
  const mainSeek = document.getElementById("playerSeek");
  const fullSeek = document.getElementById("mobilePlayerSeek");
  if (mainSeek && fullSeek) {
    fullSeek.max = mainSeek.max;
    fullSeek.value = mainSeek.value;
    const pct = mainSeek.max > 0 ? (mainSeek.value / mainSeek.max) * 100 : 0;
    fullSeek.style.setProperty("--pct", `${pct}%`);
  }

  // Sync play/pause icon state
  const mainPlayBtn = document.getElementById("playerPlayBtn");
  const fullPlayBtn = document.getElementById("mobilePlayerPlayBtn");
  if (mainPlayBtn && fullPlayBtn) {
    const playing = mainPlayBtn.dataset.play === "playing";
    fullPlayBtn.dataset.play = playing ? "playing" : "paused";
    const fullIcon = fullPlayBtn.querySelector('[data-icon="playpause"]');
    if (fullIcon) {
      fullIcon.classList.toggle("ri-play-fill", !playing);
      fullIcon.classList.toggle("ri-pause-fill", playing);
    }
  }

  // Sync like icon state
  const mainLikeBtn = document.getElementById("playerLikeBtn");
  const fullLikeBtn = document.getElementById("mobilePlayerLikeBtn");
  if (mainLikeBtn && fullLikeBtn) {
    const mainIcon = mainLikeBtn.querySelector("i");
    const fullIcon = fullLikeBtn.querySelector('[data-icon="like"]');
    if (mainIcon && fullIcon) {
      const liked = mainIcon.classList.contains("ri-heart-fill");
      fullIcon.classList.toggle("ri-heart-fill", liked);
      fullIcon.classList.toggle("ri-heart-line", !liked);
    }
  }
}

// ── Periodic sync for full player ────────────────────

let syncInterval = null;

function startFullPlayerSync() {
  if (syncInterval) return;
  syncInterval = setInterval(() => {
    const fp = document.getElementById("mobilePlayerFull");
    if (fp?.classList.contains("is-open")) {
      syncFullPlayerState();
    }
  }, 500);
}

// ── Resize handler ───────────────────────────────────

function syncMobileLayout() {
  if (isMobile()) {
    moveChipsToTopbar();
  } else {
    restoreChipsFromTopbar();
  }
}

function wireResizeHandler() {
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyMobileClass();
      syncMobileLayout();
      // Close mobile-specific overlays if switching to desktop
      if (!isMobile()) {
        closeLibraryDrawer();
        closeFullPlayer();
      }
    }, 150);
  });
}

// ── Sync bottom-nav active state with navigation ─────

function wireNavSync() {
  // Listen for custom navigation events the app fires
  const observer = new MutationObserver(() => {
    if (!isMobile()) return;

    const nav = document.getElementById("mobileNav");
    if (!nav) return;

    const items = Array.from(nav.querySelectorAll("[data-mobile-nav]"));
    const homeView = document.getElementById("mainViewHome");
    const searchView = document.getElementById("mainViewSearch");

    let active = "home";
    if (searchView && !searchView.hidden) active = "search";
    else if (homeView && !homeView.hidden) active = "home";

    for (const item of items) {
      item.classList.toggle("is-active", item.dataset.mobileNav === active);
    }
  });

  const mainScroll = document.querySelector(".main__scroll");
  if (mainScroll) {
    observer.observe(mainScroll, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  }
}

// ── Dev toggle: Ctrl+Shift+M to toggle mobile preview ──

function wireDevToggle() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === "M") {
      e.preventDefault();
      const root = document.documentElement;
      const enabling = !root.classList.contains("is-mobile");
      root.classList.toggle("is-mobile", enabling);
      root.classList.toggle("is-desktop-forced", !enabling);
      console.log(`[mobile] preview ${enabling ? "ON" : "OFF"} (Ctrl+Shift+M)`);
      syncMobileLayout();

      // Resize the Electron window to phone portrait / restore to desktop
      if (window.mobilePreview) {
        if (enabling) {
          window.mobilePreview.enable().catch(() => {});
        } else {
          window.mobilePreview.disable().catch(() => {});
        }
      }
    }
  });
}

// ── Drag-to-scroll for horizontal containers ─────────
//
// Touch / pen → native scroll via CSS overflow-x: auto
// Mouse       → JS drag handler (for desktop mobile-preview)

function wireDragScroll() {
  const root = document.querySelector(".main__scroll") || document.body;
  if (!root) return;

  function enableDrag(el) {
    if (!el || el.dataset.dragScroll === "1") return;
    el.dataset.dragScroll = "1";

    console.log("[dragScroll] enableDrag", el.className, {
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX,
    });

    // Prevent native link/image drag from stealing pointer events
    el.addEventListener("dragstart", (e) => e.preventDefault());

    let pointerId = -1;
    let startX = 0;
    let scrollStart = 0;
    let hasMoved = false;

    // Pointer-based drag — only for real mouse.
    // Touch / pen scrolls natively via overflow-x: auto.
    el.addEventListener("pointerdown", (e) => {
      // Let touch & pen use native scroll
      if (e.pointerType !== "mouse") return;
      if (e.button !== 0) return;
      if (el.scrollWidth <= el.clientWidth + 2) return;

      pointerId = e.pointerId;
      hasMoved = false;
      startX = e.clientX;
      scrollStart = el.scrollLeft;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = "grabbing";
      el.style.scrollBehavior = "auto";
      el.style.userSelect = "none";
      el.style.webkitUserSelect = "none";
      e.preventDefault();
      console.log("[dragScroll] pointerdown (mouse)", { startX, scrollStart, scrollW: el.scrollWidth, clientW: el.clientWidth });
    });

    el.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) hasMoved = true;
      el.scrollLeft = scrollStart - dx;
    });

    el.addEventListener("pointerup", (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = -1;
      el.style.cursor = "";
      el.style.scrollBehavior = "";
      el.style.userSelect = "";
      el.style.webkitUserSelect = "";
    });

    el.addEventListener("pointercancel", (e) => {
      if (e.pointerId !== pointerId) return;
      pointerId = -1;
      el.style.cursor = "";
      el.style.scrollBehavior = "";
      el.style.userSelect = "";
      el.style.webkitUserSelect = "";
    });

    // Prevent click on links/cards after a drag
    el.addEventListener("click", (e) => {
      if (hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        hasMoved = false;
      }
    }, true);
  }

  // Enable drag on all current and future carousels + chips
  function scanAndEnable(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches?.(".carousel")) enableDrag(node);
    if (node.matches?.(".chips")) enableDrag(node);
    const els = node.querySelectorAll ? node.querySelectorAll(".carousel, .chips") : [];
    for (const el of els) enableDrag(el);
  }

  scanAndEnable(root);
  // Also scan topbar for chips that were moved there
  scanAndEnable(document.querySelector(".topbar"));

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes || []) scanAndEnable(n);
    }
  });
  obs.observe(root, { childList: true, subtree: true });
}

// ── Chips fade based on scroll position ──────────────

function wireChipsFade() {
  function updateFade(chips) {
    if (!chips) return;
    const max = Math.max(0, chips.scrollWidth - chips.clientWidth);
    const x = chips.scrollLeft;
    chips.classList.toggle("can-scroll-left", x > 2);
    chips.classList.toggle("can-scroll-right", x < max - 2);
  }

  function attach(chips) {
    if (!chips || chips.dataset.chipsFade === "1") return;
    chips.dataset.chipsFade = "1";

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; updateFade(chips); });
    };

    chips.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    if ("ResizeObserver" in window) new ResizeObserver(schedule).observe(chips);
    schedule();
  }

  // Attach to any chips currently in topbar
  const chips = document.querySelector(".topbar > .chips");
  if (chips) attach(chips);

  // Watch for chips being moved into topbar later
  const topbar = document.querySelector(".topbar");
  if (topbar) {
    new MutationObserver(() => {
      const c = topbar.querySelector(".chips");
      if (c) attach(c);
    }).observe(topbar, { childList: true });
  }
}

// ── Public init ──────────────────────────────────────

export function wireMobile() {
  applyMobileClass();
  syncMobileLayout();
  wireResizeHandler();
  wireBottomNav();
  wireLibraryDrawer();
  wireFullScreenPlayer();
  wireNavSync();
  startFullPlayerSync();
  wireDevToggle();
  wireDragScroll();
  wireChipsFade();
}
