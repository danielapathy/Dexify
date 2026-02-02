const { BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

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
  const shouldOpenDevTools = process.env.AUTO_OPEN_DEVTOOLS === "true";

  function createMainWindow() {
    const isMac = process.platform === "darwin";
    const win = new BrowserWindow({
      width: 1520,
      height: 860,
      minWidth: 1024,
      minHeight: 640,
      backgroundColor: "#0b0b0b",
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

    win.loadFile(path.join(rootDir, "index.html"));

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
