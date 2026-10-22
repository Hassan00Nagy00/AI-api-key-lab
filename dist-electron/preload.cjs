// src/electron/preload.ts
var import_electron = require("electron");
var electronAPI = {
  app: {
    getInfo: () => import_electron.ipcRenderer.invoke("app:get-info"),
    onNavigate: (cb) => {
      const listener = (_event, route) => {
        if (typeof route === "string") cb(route);
      };
      import_electron.ipcRenderer.on("app:navigate", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("app:navigate", listener);
      };
    },
    onMenuAction: (cb) => {
      const listener = (_event, action) => {
        if (typeof action === "string") cb(action);
      };
      import_electron.ipcRenderer.on("app:menu-action", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("app:menu-action", listener);
      };
    }
  },
  keys: {
    save: (input) => import_electron.ipcRenderer.invoke("keys:save", input),
    updateMeta: (id, patch) => import_electron.ipcRenderer.invoke("keys:update-meta", id, patch),
    delete: (id) => import_electron.ipcRenderer.invoke("keys:delete", id),
    list: () => import_electron.ipcRenderer.invoke("keys:list"),
    copySecret: (id) => import_electron.ipcRenderer.invoke("keys:copy-secret", id),
    revealSecret: (id) => import_electron.ipcRenderer.invoke("keys:reveal-secret", id),
    rebindHost: (id, newBaseUrl) => import_electron.ipcRenderer.invoke("keys:rebind-host", id, newBaseUrl)
  },
  api: {
    request: (payload) => import_electron.ipcRenderer.invoke("api:request", payload),
    streamStart: (payload) => import_electron.ipcRenderer.invoke("api:stream-start", payload),
    streamAbort: (requestId) => import_electron.ipcRenderer.invoke("api:stream-abort", requestId),
    onStreamEvent: (cb) => {
      const listener = (_event, streamEvent) => {
        if (streamEvent && typeof streamEvent === "object") {
          cb(streamEvent);
        }
      };
      import_electron.ipcRenderer.on("api:stream-event", listener);
      return () => {
        import_electron.ipcRenderer.removeListener("api:stream-event", listener);
      };
    }
  },
  store: {
    read: (collection) => import_electron.ipcRenderer.invoke("store:read", collection),
    write: (collection, data) => import_electron.ipcRenderer.invoke("store:write", collection, data)
  },
  backup: {
    create: (opts) => import_electron.ipcRenderer.invoke("backup:create", opts),
    importFile: (opts) => import_electron.ipcRenderer.invoke("backup:import", opts)
  },
  files: {
    exportText: (opts) => import_electron.ipcRenderer.invoke("files:export-text", opts)
  },
  external: {
    open: (url) => import_electron.ipcRenderer.invoke("external:open", url)
  },
  data: {
    eraseAll: () => import_electron.ipcRenderer.invoke("data:erase-all"),
    clearLogs: () => import_electron.ipcRenderer.invoke("data:clear-logs")
  },
  registry: {
    getStatus: () => import_electron.ipcRenderer.invoke("registry:get-status"),
    verifyAndApply: (params) => import_electron.ipcRenderer.invoke("registry:verify-and-apply", params),
    fetchAndApply: (params) => import_electron.ipcRenderer.invoke("registry:fetch-and-apply", params),
    approveHostChange: (providerId) => import_electron.ipcRenderer.invoke("registry:approve-host-change", providerId),
    rejectHostChange: (providerId) => import_electron.ipcRenderer.invoke("registry:reject-host-change", providerId)
  },
  leakHunter: {
    pickAndScanFolders: () => import_electron.ipcRenderer.invoke("leakhunter:pick-and-scan"),
    markRotated: (findingId, rotated) => import_electron.ipcRenderer.invoke("leakhunter:mark-rotated", findingId, rotated),
    revealInFinder: (filePath) => import_electron.ipcRenderer.invoke("leakhunter:reveal-in-finder", filePath)
  },
  gateway: {
    getStatus: () => import_electron.ipcRenderer.invoke("gateway:get-status"),
    start: (port) => import_electron.ipcRenderer.invoke("gateway:start", port),
    stop: () => import_electron.ipcRenderer.invoke("gateway:stop"),
    updateConfig: (patch) => import_electron.ipcRenderer.invoke("gateway:update-config", patch),
    revealToken: () => import_electron.ipcRenderer.invoke("gateway:reveal-token"),
    rotateToken: () => import_electron.ipcRenderer.invoke("gateway:rotate-token"),
    clearLogs: () => import_electron.ipcRenderer.invoke("gateway:clear-logs")
  }
};
import_electron.contextBridge.exposeInMainWorld("electronAPI", Object.freeze(electronAPI));
