function text(el) {
  return String(el?.textContent || "").trim();
}

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getShellMode() {
  try {
    return String(document.documentElement?.dataset?.shell || "");
  } catch {
    return "";
  }
}

function getActiveViewName() {
  const el = document.querySelector(".view.is-view-active");
  const id = String(el?.id || "");
  const map = {
    mainViewHome: "home",
    mainViewSignedOut: "signedOut",
    mainViewSearch: "search",
    mainViewEntity: "entity",
    mainViewNotifications: "notifications",
    mainViewSettings: "settings",
  };
  return map[id] || (id ? id : "unknown");
}

function sleep(ms) {
  const delay = Math.max(0, Math.min(5_000, Number(ms) || 0));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parsePlaylistIdFromTarget(target) {
  const s = String(target || "").trim();
  if (!s) return null;
  const match = s.match(/\/playlist\/(\d+)/i);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : null;
}

function snapshotHome({ recentsLimit = 8, sectionsLimit = 6, sectionItemsLimit = 10 } = {}) {
  const recents = Array.from(document.querySelectorAll("#quickGrid .quick-card"))
    .slice(0, recentsLimit)
    .map((a) => ({
      title: text(a.querySelector(".quick-card__title")),
      subtitle: text(a.querySelector(".quick-card__subtitle")),
      trackId: toInt(a.dataset.trackId),
      albumId: toInt(a.dataset.albumId),
      artistId: toInt(a.dataset.artistId),
    }));

  const sections = Array.from(document.querySelectorAll('[data-deezer-sections] section.made-for'))
    .slice(0, sectionsLimit)
    .map((sec) => {
      const title = text(sec.querySelector("h2"));
      const items = Array.from(sec.querySelectorAll(".carousel .big-card"))
        .slice(0, sectionItemsLimit)
        .map((card) => ({
          title: text(card.querySelector(".big-card__title")),
          subtitle: text(card.querySelector(".big-card__subtitle")),
          target: String(card.dataset.target || ""),
          albumId: toInt(card.dataset.albumId),
          artistId: toInt(card.dataset.artistId),
        }))
        .filter((x) => x.title || x.subtitle || x.target);
      return { title, items };
    })
    .filter((s) => s.title || (Array.isArray(s.items) && s.items.length > 0));

  return { ok: true, shellMode: getShellMode(), view: getActiveViewName(), recents, sections };
}

function snapshotLibrary({ limit = 80 } = {}) {
  const items = Array.from(document.querySelectorAll("#libraryList .library-item"))
    .filter((el) => !el.hidden && !el.classList.contains("is-hidden-by-search"))
    .slice(0, limit)
    .map((el) => ({
      title: text(el.querySelector(".library-item__title")),
      subtitle: text(el.querySelector(".library-item__subtitle")),
      category: String(el.dataset.category || ""),
      route: String(el.dataset.route || ""),
      entityType: String(el.dataset.entityType || ""),
      entityId: String(el.dataset.entityId || ""),
      trackId: toInt(el.dataset.trackId),
      isActive: el.classList.contains("is-active"),
    }));
  return { ok: true, shellMode: getShellMode(), items };
}

function snapshotNowPlaying() {
  const st = window.__player?.getState?.() || null;
  const t = st?.track && typeof st.track === "object" ? st.track : null;
  const download = t?.download && typeof t.download === "object" ? t.download : null;
  const ctx = st?.playContext && typeof st.playContext === "object" ? st.playContext : null;
  const coverEl = document.querySelector("#playerCover");
  return {
    ok: true,
    isPlaying: Boolean(st?.isPlaying),
    liked: Boolean(st?.liked),
    trackId: toInt(t?.id || t?.SNG_ID),
    title: String(t?.title || t?.SNG_TITLE || ""),
    artist: String(t?.artist?.name || t?.ART_NAME || t?.artist || ""),
    album: String(t?.album?.title || t?.ALB_TITLE || t?.albumTitle || ""),
    albumId: toInt(t?.album?.id || t?.ALB_ID),
    cover: String(t?.cover || "").trim() || null,
    albumCover: String(t?.album?.cover_medium || t?.album?.cover_small || "").trim() || null,
    playerCoverSrc: String(coverEl?.src || "").trim() || null,
    downloaded: Boolean(String(download?.fileUrl || "").trim()),
    quality: String(download?.quality || ""),
    playContext: ctx ? {
      type: String(ctx.type || ""),
      id: toInt(ctx.id),
      title: String(ctx.title || ""),
      cover: String(ctx.cover || "").trim() || null,
    } : null,
  };
}

function snapshotPage({ tracksLimit = 80, actionsLimit = 12 } = {}) {
  const view = getActiveViewName();
  if (view === "home") return snapshotHome();
  if (view !== "entity") return { ok: true, shellMode: getShellMode(), view };

  const header = document.querySelector(".entity-header");
  const title = text(header?.querySelector(".entity-title"));
  const subtitle = text(header?.querySelector(".entity-subtitle"));

  const actions = Array.from(document.querySelectorAll(".entity-actions button"))
    .slice(0, actionsLimit)
    .map((b) => ({
      action: String(b.dataset.action || ""),
      tooltip: String(b.dataset.tooltip || b.getAttribute("aria-label") || ""),
      disabled: b.getAttribute("aria-disabled") === "true" || b.classList.contains("is-disabled") || Boolean(b.disabled),
      hidden: Boolean(b.classList.contains("is-hidden") || b.hidden),
    }));

  const coverImg = header?.querySelector(".entity-cover img");
  const headerCover = String(coverImg?.src || "").trim() || null;

  const tracksAll = Array.from(document.querySelectorAll(".entity-track"));
  const tracks = tracksAll.slice(0, tracksLimit).map((row) => {
    const likeIcon = row.querySelector(".entity-track__like i");
    const trackCoverImg = row.querySelector(".entity-track__cover img");
    return {
      trackId: toInt(row.dataset.trackId),
      albumId: toInt(row.dataset.albumId),
      title: text(row.querySelector(".entity-track__title")),
      artist: text(row.querySelector(".entity-track__artist")),
      duration: text(row.querySelector(".entity-track__duration")),
      liked: likeIcon ? likeIcon.classList.contains("ri-heart-fill") : false,
      downloaded: String(row.dataset.downloaded || "") === "1",
      cover: String(trackCoverImg?.src || "").trim() || null,
    };
  });

  return {
    ok: true,
    shellMode: getShellMode(),
    view,
    header: { title, subtitle, cover: headerCover },
    actions,
    tracks,
    totalTracks: tracksAll.length,
    hasMoreTracks: tracksAll.length > tracks.length,
  };
}

function isReady() {
  return {
    ok: true,
    shellMode: getShellMode(),
    hasNav: Boolean(window.__spotifyNav?.navigate),
    hasPlayer: Boolean(window.__player?.getState),
    ready: getShellMode() === "app" && Boolean(window.__spotifyNav?.navigate),
    view: getActiveViewName(),
  };
}

function navigate({ route, options } = {}) {
  if (!window.__spotifyNav?.navigate) return { ok: false, error: "nav_not_ready" };
  window.__spotifyNav.navigate(route || { name: "home" }, options || undefined);
  return { ok: true };
}

function findBottomPlaylistByTitle({ title = "My Boy" } = {}) {
  const needle = normalizeText(title);
  if (!needle) return { ok: false, error: "bad_request" };

  const sections = Array.from(document.querySelectorAll('[data-deezer-sections] section.made-for'));
  if (sections.length === 0) return { ok: false, error: "sections_not_ready" };

  for (let sectionIndex = sections.length - 1; sectionIndex >= 0; sectionIndex -= 1) {
    const sectionEl = sections[sectionIndex];
    const sectionTitle = text(sectionEl.querySelector("h2"));
    const cards = Array.from(sectionEl.querySelectorAll(".carousel .big-card"));
    const playlistCards = cards
      .map((card, cardIndex) => ({
        sectionTitle,
        sectionIndex,
        cardIndex,
        title: text(card.querySelector(".big-card__title")),
        subtitle: text(card.querySelector(".big-card__subtitle")),
        target: String(card.dataset.target || ""),
      }))
      .map((card) => ({ ...card, playlistId: parsePlaylistIdFromTarget(card.target) }))
      .filter((card) => Boolean(card.playlistId));

    const match = playlistCards.find((card) => normalizeText(card.title) === needle);
    if (match) return { ok: true, match };
  }

  return { ok: false, error: "playlist_not_found" };
}

async function openBottomPlaylistByTitle({ title = "My Boy" } = {}) {
  const found = findBottomPlaylistByTitle({ title });
  if (!found?.ok) return found;

  const route = {
    name: "entity",
    entityType: "playlist",
    id: String(found.match.playlistId),
    scrollTop: 0,
  };
  const nav = navigate({ route });
  if (!nav?.ok) return nav;

  return { ok: true, match: found.match, route };
}

async function clickEntityAction({ action = "", tooltipContains = "", timeoutMs = 10_000 } = {}) {
  const byAction = String(action || "").trim();
  const byTooltip = normalizeText(tooltipContains);
  const timeout = Math.max(250, Math.min(120_000, Number(timeoutMs) || 10_000));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const buttons = Array.from(document.querySelectorAll(".entity-actions button"));
    const button = buttons.find((btn) => {
      const actionValue = String(btn.dataset.action || "");
      const tooltip = normalizeText(btn.dataset.tooltip || btn.getAttribute("aria-label") || "");
      if (byAction && actionValue === byAction) return true;
      if (byTooltip && tooltip.includes(byTooltip)) return true;
      return false;
    });

    const isEntity = getActiveViewName() === "entity";
    if (isEntity && button) {
      const disabled = button.disabled || button.getAttribute("aria-disabled") === "true" || button.classList.contains("is-disabled");
      if (!disabled) {
        button.click();
        return {
          ok: true,
          clicked: true,
          action: String(button.dataset.action || ""),
          tooltip: String(button.dataset.tooltip || button.getAttribute("aria-label") || ""),
        };
      }
      return {
        ok: true,
        clicked: false,
        disabled: true,
        action: String(button.dataset.action || ""),
        tooltip: String(button.dataset.tooltip || button.getAttribute("aria-label") || ""),
      };
    }

    await sleep(180);
  }

  return { ok: false, error: "timeout_waiting_for_action" };
}

