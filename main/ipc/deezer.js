const fs = require("node:fs");

function registerDeezerIpcHandlers({
  ipcMain,
  fetchJson,
  safeJsonParse,
  getAppStateStoragePath,
  APP_BOOT_AT_MS,
  state,
  extractDeezerAppState,
}) {
  ipcMain.handle("deezer:getLanding", async () => {
    const [playlists, tracks] = await Promise.all([
      fetchJson("https://api.deezer.com/chart/0/playlists?limit=8").then((r) =>
        Array.isArray(r?.json?.data) ? r.json.data : []
      ),
      fetchJson("https://api.deezer.com/chart/0/tracks?limit=8").then((r) =>
        Array.isArray(r?.json?.data) ? r.json.data : []
      ),
    ]);

    return { ok: true, playlists, tracks };
  });

  ipcMain.handle("deezer:getAppState", async () => {
    try {
      const stat = fs.statSync(getAppStateStoragePath());
      const appStateRaw = fs.readFileSync(getAppStateStoragePath(), "utf8");
      const appState = safeJsonParse(appStateRaw);
      return { ok: true, appState, mtimeMs: stat.mtimeMs, bootAtMs: APP_BOOT_AT_MS };
    } catch {
      return { ok: false, error: "not_found", bootAtMs: APP_BOOT_AT_MS };
    }
  });

  ipcMain.handle("deezer:extractAppState", async () => {
    if (!state.sessionState.cookies || state.sessionState.cookies.length === 0) {
      return { ok: false, error: "no_cookies" };
    }

    try {
      const appState = await extractDeezerAppState(state.sessionState.cookies);
      return { ok: true, appState };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}

module.exports = { registerDeezerIpcHandlers };

