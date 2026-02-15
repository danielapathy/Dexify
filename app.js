import { wireChips, wirePlatformClasses, wireRanges } from "./renderer/platform.js";
import { wireMobile } from "./renderer/mobile.js";
import { wireAccountMenu } from "./renderer/accountMenu.js";
import { wireCarousels } from "./renderer/carousels.js";
import { wireGlobalMenuDismissal } from "./renderer/menus/globalMenuDismiss.js";
import { wireDeezerSections } from "./renderer/deezerSections.js";
import { wireModal } from "./renderer/modal.js";
import { wireNavigation, wireNowPlayingHighlights } from "./renderer/navigation.js";
import { wireDownloads, wireNotifications } from "./renderer/notifications.js";
import { createPlayerController } from "./renderer/player.js";
import { wireContextMenus } from "./renderer/contextMenu.js";
import { wireLibraryHealthCheck } from "./renderer/libraryHealth.js";
import { wireTrackMultiSelect } from "./renderer/library/trackMultiSelect.js";
import { mountBootErrorOverlay } from "./renderer/bootstrap/bootErrorOverlay.js";
import { getSessionSafe } from "./renderer/bootstrap/session.js";
import {
  wireLibraryData,
  wireLibraryFilters,
  wireLibrarySelection,
  wireQuickCards,
  wireSidebarCollapse,
  wireSidebarResize,
  wireCreateMenu,
} from "./renderer/sidebar.js";

let appInitialized = false;
let landingInitialized = false;
let syncSignedOutUi = null;
let authedInitialized = false;
let bootCompleted = false;
let bootErrorShown = false;

let uiDebugInstalled = false;
async function maybeInstallUiDebug() {
  if (uiDebugInstalled) return;
  uiDebugInstalled = true;
  try {
    const q = new URLSearchParams(window.location.search || "");
    if (q.get("uiDebug") !== "1") return;
    const mod = await import("./renderer/debug/uiDebug.js");
    mod.installUiDebug?.();
  } catch {}
}

function showBootError(error) {
  if (bootCompleted || bootErrorShown) return;
  bootErrorShown = true;
  try {
    console.error("[boot] fatal error", error);
  } catch {}

  try {
    setShellMode("app");
  } catch {}

  try {
    mountBootErrorOverlay({ error, onReload: () => window.location.reload() });
  } catch {}
}

window.addEventListener(
  "error",
  (event) => {
    if (bootCompleted) return;
    showBootError(event?.error || event?.message || event);
  },
  { once: true },
);

window.addEventListener(
  "unhandledrejection",
  (event) => {
    if (bootCompleted) return;
    showBootError(event?.reason || event);
  },
  { once: true },
);

function getShellEls() {
  return {
    splash: document.getElementById("bootSplash"),
    stage: document.getElementById("appStage"),
    signedOutView: document.getElementById("mainViewSignedOut"),
    signedOutLoginBtn: document.getElementById("signedOutViewLoginBtn"),
    signedOutOfflineBtn: document.getElementById("signedOutViewOfflineBtn"),
    signedOutStatus: document.getElementById("signedOutViewStatus"),
  };
}

function setShellMode(mode) {
  const { splash, stage } = getShellEls();
  if (splash) splash.hidden = mode !== "boot";
  if (stage) stage.hidden = mode !== "app";
  try {
    document.documentElement.dataset.shell = String(mode || "");
  } catch {}
}

function initAppOnce() {
  if (appInitialized) return;
  appInitialized = true;

  wirePlatformClasses();
  wireMobile();
  wireRanges();
  wireChips();
  wireModal();
  wireCarousels();
  wireGlobalMenuDismissal();

  window.__player = createPlayerController();

  wireQuickCards();
  wireLibrarySelection();
  wireLibraryFilters();
  wireLibraryData();
  wireCreateMenu();
  wireSidebarResize();
  wireSidebarCollapse();

  wireAccountMenu();
  wireNavigation();
  wireNowPlayingHighlights();
  wireTrackMultiSelect();

  wireNotifications();
  wireDownloads();
  wireLibraryHealthCheck();
  wireContextMenus();
}

function initAuthedOnce() {
  if (authedInitialized) return;
  authedInitialized = true;
  wireDeezerSections();
  window.__deezerSectionsRefresh?.();
}

