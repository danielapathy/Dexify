const { BrowserWindow } = require("electron");

function broadcastSessionChanged(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("auth:sessionChanged", payload);
  }
}

function broadcastDownloadEvent(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("dl:event", payload);
  }
}

module.exports = { broadcastSessionChanged, broadcastDownloadEvent };

