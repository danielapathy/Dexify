const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("node:path");

app.setName("Dexify");
process.title = "Dexify";

const { APP_BOOT_AT_MS } = require("./main/constants");
const { safeJsonParse, fetchJson } = require("./main/utils");
const createVendoredLoaders = require("./main/vendor");
const createWindows = require("./main/windows");
const { loadChromeExtensions } = require("./main/extensions");
const { startSessionWebhook } = require("./main/webhook");
const { getDeezerUserProfileFromArl } = require("./main/deezerProfile");
const { extractDeezerAppState, extractDeezerAppStateWithArl } = require("./main/deezerAppState");
const {
  getSessionDir,
  getAppStateStoragePath,
  getDownloadsDir,
  loadSession,
  saveSession,
  clearSession,
  isValidArl,
  extractArlFromStoredCookies,
} = require("./main/sessionStorage");
const { broadcastSessionChanged, broadcastDownloadEvent } = require("./main/broadcast");

const { registerMobilePreviewIpcHandlers } = require("./main/ipc/mobilePreview");
const { registerAuthIpcHandlers } = require("./main/ipc/auth");
const { registerAppIpcHandlers } = require("./main/ipc/app");
const { registerDownloadIpcHandlers } = require("./main/ipc/downloads");
const { registerDeezerIpcHandlers } = require("./main/ipc/deezer");
const { registerDzIpcHandlers } = require("./main/ipc/dz");

const { loadVendoredDeezerSdk, loadVendoredDeemixLite } = createVendoredLoaders({ rootDir: __dirname });
const { createMainWindow, createLoginPopup } = createWindows({ rootDir: __dirname });

// Prevent duplicate instances during development/testing.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    try {
      const win = BrowserWindow.getAllWindows()?.[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    } catch {}
  });
}

