(() => {
  if (typeof require !== "function") return;

  const { contextBridge, ipcRenderer } = require("electron");

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

  contextBridge.exposeInMainWorld("dl", {
    downloadTrack: async (params) => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:downloadTrack", params);
      } catch {}
      const res = await ipcRenderer.invoke("dl:downloadTrack", params);
      try {
        console.log("[dl] result dl:downloadTrack", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    resolveTrack: async (params) => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:resolveTrack", params);
      } catch {}
      const res = await ipcRenderer.invoke("dl:resolveTrack", params);
      try {
        console.log("[dl] result dl:resolveTrack", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    listDownloads: async () => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:listDownloads");
      } catch {}
      const res = await ipcRenderer.invoke("dl:listDownloads");
      try {
        console.log("[dl] result dl:listDownloads", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    scanLibrary: async () => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:scanLibrary");
      } catch {}
      const res = await ipcRenderer.invoke("dl:scanLibrary");
      try {
        console.log("[dl] result dl:scanLibrary", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    healLibrary: async (params) => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:healLibrary", params);
      } catch {}
      const res = await ipcRenderer.invoke("dl:healLibrary", params);
      try {
        console.log("[dl] result dl:healLibrary", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    removeDownload: async (params) => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:removeDownload", params);
      } catch {}
      const res = await ipcRenderer.invoke("dl:removeDownload", params);
      try {
        console.log("[dl] result dl:removeDownload", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    deleteFromDisk: async (params) => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:deleteFromDisk", params);
      } catch {}
      const res = await ipcRenderer.invoke("dl:deleteFromDisk", params);
      try {
        console.log("[dl] result dl:deleteFromDisk", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    migrateLegacy: async () => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:migrateLegacy");
      } catch {}
      const res = await ipcRenderer.invoke("dl:migrateLegacy");
      try {
        console.log("[dl] result dl:migrateLegacy", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    downloadUrl: async (params) => {
      const startedAt = Date.now();
      try {
        console.log("[dl] invoke dl:downloadUrl", params);
      } catch {}
      const res = await ipcRenderer.invoke("dl:downloadUrl", params);
      try {
        console.log("[dl] result dl:downloadUrl", { ms: Date.now() - startedAt, res });
      } catch {}
      return res;
    },
    onEvent: (listener) => {
      if (typeof listener !== "function") return () => {};
      const handler = (_event, payload) => {
        try {
          console.log("[dl] event", payload);
        } catch {}
        listener(payload);
      };
      ipcRenderer.on("dl:event", handler);
      return () => ipcRenderer.removeListener("dl:event", handler);
    },
  });
})();