async function downloadBottomPlaylistByTitle({ title = "My Boy", timeoutMs = 15_000 } = {}) {
  const timeout = Math.max(1_000, Math.min(120_000, Number(timeoutMs) || 15_000));
  const startedAt = Date.now();

  const routeHome = { name: "home", scrollTop: 0, refresh: true };
  navigate({ route: routeHome, options: { replace: true } });

  while (Date.now() - startedAt < timeout) {
    const home = snapshotHome({ sectionsLimit: 120, sectionItemsLimit: 40, recentsLimit: 12 });
    if (Array.isArray(home.sections) && home.sections.length > 0) break;
    await sleep(200);
  }

  const opened = await openBottomPlaylistByTitle({ title });
  if (!opened?.ok) return opened;

  const clickRes = await clickEntityAction({
    action: "entity-download",
    timeoutMs: Math.max(1_500, timeout - (Date.now() - startedAt)),
  });
  if (!clickRes?.ok) return clickRes;

  return { ok: true, match: opened.match, downloadAction: clickRes };
}

async function snapshotDownloadsLocal({ limitTracks = 250, limitPlaylists = 120 } = {}) {
  const tracksTake = Math.max(0, Math.min(2_000, Number(limitTracks) || 250));
  const playlistsTake = Math.max(0, Math.min(500, Number(limitPlaylists) || 120));

  const tracksRes =
    window.dl && typeof window.dl.listDownloads === "function"
      ? await window.dl.listDownloads().catch(() => ({ ok: false, error: "list_downloads_failed" }))
      : { ok: false, error: "dl_api_unavailable" };
  const playlistsRes =
    window.dl && typeof window.dl.listPlaylists === "function"
      ? await window.dl.listPlaylists().catch(() => ({ ok: false, error: "list_playlists_failed" }))
      : { ok: false, error: "dl_api_unavailable" };

  const tracks = Array.isArray(tracksRes?.tracks)
    ? tracksRes.tracks.slice(0, tracksTake).map((row) => ({
        trackId: toInt(row?.trackId || row?.track?.id || row?.track?.SNG_ID),
        title: String(row?.track?.title || row?.track?.SNG_TITLE || ""),
        artist: String(row?.track?.artist?.name || row?.track?.ART_NAME || ""),
        album: String(row?.track?.album?.title || row?.album?.title || ""),
        quality: String(row?.bestQuality || ""),
        fileSize: Number(row?.fileSize) || 0,
      }))
    : [];

  const playlists = Array.isArray(playlistsRes?.playlists)
    ? playlistsRes.playlists.slice(0, playlistsTake).map((row) => ({
        playlistId: toInt(row?.playlistId),
        title: String(row?.title || ""),
        downloaded: Number(row?.downloaded) || 0,
        total: Number(row?.total) || 0,
      }))
    : [];

  return {
    ok: true,
    tracks,
    playlists,
    tracksStatus: tracksRes?.ok === false ? tracksRes : { ok: true },
    playlistsStatus: playlistsRes?.ok === false ? playlistsRes : { ok: true },
  };
}