app.whenReady().then(async () => {
  await loadChromeExtensions();

  // App icon (especially for macOS Dock).
  try {
    const iconPath = path.join(__dirname, "icon.png");
    if (process.platform === "darwin" && app.dock && typeof app.dock.setIcon === "function") {
      app.dock.setIcon(iconPath);
    }
  } catch {}

  const state = {
    mainWindow: null,
    sessionState: loadSession(), // { arl, cookies }
    sessionUser: null, // { id, name, pictureId, avatarUrl }
    sessionUserFetch: null,
    loginPopup: null,
    dzClientPublic: null,
    dzClientPublicInit: null,
    dzClientAuthed: null,
    dzClientAuthedInit: null,
    dzClientAuthedArl: null,
    downloadsDebug: null,
  };

  state.mainWindow = createMainWindow();

  const argv = Array.isArray(process.argv) ? process.argv : [];
  const uiDebugEnabled = Boolean(process.env.DEXIFY_UI_DEBUG) || argv.some((a) => a === "--ui-debug");

  const webhookServer = startSessionWebhook({
    getSession: () => state.sessionState,
    getMainWindow: () => state.mainWindow,
    uiDebugEnabled,
    getDownloadsDir,
    getDownloadDebugState: (opts) => state.downloadsDebug?.getDebugState?.(opts) || null,
  });

  const refreshSessionUser = async () => {
    if (state.sessionUserFetch) return state.sessionUserFetch;
    if (!state.sessionState.arl) {
      state.sessionUser = null;
      return null;
    }

    state.sessionUserFetch = (async () => {
      try {
        state.sessionUser = await getDeezerUserProfileFromArl(state.sessionState.arl);
      } catch {
        state.sessionUser = null;
      } finally {
        state.sessionUserFetch = null;
      }
      return state.sessionUser;
    })();

    return state.sessionUserFetch;
  };

  const pushState = () => {
    broadcastSessionChanged({
      hasARL: Boolean(state.sessionState.arl),
      user: state.sessionUser || null,
    });
  };

  const resetDzAuthedClient = () => {
    state.dzClientAuthed = null;
    state.dzClientAuthedInit = null;
    state.dzClientAuthedArl = null;
  };

  const getDzPublicClient = async () => {
    if (state.dzClientPublic) return { ok: true, dz: state.dzClientPublic };
    if (state.dzClientPublicInit) return state.dzClientPublicInit;

    state.dzClientPublicInit = (async () => {
      try {
        const mod = await loadVendoredDeezerSdk();
        const Deezer = mod?.Deezer;
        if (typeof Deezer !== "function") {
          return { ok: false, error: "deezer_sdk_invalid", message: "Missing Deezer export" };
        }
        state.dzClientPublic = new Deezer();
        return { ok: true, dz: state.dzClientPublic };
      } catch (e) {
        return { ok: false, error: "deezer_sdk_load_failed", message: String(e?.message || e) };
      } finally {
        state.dzClientPublicInit = null;
      }
    })();

    return state.dzClientPublicInit;
  };

  const getDzClient = async ({ requireLogin = false } = {}) => {
    if (!requireLogin) return getDzPublicClient();
    if (!state.sessionState.arl && Array.isArray(state.sessionState.cookies)) {
      const recovered = extractArlFromStoredCookies(state.sessionState.cookies);
      if (isValidArl(recovered)) {
        state.sessionState = { ...state.sessionState, arl: recovered };
        try {
          saveSession(state.sessionState);
        } catch {}
      }
    }
    if (!state.sessionState.arl) return { ok: false, error: "not_logged_in" };

    const arl = state.sessionState.arl;
    if (state.dzClientAuthed && state.dzClientAuthedArl === arl && state.dzClientAuthed.loggedIn) {
      return { ok: true, dz: state.dzClientAuthed };
    }
    if (state.dzClientAuthedInit) return state.dzClientAuthedInit;

    state.dzClientAuthedInit = (async () => {
      try {
        const mod = await loadVendoredDeezerSdk();
        const Deezer = mod?.Deezer;
        if (typeof Deezer !== "function") {
          return { ok: false, error: "deezer_sdk_invalid", message: "Missing Deezer export" };
        }

        const dz = new Deezer();
        const loggedIn = await dz.loginViaArl(arl);
        if (!loggedIn) {
          state.sessionState = { arl: null, cookies: null };
          state.sessionUser = null;
          try {
            clearSession();
          } catch {}
          try {
            saveSession(state.sessionState);
          } catch {}
          try {
            pushState();
          } catch {}
          return { ok: false, error: "arl_invalid" };
        }

        state.dzClientAuthed = dz;
        state.dzClientAuthedArl = arl;
        return { ok: true, dz };
      } catch (e) {
        return { ok: false, error: "deezer_sdk_load_failed", message: String(e?.message || e) };
      } finally {
        state.dzClientAuthedInit = null;
      }
    })();

    return state.dzClientAuthedInit;
  };

  const validateSession = async () => {
    if (!state.sessionState.arl) return false;
    try {
      const testUser = await getDeezerUserProfileFromArl(state.sessionState.arl);
      if (testUser) {
        state.sessionUser = testUser;
        return true;
      }

      console.log("ARL is no longer valid, clearing session");
      state.sessionState = { arl: null, cookies: null };
      clearSession();
      return false;
    } catch (error) {
      console.log("Failed to validate ARL:", error?.message || error);
      const msg = String(error?.message || "");
      if (msg.includes("401") || msg.includes("403") || msg.includes("error")) {
        state.sessionState = { arl: null, cookies: null };
        clearSession();
        return false;
      }
      return true;
    }
  };

  registerAuthIpcHandlers({
    ipcMain,
    state,
    refreshSessionUser,
    resetDzAuthedClient,
    clearSession,
    pushState,
    createLoginPopup,
    saveSession,
    isValidArl,
    extractDeezerAppState,
    extractDeezerAppStateWithArl,
  });

  registerMobilePreviewIpcHandlers({ ipcMain });
  registerAppIpcHandlers({ ipcMain, app, shell, getSessionDir, getAppStateStoragePath });
  state.downloadsDebug = registerDownloadIpcHandlers({
    ipcMain,
    getDzClient,
    loadVendoredDeemixLite,
    broadcastDownloadEvent,
  });
  registerDeezerIpcHandlers({
    ipcMain,
    fetchJson,
    safeJsonParse,
    getAppStateStoragePath,
    APP_BOOT_AT_MS,
    state,
    extractDeezerAppState,
  });
  registerDzIpcHandlers({ ipcMain, state, refreshSessionUser, getDzClient });

  if (state.sessionState.arl) {
    void validateSession().then((isValid) => {
      if (isValid) {
        pushState();

        const appStateExtractions = [];
        if (state.sessionState.cookies && state.sessionState.cookies.length > 0) {
          appStateExtractions.push(extractDeezerAppState(state.sessionState.cookies));
        }
        appStateExtractions.push(extractDeezerAppStateWithArl(state.sessionState.arl));

        Promise.any(appStateExtractions).catch((error) => {
          console.error("Failed to extract app state on startup:", error);
        });
      } else {
        pushState();
      }
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  app.on("before-quit", () => {
    try {
      webhookServer.close();
    } catch {}
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
