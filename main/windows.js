const { BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { env } = require("./env");

module.exports = function createWindows({ rootDir }) {
  if (!rootDir) throw new Error("createWindows: missing rootDir");

  const iconPath = path.join(rootDir, "icon.png");
  const appIcon = (() => {
    try {
      return fs.existsSync(iconPath) ? iconPath : null;
    } catch {
      return null;
    }
  })();

  // Default: DevTools closed (can be enabled with AUTO_OPEN_DEVTOOLS=true).
  const shouldOpenDevTools = env.AUTO_OPEN_DEVTOOLS;
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const hasArg = (flag) => argv.some((a) => a === flag);
  const isUiDebug = Boolean(env.DEXIFY_UI_DEBUG) || hasArg("--ui-debug");

  function createMainWindow() {
    const isMac = process.platform === "darwin";
    const win = new BrowserWindow({
      width: 1520,
      height: 860,
      minWidth: 1024,
      minHeight: 640,
      backgroundColor: "#0b0b0b",
      title: "Dexify",
      titleBarStyle: isMac ? "hidden" : "default",
      ...(isMac ? { trafficLightPosition: { x: 18, y: 22 } } : {}),
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        preload: path.join(rootDir, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        nativeWindowOpen: true,
      },
    });

    const query = (() => {
      const out = {};
      const startRouteFromEnv = String(process.env.DEXIFY_START_ROUTE || "").trim();
      if (startRouteFromEnv) out.startRoute = startRouteFromEnv;
      const startRouteArg = argv.find((a) => typeof a === "string" && a.startsWith("--start-route="));
      if (startRouteArg) {
        const raw = String(startRouteArg.split("=").slice(1).join("=")).trim();
        if (raw) out.startRoute = raw;
      }
      const openNotifications = argv.some((a) => a === "--open-notifications");
      if (openNotifications) out.startRoute = "notifications";
      const openAlbumArg = argv.find((a) => typeof a === "string" && a.startsWith("--open-album="));
      if (openAlbumArg) {
        const raw = String(openAlbumArg.split("=").slice(1).join("=")).trim();
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) out.openAlbum = String(Math.trunc(n));
      }
      const openArtistArg = argv.find((a) => typeof a === "string" && a.startsWith("--open-artist="));
      if (openArtistArg) {
        const raw = String(openArtistArg.split("=").slice(1).join("=")).trim();
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) out.openArtist = String(Math.trunc(n));
      }
      if (isUiDebug) out.uiDebug = "1";
      return out;
    })();

    win.loadFile(path.join(rootDir, "index.html"), Object.keys(query).length ? { query } : undefined);

    if (shouldOpenDevTools) {
      win.webContents.once("dom-ready", () => {
        try {
          win.webContents.openDevTools({ mode: "detach" });
        } catch {}
      });
    }

    win.webContents.setWindowOpenHandler(({ url }) => {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: win,
          modal: false,
          backgroundColor: "#0b0b0b",
          title: "Dexify",
          autoHideMenuBar: true,
          ...(appIcon ? { icon: appIcon } : {}),
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            nativeWindowOpen: true,
          },
        },
      };
    });

    win.webContents.on("will-navigate", (event, url) => {
      const current = win.webContents.getURL();
      if (url !== current) {
        event.preventDefault();
        const child = new BrowserWindow({
          width: 1000,
          height: 800,
          parent: win,
          modal: false,
          backgroundColor: "#0b0b0b",
          title: "Dexify",
          autoHideMenuBar: true,
          ...(appIcon ? { icon: appIcon } : {}),
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            nativeWindowOpen: true,
          },
        });
        child.setMenuBarVisibility(false);
        child.webContents.setWindowOpenHandler(({ url: childUrl }) => {
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              parent: child,
              modal: false,
              backgroundColor: "#0b0b0b",
              title: "Dexify",
              autoHideMenuBar: true,
              ...(appIcon ? { icon: appIcon } : {}),
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                nativeWindowOpen: true,
              },
            },
          };
        });
        void child.loadURL(url);
      }
    });

    win.webContents.on("did-create-window", (child) => {
      try {
        child.setMenuBarVisibility(false);
      } catch {}
    });

    return win;
  }

  function createLoginPopup(parent) {
    const popup = new BrowserWindow({
      width: 520,
      height: 760,
      parent,
      modal: false,
      resizable: true,
      backgroundColor: "#0b0b0b",
      title: "Dexify",
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        nativeWindowOpen: true,
      },
    });

    popup.setMenuBarVisibility(false);

    if (shouldOpenDevTools) {
      popup.webContents.once("dom-ready", () => {
        try {
          popup.webContents.openDevTools({ mode: "detach" });
        } catch {}
      });
    }

    popup.webContents.setWindowOpenHandler(({ url }) => {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          parent: popup,
          modal: false,
          backgroundColor: "#0b0b0b",
          title: "Dexify",
          autoHideMenuBar: true,
          ...(appIcon ? { icon: appIcon } : {}),
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            nativeWindowOpen: true,
          },
        },
      };
    });

    popup.webContents.on("did-create-window", (child) => {
      try {
        child.setMenuBarVisibility(false);
      } catch {}
      try {
        child.webContents.setWindowOpenHandler(() => {
          return {
            action: "allow",
            overrideBrowserWindowOptions: {
              parent: child,
              modal: false,
              backgroundColor: "#0b0b0b",
              title: "Dexify",
              autoHideMenuBar: true,
              ...(appIcon ? { icon: appIcon } : {}),
              webPreferences: {
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
                nativeWindowOpen: true,
              },
            },
          };
        });
      } catch {}
    });

    return popup;
  }

  return { createMainWindow, createLoginPopup };
};