// ---------------------------------------------------------------------------
// Element tagging helpers
// ---------------------------------------------------------------------------

function describeRect(el) {
  try {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  } catch {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
}

function isElementVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.hidden) return false;
  try {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
  } catch {}
  const r = describeRect(el);
  return r.width > 0 && r.height > 0;
}

function isElementDisabled(el) {
  if (!el) return false;
  if (el.disabled) return true;
  if (el.getAttribute("aria-disabled") === "true") return true;
  if (el.classList.contains("is-disabled")) return true;
  return false;
}

function serializeElement(el, index) {
  const tag = String(el.dataset.dbg || "");
  const type = String(el.dataset.dbgType || "");
  const id = String(el.dataset.dbgId || "");
  const desc = String(el.dataset.dbgDesc || "");
  return {
    tag,
    type,
    id,
    desc,
    text: text(el),
    rect: describeRect(el),
    visible: isElementVisible(el),
    disabled: isElementDisabled(el),
    index: Number.isFinite(index) ? index : 0,
  };
}

function serializeElementDetailed(el, index) {
  const base = serializeElement(el, index);
  let computedStyles = {};
  try {
    const s = getComputedStyle(el);
    computedStyles = {
      color: s.color,
      backgroundColor: s.backgroundColor,
      opacity: s.opacity,
      overflow: s.overflow,
      display: s.display,
      visibility: s.visibility,
      position: s.position,
      zIndex: s.zIndex,
    };
  } catch {}
  return {
    ...base,
    computedStyles,
    classList: Array.from(el.classList),
    parentTag: String(el.parentElement?.dataset?.dbg || ""),
    childCount: el.children?.length || 0,
    tagName: String(el.tagName || "").toLowerCase(),
    ariaLabel: String(el.getAttribute("aria-label") || ""),
  };
}

