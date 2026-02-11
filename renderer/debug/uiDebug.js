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
  };
}
