import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type {
  ApiRequestPayload,
  BackupCreateOpts,
  BackupImportOpts,
  ElectronAPI,
  FileExportOpts,
  KeyMetaPatch,
  KeySaveInput,
  StoreCollection,
  StoreCollectionMap,
  StreamEvent,
} from '../types/electron';

const electronAPI: ElectronAPI = {
  app: {
    getInfo: () => ipcRenderer.invoke('app:get-info'),
    onNavigate: (cb: (route: string) => void) => {
      const listener = (_event: IpcRendererEvent, route: string) => {
        if (typeof route === 'string') cb(route);
      };
      ipcRenderer.on('app:navigate', listener);
      return () => {
        ipcRenderer.removeListener('app:navigate', listener);
      };
    },
    onMenuAction: (cb: (action: string) => void) => {
      const listener = (_event: IpcRendererEvent, action: string) => {
        if (typeof action === 'string') cb(action);
      };
      ipcRenderer.on('app:menu-action', listener);
      return () => {
        ipcRenderer.removeListener('app:menu-action', listener);
      };
    },
  },
  keys: {
    save: (input: KeySaveInput) => ipcRenderer.invoke('keys:save', input),
    updateMeta: (id: string, patch: KeyMetaPatch) => ipcRenderer.invoke('keys:update-meta', id, patch),
    delete: (id: string) => ipcRenderer.invoke('keys:delete', id),
    list: () => ipcRenderer.invoke('keys:list'),
    copySecret: (id: string) => ipcRenderer.invoke('keys:copy-secret', id),
    revealSecret: (id: string) => ipcRenderer.invoke('keys:reveal-secret', id),
    rebindHost: (id: string, newBaseUrl: string) => ipcRenderer.invoke('keys:rebind-host', id, newBaseUrl),
  },
  api: {
    request: (payload: ApiRequestPayload) => ipcRenderer.invoke('api:request', payload),
    streamStart: (payload: ApiRequestPayload) => ipcRenderer.invoke('api:stream-start', payload),
    streamAbort: (requestId: string) => ipcRenderer.invoke('api:stream-abort', requestId),
    onStreamEvent: (cb: (event: StreamEvent) => void) => {
      const listener = (_event: IpcRendererEvent, streamEvent: StreamEvent) => {
        if (streamEvent && typeof streamEvent === 'object') {
          cb(streamEvent);
        }
      };
      ipcRenderer.on('api:stream-event', listener);
      return () => {
        ipcRenderer.removeListener('api:stream-event', listener);
      };
    },
  },
  store: {
    read: <K extends StoreCollection>(collection: K) => ipcRenderer.invoke('store:read', collection),
    write: <K extends StoreCollection>(collection: K, data: StoreCollectionMap[K]) =>
      ipcRenderer.invoke('store:write', collection, data),
  },
  backup: {
    create: (opts: BackupCreateOpts) => ipcRenderer.invoke('backup:create', opts),
    importFile: (opts: BackupImportOpts) => ipcRenderer.invoke('backup:import', opts),
  },
  files: {
    exportText: (opts: FileExportOpts) => ipcRenderer.invoke('files:export-text', opts),
  },
  external: {
    open: (url: string) => ipcRenderer.invoke('external:open', url),
  },
  data: {
    eraseAll: () => ipcRenderer.invoke('data:erase-all'),
    clearLogs: () => ipcRenderer.invoke('data:clear-logs'),
  },
  registry: {
    getStatus: () => ipcRenderer.invoke('registry:get-status'),
    verifyAndApply: (params) => ipcRenderer.invoke('registry:verify-and-apply', params),
    fetchAndApply: (params) => ipcRenderer.invoke('registry:fetch-and-apply', params),
    approveHostChange: (providerId: string) => ipcRenderer.invoke('registry:approve-host-change', providerId),
    rejectHostChange: (providerId: string) => ipcRenderer.invoke('registry:reject-host-change', providerId),
  },
  leakHunter: {
    pickAndScanFolders: () => ipcRenderer.invoke('leakhunter:pick-and-scan'),
    markRotated: (findingId: string, rotated: boolean) =>
      ipcRenderer.invoke('leakhunter:mark-rotated', findingId, rotated),
    revealInFinder: (filePath: string) => ipcRenderer.invoke('leakhunter:reveal-in-finder', filePath),
  },
  gateway: {
    getStatus: () => ipcRenderer.invoke('gateway:get-status'),
    start: (port?: number) => ipcRenderer.invoke('gateway:start', port),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    updateConfig: (patch) => ipcRenderer.invoke('gateway:update-config', patch),
    revealToken: () => ipcRenderer.invoke('gateway:reveal-token'),
    rotateToken: () => ipcRenderer.invoke('gateway:rotate-token'),
    clearLogs: () => ipcRenderer.invoke('gateway:clear-logs'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', Object.freeze(electronAPI));