function findTaggedElements({ tag, type, id, descContains, visibleOnly } = {}) {
  const all = Array.from(document.querySelectorAll("[data-dbg]"));
  const needle = descContains ? normalizeText(descContains) : "";
  const results = [];
  for (const el of all) {
    if (tag && el.dataset.dbg !== tag) continue;
    if (type && el.dataset.dbgType !== type) continue;
    if (id && el.dataset.dbgId !== id) continue;
    if (needle && !normalizeText(el.dataset.dbgDesc || "").includes(needle)) continue;
    if (visibleOnly && !isElementVisible(el)) continue;
    results.push(el);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Element Discovery API
// ---------------------------------------------------------------------------

function queryElements({ tag, type, id, descContains, visibleOnly, limit } = {}) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 200));
  const els = findTaggedElements({ tag, type, id, descContains, visibleOnly });
  const elements = els.slice(0, cap).map((el, i) => serializeElement(el, i));
  return { ok: true, elements, total: els.length };
}

function getElement({ tag, id, index } = {}) {
  if (!tag) return { ok: false, error: "tag_required" };
  const els = findTaggedElements({ tag, id });
  const idx = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
  const el = els[idx];
  if (!el) return { ok: false, error: "not_found" };
  return { ok: true, element: serializeElementDetailed(el, idx) };
}

// ---------------------------------------------------------------------------
// Element Interaction API
// ---------------------------------------------------------------------------