function initLandingOnce({ onLoginSuccess } = {}) {
  if (landingInitialized) return;
  landingInitialized = true;

  const { signedOutView, signedOutLoginBtn, signedOutOfflineBtn, signedOutStatus } = getShellEls();
  if (!signedOutView || !signedOutLoginBtn) return;

  const setStatus = (msg) => {
    if (!signedOutStatus) return;
    signedOutStatus.textContent = String(msg || "");
  };

  const setBusy = (busy) => {
    try {
      signedOutLoginBtn.disabled = Boolean(busy);
    } catch {}
  };

  const getOfflineDownloadCount = () => {
    try {
      const raw = localStorage.getItem("spotify.localLibrary.v1");
      const parsed = raw ? JSON.parse(raw) : null;
      const downloaded = parsed?.downloadedTracks && typeof parsed.downloadedTracks === "object" ? parsed.downloadedTracks : {};
      return Object.values(downloaded).filter((x) => String(x?.download?.fileUrl || "").trim()).length;
    } catch {
      return 0;
    }
  };

  syncSignedOutUi = () => {
    const offlineCount = getOfflineDownloadCount();
    if (signedOutOfflineBtn) signedOutOfflineBtn.hidden = offlineCount <= 0;
    const authed = Boolean(window.__authHasARL);
    if (authed) initAuthedOnce();
    if (!window.auth?.login) {
      setBusy(true);
      setStatus(offlineCount > 0 ? "Continue offline, or open this app in Electron to log in." : "Login is available in Electron only.");
    }

    // If localStorage hasn't been hydrated yet, fall back to the downloads DB (Electron only).
    if (offlineCount <= 0 && signedOutOfflineBtn && signedOutOfflineBtn.hidden && window.dl?.listDownloads) {
      window.dl
        .listDownloads()
        .then((res) => {
          const rows = Array.isArray(res?.tracks) ? res.tracks : [];
          if (rows.length > 0) signedOutOfflineBtn.hidden = false;
        })
        .catch(() => {});
    }
  };

  syncSignedOutUi();
  window.addEventListener("local-library:changed", () => syncSignedOutUi?.());

  if (signedOutOfflineBtn) {
    signedOutOfflineBtn.addEventListener("click", () => {
      try {
        window.__authHasARL = false;
      } catch {}
      try {
        window.__offlineMode = true;
      } catch {}
      syncSignedOutUi?.();
      setTimeout(() => {
        // Offline mode should bring the user to the normal home surface (without personalized sections).
        window.__spotifyNav?.navigate?.({ name: "home", refresh: true, scrollTop: 0 }, { replace: true });
      }, 0);
    });
  }

  if (!window.auth?.login) return;

  signedOutLoginBtn.addEventListener("click", async () => {
    setBusy(true);
    setStatus("Opening login…");
    try {
      const res = await window.auth.login();
      if (!res?.ok || !res?.hasARL) {
        setStatus(String(res?.message || res?.error || "Login failed"));
        return;
      }
      setStatus("");
      onLoginSuccess?.();
    } finally {
      setBusy(false);
    }
  });
}

async function bootstrap() {
  setShellMode("boot");
  try {
    window.__authHasARL = false;
  } catch {}
  try {
    window.__offlineMode = false;
  } catch {}

  const openAlbumId = (() => {
    try {
      const q = new URLSearchParams(window.location.search || "");
      const raw = q.get("openAlbum");
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : null;
    } catch {
      return null;
    }
  })();
  const openArtistId = (() => {
    try {
      const q = new URLSearchParams(window.location.search || "");
      const raw = q.get("openArtist");
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : null;
    } catch {
      return null;
    }
  })();

  initLandingOnce({
    onLoginSuccess: () => {
      try {
        window.__authHasARL = true;
      } catch {}
      try {
        window.__offlineMode = false;
      } catch {}
      syncSignedOutUi?.();
      // If the user is on a signed-out landing state, take them home and refresh personalized sections.
      setTimeout(() => {
        window.__spotifyNav?.navigate?.({ name: "home", refresh: true, scrollTop: 0 }, { replace: true });
      }, 0);
    },
  });

  const session = await getSessionSafe({ timeoutMs: 2000 });
  const hasARL = Boolean(session?.hasARL);
  try {
    window.__authHasARL = hasARL;
  } catch {}
  if (!hasARL && (openAlbumId || openArtistId)) {
    try {
      window.__offlineMode = true;
    } catch {}
  }

  // Wire the UI after we know whether we're authenticated so navigation doesn't "flash" the signed-out gate.
  try {
    initAppOnce();
  } catch (error) {
    showBootError(error);
    return;
  }

  setShellMode("app");
  void maybeInstallUiDebug();
  bootCompleted = true;
  syncSignedOutUi?.();
  if (hasARL) initAuthedOnce();
  if (!hasARL && openAlbumId) {
    setTimeout(() => {
      window.__spotifyNav?.reset?.({ name: "entity", entityType: "album", id: String(openAlbumId), scrollTop: 0 });
    }, 0);
  }
  if (!hasARL && openArtistId) {
    setTimeout(() => {
      window.__spotifyNav?.reset?.({ name: "entity", entityType: "artist", id: String(openArtistId), scrollTop: 0 });
    }, 0);
  }
  if (!hasARL) {
    setTimeout(() => {
      const offline = Boolean(window.__offlineMode);
      if (!offline) {
        if (window.__spotifyNav?.reset) window.__spotifyNav.reset({ name: "signedOut", scrollTop: 0 });
        else window.__spotifyNav?.navigate?.({ name: "signedOut", scrollTop: 0 }, { replace: true });
      }
    }, 0);
  }

  window.auth?.onSessionChanged?.((payload) => {
    const authed = Boolean(payload?.hasARL);
    try {
      window.__authHasARL = authed;
    } catch {}

    if (authed) {
      try {
        window.__offlineMode = false;
      } catch {}
      syncSignedOutUi?.();
      initAuthedOnce();
      // If we're signed in (or session was restored) but still on the signed-out gate, take them home.
      setTimeout(() => {
        try {
          const signedOutView = document.getElementById("mainViewSignedOut");
          const isSignedOutVisible = Boolean(signedOutView && !signedOutView.hidden);
          if (isSignedOutVisible) window.__spotifyNav?.navigate?.({ name: "home", refresh: true, scrollTop: 0 }, { replace: true });
        } catch {}
      }, 0);
    } else {
      try {
        window.__offlineMode = false;
      } catch {}
      syncSignedOutUi?.();
      setTimeout(() => {
        if (window.__spotifyNav?.reset) window.__spotifyNav.reset({ name: "signedOut", scrollTop: 0 });
        else window.__spotifyNav?.navigate?.({ name: "signedOut", scrollTop: 0 }, { replace: true });
      }, 0);
    }
  });
}

void bootstrap().catch((error) => showBootError(error));
