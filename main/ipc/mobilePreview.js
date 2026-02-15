const { BrowserWindow } = require("electron");

function registerMobilePreviewIpcHandlers({ ipcMain }) {
  let savedBounds = null;

  ipcMain.handle("mobilePreview:enable", () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!win) return { ok: false, error: "no_window" };

      // Save current bounds so we can restore later
      savedBounds = win.getBounds();

      // Phone-like portrait: 390×844 (iPhone 14 / similar Android)
      const targetWidth = 390;
      const targetHeight = 844;

      // Center on current display
      const { x, y, width, height } = savedBounds;
      const cx = Math.round(x + width / 2 - targetWidth / 2);
      const cy = Math.round(y + height / 2 - targetHeight / 2);

      win.setMinimumSize(320, 480);
      win.setBounds({ x: cx, y: cy, width: targetWidth, height: targetHeight }, true);
      win.setResizable(true);

      return { ok: true, width: targetWidth, height: targetHeight };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle("mobilePreview:disable", () => {
    try {
      const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!win) return { ok: false, error: "no_window" };

      // Restore min size first
      win.setMinimumSize(1024, 640);

      if (savedBounds) {
        win.setBounds(savedBounds, true);
        savedBounds = null;
      } else {
        // Fallback to default size
        win.setSize(1520, 860, true);
        win.center();
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });
}

module.exports = { registerMobilePreviewIpcHandlers };