function clickElement({ tag, id, index, rightClick } = {}) {
  if (!tag) return { ok: false, error: "tag_required" };
  const els = findTaggedElements({ tag, id });
  const idx = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
  const el = els[idx];
  if (!el) return { ok: false, error: "not_found" };

  const desc = serializeElement(el, idx);
  if (rightClick) {
    const rect = el.getBoundingClientRect();
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const evt = new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2,
    });
    el.dispatchEvent(evt);
  } else {
    el.click();
  }
  return { ok: true, clicked: true, element: desc };
}

function typeIntoElement({ tag, id, index, text: inputText, clear } = {}) {
  if (!tag) return { ok: false, error: "tag_required" };
  const els = findTaggedElements({ tag, id });
  const idx = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
  const el = els[idx];
  if (!el) return { ok: false, error: "not_found" };
  if (typeof el.value === "undefined") return { ok: false, error: "not_an_input" };

  try { el.focus(); } catch {}
  if (clear) el.value = "";
  el.value = String(inputText || "");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return { ok: true, value: el.value };
}

function hoverElement({ tag, id, index } = {}) {
  if (!tag) return { ok: false, error: "tag_required" };
  const els = findTaggedElements({ tag, id });
  const idx = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
  const el = els[idx];
  if (!el) return { ok: false, error: "not_found" };

  const rect = el.getBoundingClientRect();
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, clientX: cx, clientY: cy }));
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: cx, clientY: cy }));
  return { ok: true, element: serializeElement(el, idx) };
}

async function waitForElement({ tag, id, timeoutMs } = {}) {
  if (!tag) return { ok: false, error: "tag_required" };
  const timeout = Math.max(100, Math.min(30_000, Number(timeoutMs) || 5_000));
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const els = findTaggedElements({ tag, id, visibleOnly: true });
    if (els.length > 0) {
      return { ok: true, found: true, element: serializeElement(els[0], 0), count: els.length };
    }
    await sleep(150);
  }
  return { ok: false, error: "timeout", tag, id };
}

// ---------------------------------------------------------------------------
// Context Menu Inspection
// ---------------------------------------------------------------------------

function snapshotContextMenu() {
  const menu = document.querySelector(".ctx-menu:not([hidden])") ||
               document.querySelector(".context-menu:not([hidden])") ||
               document.querySelector("[data-context-menu]:not([hidden])");
  if (!menu) return { ok: true, open: false, items: [], submenu: null };

  const items = Array.from(menu.querySelectorAll(".ctx-item, .context-menu__item, [data-dbg-type='context-menu-item']"))
    .map((el) => ({
      label: text(el),
      tag: String(el.dataset.dbg || ""),
      id: String(el.dataset.dbgId || ""),
      disabled: isElementDisabled(el),
      hasSubmenu: el.classList.contains("has-submenu") || Boolean(el.querySelector(".ctx-submenu, .submenu-arrow, [data-submenu]")),
      hidden: el.hidden || false,
    }));

  const submenuEl = document.querySelector(".ctx-submenu:not([hidden])") ||
                    document.querySelector(".context-submenu:not([hidden])") ||
                    document.querySelector("[data-dbg='ctx-playlist-submenu']:not([hidden])");
  let submenu = null;
  if (submenuEl) {
    const subItems = Array.from(submenuEl.querySelectorAll(".ctx-item, .ctx-submenu-item, [data-dbg]"))
      .map((el) => ({
        label: text(el),
        tag: String(el.dataset.dbg || ""),
        id: String(el.dataset.dbgId || ""),
        type: String(el.dataset.dbgType || ""),
        disabled: isElementDisabled(el),
      }));
    submenu = { open: true, items: subItems };
  }

  return { ok: true, open: true, items, submenu };
}

function dismissContextMenu() {
  const menus = document.querySelectorAll(".ctx-menu, .context-menu, [data-context-menu]");
  let dismissed = 0;
  for (const m of menus) {
    if (!m.hidden) {
      m.hidden = true;
      dismissed++;
    }
  }
  document.dispatchEvent(new Event("click", { bubbles: true }));
  return { ok: true, dismissed };
}

// ---------------------------------------------------------------------------
// Visual Inspection API
// ---------------------------------------------------------------------------

