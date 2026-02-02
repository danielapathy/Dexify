const fs = require("node:fs");

function registerAppIpcHandlers({ ipcMain, app, shell, getSessionDir, getAppStateStoragePath }) {
  ipcMain.handle("app:getPaths", async () => {
    return {
      ok: true,
      sessionDir: getSessionDir(),
      musicDir: app.getPath("music"),
      downloadsDir: app.getPath("downloads"),
    };
  });

  ipcMain.handle("app:openSessionDir", async () => {
    try {
      await shell.openPath(getSessionDir());
      return { ok: true };
    } catch (e) {
      return { ok: false, error: "open_failed", message: String(e?.message || e) };
    }
  });

  ipcMain.handle("app:clearAppState", async () => {
    try {
      fs.unlinkSync(getAppStateStoragePath());
    } catch {}
    return { ok: true };
  });
}

module.exports = { registerAppIpcHandlers };

