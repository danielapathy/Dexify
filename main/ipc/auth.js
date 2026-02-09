const { BrowserWindow } = require("electron");
const { env } = require("../env");

async function readArlFromCookies(electronSession) {
  const cookies = await electronSession.cookies.get({ name: "arl" });
  const cookie = cookies?.[0];
  if (!cookie || typeof cookie.value !== "string" || !cookie.value) return null;
  return cookie.value;
}

async function readAllCookies(electronSession) {
  try {
    const cookies = await electronSession.cookies.get({});
    return cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      expirationDate: cookie.expirationDate,
      sameSite: cookie.sameSite,
    }));
  } catch (error) {
    console.error("Error reading cookies:", error);
    return [];
  }
}

function registerAuthIpcHandlers({
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
}) {
  ipcMain.handle("auth:getSession", async () => {
    const hasARL = Boolean(state.sessionState.arl);
    if (hasARL) {
      try {
        // Don't block renderer boot on a slow network call.
        await Promise.race([refreshSessionUser(), new Promise((resolve) => setTimeout(resolve, 1200))]);
      } catch {}
    } else {
      state.sessionUser = null;
    }
    return { ok: true, hasARL, user: state.sessionUser || null };
  });

  ipcMain.handle("auth:logout", async () => {
    state.sessionState = { arl: null, cookies: null };
    state.sessionUser = null;
    resetDzAuthedClient();
    clearSession();
    pushState();
    try {
      if (state.loginPopup && !state.loginPopup.isDestroyed()) state.loginPopup.close();
    } catch {}
    state.loginPopup = null;
    return { ok: true };
  });

  ipcMain.handle("auth:login", async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender) || undefined;
    const loginUrl = env.MUSIC_APP_LOGIN_URL;

    if (state.loginPopup && !state.loginPopup.isDestroyed()) {
      try {
        state.loginPopup.close();
      } catch {}
      state.loginPopup = null;
    }

    state.loginPopup = createLoginPopup(parent);
    state.loginPopup.show();
    state.loginPopup.focus();

    return await new Promise((resolve) => {
      let finished = false;
      let lastCheckAt = 0;
      const childWindows = new Set();

      const onCookieChanged = (_event, cookie, _cause, removed) => {
        if (removed) return;
        if (!cookie || cookie.name !== "arl") return;
        captureValue(cookie.value);
      };

      const onWillRedirect = () => void maybeCapture();
      const onWillNavigate = () => void maybeCapture();
      const onDidStartNavigation = () => void maybeCapture();
      const onDidNavigate = () => void maybeCapture();
      const onDidNavigateInPage = () => void maybeCapture();
      const onDidFinishLoad = () => void maybeCapture();

      const onDidCreateWindow = (child) => {
        try {
          childWindows.add(child);
          child.on("closed", () => childWindows.delete(child));
        } catch {}

        try {
          child.webContents.on("will-redirect", onWillRedirect);
          child.webContents.on("will-navigate", onWillNavigate);
          child.webContents.on("did-start-navigation", onDidStartNavigation);
          child.webContents.on("did-navigate", onDidNavigate);
          child.webContents.on("did-navigate-in-page", onDidNavigateInPage);
          child.webContents.on("did-finish-load", onDidFinishLoad);
        } catch {}
      };

      const cleanup = () => {
        try {
          state.loginPopup?.webContents?.session?.cookies?.removeListener?.("changed", onCookieChanged);
        } catch {}
        try {
          state.loginPopup?.webContents?.removeListener?.("will-redirect", onWillRedirect);
          state.loginPopup?.webContents?.removeListener?.("will-navigate", onWillNavigate);
          state.loginPopup?.webContents?.removeListener?.("did-start-navigation", onDidStartNavigation);
          state.loginPopup?.webContents?.removeListener?.("did-navigate", onDidNavigate);
          state.loginPopup?.webContents?.removeListener?.("did-navigate-in-page", onDidNavigateInPage);
          state.loginPopup?.webContents?.removeListener?.("did-finish-load", onDidFinishLoad);
        } catch {}
        try {
          state.loginPopup?.webContents?.removeListener?.("did-create-window", onDidCreateWindow);
        } catch {}
        try {
          state.loginPopup?.removeAllListeners?.("closed");
        } catch {}
        try {
          for (const child of childWindows) {
            try {
              child.close();
            } catch {}
          }
          childWindows.clear();
        } catch {}
      };

      const finish = (payload) => {
        if (finished) return;
        finished = true;
        cleanup();

        try {
          state.loginPopup?.webContents?.stop?.();
        } catch {}

        try {
          state.loginPopup?.close?.();
        } catch {}

        state.loginPopup = null;
        resolve(payload);
      };

      const captureValue = async (arl) => {
        if (!isValidArl(arl)) return;
        try {
          const cookies = await readAllCookies(state.loginPopup.webContents.session);
          state.sessionState = { arl, cookies };
          state.sessionUser = null;
          resetDzAuthedClient();
          saveSession(state.sessionState);

          Promise.any([extractDeezerAppState(cookies), extractDeezerAppStateWithArl(arl)]).catch((error) => {
            console.error("Failed to extract app state:", error);
          });

          pushState();
          void refreshSessionUser().then(() => pushState());
          finish({ ok: true, hasARL: true });
        } catch (e) {
          finish({ ok: false, error: "save_failed", message: String(e) });
        }
      };

      const maybeCapture = async () => {
        const now = Date.now();
        if (now - lastCheckAt < 150) return;
        lastCheckAt = now;

        try {
          const arl = await readArlFromCookies(state.loginPopup.webContents.session);
          if (arl) {
            const cookies = await readAllCookies(state.loginPopup.webContents.session);
            if (cookies.length > 0) {
              captureValue(arl);
            }
          }
        } catch {}
      };

      state.loginPopup.on("closed", () => finish({ ok: false, error: "popup_closed" }));

      state.loginPopup.webContents.session.cookies.on("changed", onCookieChanged);
      state.loginPopup.webContents.on("will-redirect", onWillRedirect);
      state.loginPopup.webContents.on("will-navigate", onWillNavigate);
      state.loginPopup.webContents.on("did-start-navigation", onDidStartNavigation);
      state.loginPopup.webContents.on("did-navigate", onDidNavigate);
      state.loginPopup.webContents.on("did-navigate-in-page", onDidNavigateInPage);
      state.loginPopup.webContents.on("did-finish-load", onDidFinishLoad);
      state.loginPopup.webContents.on("did-create-window", onDidCreateWindow);

      void (async () => {
        await maybeCapture();
        if (finished) return;
        state.loginPopup
          .loadURL(loginUrl)
          .catch((e) => finish({ ok: false, error: "load_failed", message: String(e) }));
      })();
    });
  });
}

module.exports = { registerAuthIpcHandlers };