function inspectLayout({ tag, type, visibleOnly, limit } = {}) {
  const cap = Math.max(1, Math.min(300, Number(limit) || 100));
  const els = findTaggedElements({ tag, type, visibleOnly });
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;

  const allRects = [];
  const items = els.slice(0, cap).map((el, i) => {
    const r = describeRect(el);
    const entry = {
      tag: String(el.dataset.dbg || ""),
      id: String(el.dataset.dbgId || ""),
      desc: String(el.dataset.dbgDesc || ""),
      rect: r,
      visible: isElementVisible(el),
      zeroSize: r.width === 0 || r.height === 0,
      offScreen: (r.x + r.width < 0) || (r.y + r.height < 0) || (r.x > vw) || (r.y > vh),
      clipped: false,
      overlapping: [],
    };

    try {
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 8) {
        const ps = getComputedStyle(parent);
        if (ps.overflow === "hidden" || ps.overflow === "clip") {
          const pr = parent.getBoundingClientRect();
          if (r.x + r.width > pr.right + 2 || r.y + r.height > pr.bottom + 2 ||
              r.x < pr.left - 2 || r.y < pr.top - 2) {
            entry.clipped = true;
            break;
          }
        }
        parent = parent.parentElement;
        depth++;
      }
    } catch {}

    allRects.push({ index: i, rect: r, tag: entry.tag, id: entry.id });
    return entry;
  });

  for (let a = 0; a < allRects.length; a++) {
    for (let b = a + 1; b < allRects.length; b++) {
      const ra = allRects[a].rect;
      const rb = allRects[b].rect;
      if (ra.x < rb.x + rb.width && ra.x + ra.width > rb.x &&
          ra.y < rb.y + rb.height && ra.y + ra.height > rb.y) {
        items[a].overlapping.push(allRects[b].tag || `[${b}]`);
        items[b].overlapping.push(allRects[a].tag || `[${a}]`);
      }
    }
  }

  return { ok: true, elements: items, total: els.length };
}

function captureScreenState() {
  const allTagged = Array.from(document.querySelectorAll("[data-dbg]"));
  const visible = allTagged.filter((el) => isElementVisible(el));

  const menuEl = document.querySelector(".ctx-menu:not([hidden])") ||
                 document.querySelector(".context-menu:not([hidden])") ||
                 document.querySelector("[data-context-menu]:not([hidden])");

  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;

  const glitches = [];
  for (const el of visible) {
    const r = describeRect(el);
    const tag = String(el.dataset.dbg || "");
    const id = String(el.dataset.dbgId || "");
    if (r.width === 0 || r.height === 0) {
      glitches.push({ tag, id, issue: "zero_size" });
    } else if ((r.x + r.width < 0) || (r.y + r.height < 0) || (r.x > vw) || (r.y > vh)) {
      glitches.push({ tag, id, issue: "off_screen" });
    } else {
      try {
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 6) {
          const ps = getComputedStyle(parent);
          if (ps.overflow === "hidden" || ps.overflow === "clip") {
            const pr = parent.getBoundingClientRect();
            if (r.x + r.width > pr.right + 2 || r.y + r.height > pr.bottom + 2 ||
                r.x < pr.left - 2 || r.y < pr.top - 2) {
              glitches.push({ tag, id, issue: "clipped_by_parent" });
              break;
            }
          }
          parent = parent.parentElement;
          depth++;
        }
      } catch {}
    }
  }

  return {
    ok: true,
    view: getActiveViewName(),
    shellMode: getShellMode(),
    contextMenuOpen: Boolean(menuEl),
    taggedElementCount: allTagged.length,
    visibleTaggedElements: visible.length,
    viewport: { width: vw, height: vh },
    glitches,
  };
}

// ---------------------------------------------------------------------------
// Custom Playlist & Folder Debug Helpers
// ---------------------------------------------------------------------------

