(() => {
  if (typeof require !== "function") return;

  const { contextBridge, ipcRenderer } = require("electron");

  const shouldLog = (() => {
    try {
      // Logging IPC payloads can be extremely expensive (large objects, frequent progress events).
      // Keep it opt-in via env flags to avoid janking the renderer during downloads.
      const debug = String(process.env.DEBUG_IPC || process.env.DEBUG_DOWNLOADS || "").trim();
      return debug === "true" || debug === "1" || debug === "verbose";
    } catch {
      return false;
    }
  })();

  const safeLog = (...args) => {
    if (!shouldLog) return;
    try {
      console.log(...args);
    } catch {}
  };

  const makeInvokeWithParams = (channel) => async (params) => {
    const startedAt = Date.now();
    safeLog(`[dl] invoke ${channel}`, params);
    const res = await ipcRenderer.invoke(channel, params);
    safeLog(`[dl] result ${channel}`, { ms: Date.now() - startedAt, res });
    return res;
  };

  const makeInvokeNoParams = (channel) => async () => {
    const startedAt = Date.now();
    safeLog(`[dl] invoke ${channel}`);
    const res = await ipcRenderer.invoke(channel);
    safeLog(`[dl] result ${channel}`, { ms: Date.now() - startedAt, res });
    return res;
  };

  contextBridge.exposeInMainWorld("auth", {
    login: () => ipcRenderer.invoke("auth:login"),
    logout: () => ipcRenderer.invoke("auth:logout"),
    getSession: () => ipcRenderer.invoke("auth:getSession"),
    onSessionChanged: (listener) => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, payload) => listener(payload);
      ipcRenderer.on("auth:sessionChanged", handler);
      return () => ipcRenderer.removeListener("auth:sessionChanged", handler);
    },
  });

  contextBridge.exposeInMainWorld("deezer", {
    getAppState: () => ipcRenderer.invoke("deezer:getAppState"),
    extractAppState: () => ipcRenderer.invoke("deezer:extractAppState"),
  });

  contextBridge.exposeInMainWorld("dz", {
    status: () => ipcRenderer.invoke("dz:status"),
    mainSearch: (params) => ipcRenderer.invoke("dz:mainSearch", params),
    search: (params) => ipcRenderer.invoke("dz:search", params),
    getUserFavorites: () => ipcRenderer.invoke("dz:getUserFavorites"),
    getUserTracks: (params) => ipcRenderer.invoke("dz:getUserTracks", params),
    getTrack: (params) => ipcRenderer.invoke("dz:getTrack", params),
    getCapabilities: () => ipcRenderer.invoke("dz:getCapabilities"),
    getTracklist: (params) => ipcRenderer.invoke("dz:getTracklist", params),
    getPage: (params) => ipcRenderer.invoke("dz:getPage", params),
    likeTrack: (id) => ipcRenderer.invoke("dz:likeTrack", { id }),
    unlikeTrack: (id) => ipcRenderer.invoke("dz:unlikeTrack", { id }),
  });

  contextBridge.exposeInMainWorld("app", {
    getPaths: () => ipcRenderer.invoke("app:getPaths"),
    openSessionDir: () => ipcRenderer.invoke("app:openSessionDir"),
    clearAppState: () => ipcRenderer.invoke("app:clearAppState"),
  });

  contextBridge.exposeInMainWorld("mobilePreview", {
    enable: () => ipcRenderer.invoke("mobilePreview:enable"),
    disable: () => ipcRenderer.invoke("mobilePreview:disable"),
  });

  contextBridge.exposeInMainWorld("dl", {
    downloadTrack: makeInvokeWithParams("dl:downloadTrack"),
    resolveTrack: makeInvokeWithParams("dl:resolveTrack"),
    listDownloads: makeInvokeNoParams("dl:listDownloads"),
    listPlaylists: makeInvokeNoParams("dl:listPlaylists"),
    getOfflineTracklist: makeInvokeWithParams("dl:getOfflineTracklist"),
    scanLibrary: makeInvokeNoParams("dl:scanLibrary"),
    healLibrary: makeInvokeWithParams("dl:healLibrary"),
    removeDownload: makeInvokeWithParams("dl:removeDownload"),
    deleteFromDisk: makeInvokeWithParams("dl:deleteFromDisk"),
    deleteAlbumFromDisk: makeInvokeWithParams("dl:deleteAlbumFromDisk"),
    deletePlaylistFromDisk: makeInvokeWithParams("dl:deletePlaylistFromDisk"),
    migrateLegacy: makeInvokeNoParams("dl:migrateLegacy"),
    downloadUrl: makeInvokeWithParams("dl:downloadUrl"),
    cancelDownload: makeInvokeWithParams("dl:cancelDownload"),
    onEvent: (listener) => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, payload) => {
        safeLog("[dl] event", payload);
        listener(payload);
      };
      ipcRenderer.on("dl:event", handler);
      return () => ipcRenderer.removeListener("dl:event", handler);
    },
  });
})();