function _getLocalLibrary() {
  try {
    const raw = localStorage.getItem("spotify.localLibrary.v1");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _saveLocalLibrary(state) {
  try {
    localStorage.setItem("spotify.localLibrary.v1", JSON.stringify(state));
    window.dispatchEvent(new Event("local-library:changed"));
    return true;
  } catch {
    return false;
  }
}

function snapshotCustomPlaylists() {
  const state = _getLocalLibrary();
  const cp = state?.customPlaylists && typeof state.customPlaylists === "object" ? state.customPlaylists : {};
  const playlists = Object.values(cp).map((p) => ({
    id: String(p?.id || ""),
    title: String(p?.title || ""),
    trackCount: Array.isArray(p?.trackIds) ? p.trackIds.length : 0,
    createdAt: Number(p?.createdAt) || 0,
    updatedAt: Number(p?.updatedAt) || 0,
    playedAt: Number(p?.playedAt) || 0,
  }));
  playlists.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { ok: true, playlists, total: playlists.length };
}

function snapshotFolders() {
  const state = _getLocalLibrary();
  const f = state?.folders && typeof state.folders === "object" ? state.folders : {};
  const folders = Object.values(f).map((fd) => ({
    id: String(fd?.id || ""),
    title: String(fd?.title || ""),
    childCount: Array.isArray(fd?.children) ? fd.children.length : 0,
    children: Array.isArray(fd?.children) ? fd.children.map((c) => ({
      type: String(c?.type || ""),
      id: String(c?.id || ""),
    })) : [],
    createdAt: Number(fd?.createdAt) || 0,
    updatedAt: Number(fd?.updatedAt) || 0,
    playedAt: Number(fd?.playedAt) || 0,
  }));
  folders.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return { ok: true, folders, total: folders.length };
}

function snapshotCustomPlaylistView() {
  const view = getActiveViewName();
  const header = document.querySelector(".entity-header") || document.querySelector("[data-dbg='playlist-header']");
  if (!header) return { ok: true, view, rendered: false };

  const title = text(header.querySelector(".entity-title, [data-dbg='playlist-title-input']"));
  const subtitle = text(header.querySelector(".entity-subtitle"));
  const coverImg = header.querySelector(".entity-cover img");
  const cover = String(coverImg?.src || "").trim() || null;

  const trackRows = Array.from(document.querySelectorAll(".entity-track, [data-dbg='track-row']"));
  const tracks = trackRows.map((row) => ({
    trackId: toInt(row.dataset.trackId || row.dataset.dbgId),
    title: text(row.querySelector(".entity-track__title")),
    artist: text(row.querySelector(".entity-track__artist")),
  }));

  const recSection = document.querySelector("[data-dbg='recommended-section']");
  const recommended = recSection ? Array.from(recSection.querySelectorAll("[data-dbg='rec-track']")).map((row) => ({
    trackId: toInt(row.dataset.dbgId),
    title: text(row.querySelector(".entity-track__title, .rec-track__title")),
    artist: text(row.querySelector(".entity-track__artist, .rec-track__artist")),
  })) : [];

  const emptyState = document.querySelector("[data-dbg='playlist-empty-state']");

  return {
    ok: true,
    view,
    rendered: true,
    header: { title, subtitle, cover },
    tracks,
    totalTracks: trackRows.length,
    recommended,
    hasEmptyState: Boolean(emptyState),
  };
}

function seedTestData({ playlists, folders } = {}) {
  const state = _getLocalLibrary() || {};
  if (!state.customPlaylists || typeof state.customPlaylists !== "object") state.customPlaylists = {};
  if (!state.folders || typeof state.folders !== "object") state.folders = {};

  const createdPlaylistIds = [];
  const createdFolderIds = [];
  const now = Date.now();

  const playlistCount = Math.max(0, Math.min(20, Number(playlists) || 0));
  for (let i = 0; i < playlistCount; i++) {
    const id = `cp_test_${now}_${i}`;
    state.customPlaylists[id] = {
      id,
      title: `Test Playlist ${i + 1}`,
      cover: "",
      trackIds: [],
      tracks: {},
      createdAt: now + i,
      updatedAt: now + i,
      playedAt: 0,
    };
    createdPlaylistIds.push(id);
  }

  const folderCount = Math.max(0, Math.min(10, Number(folders) || 0));
  for (let i = 0; i < folderCount; i++) {
    const id = `f_test_${now}_${i}`;
    state.folders[id] = {
      id,
      title: `Test Folder ${i + 1}`,
      children: [],
      createdAt: now + i,
      updatedAt: now + i,
      playedAt: 0,
    };
    createdFolderIds.push(id);
  }

  const saved = _saveLocalLibrary(state);
  return { ok: saved, createdPlaylistIds, createdFolderIds };
}

function clearTestData() {
  const state = _getLocalLibrary();
  if (!state) return { ok: true, removed: 0 };

  let removed = 0;
  if (state.customPlaylists && typeof state.customPlaylists === "object") {
    for (const key of Object.keys(state.customPlaylists)) {
      if (key.includes("_test_")) {
        delete state.customPlaylists[key];
        removed++;
      }
    }
  }
  if (state.folders && typeof state.folders === "object") {
    for (const key of Object.keys(state.folders)) {
      if (key.includes("_test_")) {
        delete state.folders[key];
        removed++;
      }
    }
  }

  const saved = _saveLocalLibrary(state);
  return { ok: saved, removed };
}

function toggleMobilePreview(force) {
  const root = document.documentElement;
  const isMobile = typeof force === "boolean" ? force : !root.classList.contains("is-mobile");
  root.classList.toggle("is-mobile", isMobile);
  root.classList.toggle("is-desktop-forced", !isMobile);

  if (window.mobilePreview) {
    if (isMobile) window.mobilePreview.enable().catch(() => {});
    else window.mobilePreview.disable().catch(() => {});
  }

  return { ok: true, isMobile };
}

function toggleFolderExpand({ folderId, expanded } = {}) {
  const id = String(folderId || "").trim();
  if (!id) return { ok: false, error: "missing_folderId" };
  const FOLDER_EXPAND_KEY = "spotify.folderExpandState";
  try {
    const raw = localStorage.getItem(FOLDER_EXPAND_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof expanded === "boolean") {
      parsed[id] = expanded;
    } else {
      parsed[id] = !parsed[id];
    }
    localStorage.setItem(FOLDER_EXPAND_KEY, JSON.stringify(parsed));
  } catch (e) {
    return { ok: false, error: "storage_error", message: String(e?.message || e) };
  }
  // Trigger re-render
  window.dispatchEvent(new Event("local-library:changed"));
  // Wait a tick for the re-render, then return current state
  const state = (() => {
    try {
      const raw = localStorage.getItem(FOLDER_EXPAND_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  })();
  return { ok: true, folderId: id, expanded: Boolean(state[id]), allFolderStates: state };
}

function snapshotLibraryOrder() {
  const list = document.getElementById("libraryList");
  if (!list) return { ok: false, error: "library_list_not_found" };
  const items = Array.from(list.querySelectorAll(".library-item"));
  const order = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const hidden = it.hidden || it.classList.contains("is-hidden-by-search") || getComputedStyle(it).display === "none";
    const title = (it.querySelector(".library-item__title")?.textContent || "").trim();
    const subtitle = (it.querySelector(".library-item__subtitle")?.textContent || "").trim();
    order.push({
      index: i,
      visible: !hidden,
      id: it.dataset.dbgId || "",
      route: it.dataset.route || "",
      entityType: it.dataset.entityType || "",
      entityId: it.dataset.entityId || "",
      customPlaylistId: it.dataset.customPlaylistId || "",
      folderId: it.dataset.folderId || "",
      title,
      subtitle,
      isFolderChild: it.classList.contains("is-folder-child"),
      parentFolderId: it.dataset.parentFolderId || "",
      folderExpanded: it.dataset.folderExpanded || "",
      isActive: it.classList.contains("is-active"),
      draggable: it.draggable,
    });
  }
  return { ok: true, total: items.length, visibleCount: order.filter((o) => o.visible).length, items: order };
}

export function installUiDebug() {
  window.__dexifyUiDebug = {
    isReady,
    snapshotHome,
    snapshotLibrary,
    snapshotNowPlaying,
    snapshotPage,
    navigate,
    findBottomPlaylistByTitle,
    openBottomPlaylistByTitle,
    clickEntityAction,
    downloadBottomPlaylistByTitle,
    snapshotDownloadsLocal,
    toggleMobilePreview,
    queryElements,
    getElement,
    clickElement,
    typeIntoElement,
    hoverElement,
    waitForElement,
    snapshotContextMenu,
    dismissContextMenu,
    inspectLayout,
    captureScreenState,
    snapshotCustomPlaylists,
    snapshotFolders,
    snapshotCustomPlaylistView,
    seedTestData,
    clearTestData,
    toggleFolderExpand,
    snapshotLibraryOrder,
  };
}
