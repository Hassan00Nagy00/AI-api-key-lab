import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  IpcMainInvokeEvent,
  Menu,
  nativeImage,
  protocol,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import { JsonStore, SanitizedLogger, writeFileAtomicSync } from './jsonStore';
import { SecretStore } from './secretStore';
import { MainProcessExecutor } from './mainExecutor';
import { IpcController, NativePlatformHooks } from './ipcHandlers';
import { validateExternalOpenUrl, verifyIpcSenderOrigin } from './ipcSchemas';
import { PACKAGED_CSP, resolveAppProtocolRequest } from './protocolHandler';
import { buildMacApplicationMenuTemplate } from './menu';

// 1. Register custom app:// scheme as privileged BEFORE app.whenReady() per §8 & §13
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
      stream: true,
    },
  },
]);

// 2. Enforce Single-Instance Lock per §8
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

interface PersistedWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
}

const DEFAULT_WIDTH = 1360;
const DEFAULT_HEIGHT = 860;
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 680;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ipcController: IpcController | null = null;
let loggerInstance: SanitizedLogger | null = null;
let jsonStoreInstance: JsonStore | null = null;
let mainExecutorInstance: MainProcessExecutor | null = null;

// Enforce navigation and popup restrictions on every WebContents created per 07_P3 §3
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event: { preventDefault(): void }, targetUrl: string) => {
    const check = verifyIpcSenderOrigin(targetUrl, {
      isPackaged: app.isPackaged,
      devServerUrl: process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000',
    });
    if (!check.valid) {
      event.preventDefault();
      const extCheck = validateExternalOpenUrl(targetUrl);
      if (extCheck.valid) {
        void shell.openExternal(extCheck.normalizedUrl);
      }
    }
  });

  contents.setWindowOpenHandler(({ url }: { url: string }) => {
    const extCheck = validateExternalOpenUrl(url);
    if (extCheck.valid) {
      void shell.openExternal(extCheck.normalizedUrl);
    }
    return { action: 'deny' };
  });
});

function loadValidatedWindowState(userDataDir: string): PersistedWindowState {
  const statePath = path.join(userDataDir, 'window-state.json');
  const fallback: PersistedWindowState = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  if (!fs.existsSync(statePath)) return fallback;

  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8')) as PersistedWindowState;
    const width = Math.max(MIN_WIDTH, Number(raw.width) || DEFAULT_WIDTH);
    const height = Math.max(MIN_HEIGHT, Number(raw.height) || DEFAULT_HEIGHT);

    if (typeof raw.x === 'number' && typeof raw.y === 'number') {
      const displays = screen.getAllDisplays();
      const visibleOnAnyDisplay = displays.some((d) => {
        const b = d.workArea;
        return (
          raw.x! >= b.x - 100 &&
          raw.y! >= b.y - 50 &&
          raw.x! + 200 <= b.x + b.width + 100 &&
          raw.y! + 100 <= b.y + b.height + 100
        );
      });
      if (visibleOnAnyDisplay) {
        return {
          x: raw.x,
          y: raw.y,
          width,
          height,
          isMaximized: Boolean(raw.isMaximized),
          isFullScreen: Boolean(raw.isFullScreen),
        };
      }
    }
    return { width, height };
  } catch {
    return fallback;
  }
}

function saveWindowState(win: BrowserWindow, userDataDir: string): void {
  try {
    const bounds = win.getBounds();
    const state: PersistedWindowState = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
    };
    writeFileAtomicSync(path.join(userDataDir, 'window-state.json'), JSON.stringify(state, null, 2), 0o600);
  } catch {
    // ignore
  }
}

function assertAuthorizedSender(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url;
  const check = verifyIpcSenderOrigin(senderUrl, {
    isPackaged: app.isPackaged,
    devServerUrl: process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000',
  });
  if (!check.valid) {
    throw new Error(`IPC Security Error: ${check.reason}`);
  }
}

function createMainWindow(userDataDir: string): BrowserWindow {
  const winState = loadValidatedWindowState(userDataDir);

  const win = new BrowserWindow({
    x: winState.x,
    y: winState.y,
    width: winState.width,
    height: winState.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: 'AI API Key Lab',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      enableBlinkFeatures: '',
      spellcheck: false,
    },
  });

  if (winState.isMaximized) {
    win.maximize();
  }
  if (winState.isFullScreen) {
    win.setFullScreen(true);
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('close', () => {
    saveWindowState(win, userDataDir);
  });

  if (app.isPackaged) {
    void win.loadURL('app://-/dashboard');
  } else {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:3000';
    void win.loadURL(devUrl);
  }

  return win;
}

function setupTrayIfNeeded(distOrRootDir: string): void {
  const templateIconPath = path.resolve(distOrRootDir, 'assets', 'iconTemplate.png');
  if (!fs.existsSync(templateIconPath)) return;

  try {
    const img = nativeImage.createFromPath(templateIconPath);
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip('AI API Key Lab');
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open AI API Key Lab',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        },
      },
      {
        label: 'Test All Keys',
        click: () => {
          mainWindow?.webContents.send('app:menu-action', 'test-all-keys');
        },
      },
      { type: 'separator' },
      { label: 'Quit AI API Key Lab', role: 'quit' },
    ]);
    tray.setContextMenu(contextMenu);
  } catch {
    // ignore tray failure in headless environments
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData');
  const logsDir = app.getPath('logs');

  loggerInstance = new SanitizedLogger(logsDir);
  const jsonStore = new JsonStore(userDataDir, loggerInstance);
  jsonStoreInstance = jsonStore;
  const secretStore = new SecretStore(userDataDir, safeStorage, loggerInstance);
  const mainExecutor = new MainProcessExecutor({
    secretStore,
    jsonStore,
    logger: loggerInstance,
    resolveProxy: (url: string) => session.defaultSession.resolveProxy(url),
  });
  mainExecutorInstance = mainExecutor;

  // Startup proxy detection check per 07_P3 §0A.2
  void mainExecutor.checkSystemProxy('https://generativelanguage.googleapis.com');

  const platformHooks: NativePlatformHooks = {
    getAppVersion: () => app.getVersion(),
    isPackaged: () => app.isPackaged,
    confirmSensitiveAction: async ({ title, message, detail }) => {
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID?.()) {
        try {
          await systemPreferences.promptTouchID(message);
          return true;
        } catch {
          // Fall back to explicit confirmation dialog if Touch ID is canceled or unavailable
        }
      }
      const res = await dialog.showMessageBox(mainWindow ? mainWindow : (undefined as any), {
        type: 'warning',
        buttons: ['Cancel', 'Confirm'],
        defaultId: 1,
        cancelId: 0,
        title,
        message,
        detail,
      });
      return res.response === 1;
    },
    writeClipboardText: (text: string) => {
      clipboard.writeText(text);
      if (process.platform === 'darwin' && text.length > 0) {
        try {
          // Mark copied secret as concealed for macOS clipboard managers per 07_P3 §6
          clipboard.writeBuffer('org.nspasteboard.ConcealedType', Buffer.from('concealed'));
        } catch {
          // ignore if unsupported by platform
        }
      }
    },
    readClipboardText: () => clipboard.readText(),
    showSaveDialog: async (opts) => {
      const res = await dialog.showSaveDialog(mainWindow ? mainWindow : (undefined as any), {
        defaultPath: opts.defaultPath,
        filters: opts.filters,
      });
      return { canceled: res.canceled, filePath: res.filePath };
    },
    showOpenDialog: async (opts) => {
      const res = await dialog.showOpenDialog(mainWindow ? mainWindow : (undefined as any), {
        properties: ['openFile'],
        filters: opts.filters,
      });
      return { canceled: res.canceled, filePaths: res.filePaths };
    },
    showOpenFolderDialog: async () => {
      const res = await dialog.showOpenDialog(mainWindow ? mainWindow : (undefined as any), {
        title: 'Select Project Folder(s) to Scan for Plain-Text API Keys',
        properties: ['openDirectory', 'multiSelections'],
      });
      return { canceled: res.canceled, filePaths: res.filePaths };
    },
    revealFileInFinder: (filePath: string) => {
      shell.showItemInFolder(filePath);
    },
    openExternalUrl: async (url: string) => {
      await shell.openExternal(url);
    },
  };

  ipcController = new IpcController({
    jsonStore,
    secretStore,
    executor: mainExecutor,
    logger: loggerInstance,
    platform: platformHooks,
    userDataDir,
  });

  // 3. Deny all hardware/browser permission requests (camera, mic, geolocation, notifications, midi, etc.)
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  // 4. Register custom app:// protocol handler serving built dist/ assets
  const distRoot = path.resolve(__dirname, '..', 'dist');
  protocol.handle('app', (request) => {
    const resolved = resolveAppProtocolRequest(request.url, distRoot);
    if (resolved.status !== 200 || !resolved.filePath) {
      return new Response(resolved.status === 403 ? 'Forbidden' : 'Not Found', {
        status: resolved.status,
        headers: resolved.headers,
      });
    }
    const fileBuf = fs.readFileSync(resolved.filePath);
    return new Response(fileBuf, {
      status: 200,
      headers: {
        ...resolved.headers,
        'Content-Type': resolved.mimeType,
      },
    });
  });

  // Enforce strict origin blocking and CSP on all renderer responses in packaged app per 07_P3 §3 & §10
  if (app.isPackaged) {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const isAppOrigin =
        details.url.startsWith('app://-/') ||
        details.url.startsWith('devtools://') ||
        details.url.startsWith('data:');
      callback({ cancel: !isAppOrigin });
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PACKAGED_CSP],
        },
      });
    });
  }

  // 5. Register all validated IPC handlers
  ipcMain.handle('app:get-info', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.getAppInfo();
  });

  ipcMain.handle('keys:save', (event, input) => {
    assertAuthorizedSender(event);
    return ipcController!.keysSave(input);
  });

  ipcMain.handle('keys:update-meta', (event, id, patch) => {
    assertAuthorizedSender(event);
    return ipcController!.keysUpdateMeta(id, patch);
  });

  ipcMain.handle('keys:delete', (event, id) => {
    assertAuthorizedSender(event);
    return ipcController!.keysDelete(id);
  });

  ipcMain.handle('keys:list', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.keysList();
  });

  ipcMain.handle('keys:copy-secret', (event, id) => {
    assertAuthorizedSender(event);
    return ipcController!.keysCopySecret(id);
  });

  ipcMain.handle('keys:reveal-secret', (event, id) => {
    assertAuthorizedSender(event);
    return ipcController!.keysRevealSecret(id);
  });

  ipcMain.handle('keys:rebind-host', (event, id, newBaseUrl) => {
    assertAuthorizedSender(event);
    return ipcController!.keysRebindHost(id, newBaseUrl);
  });

  ipcMain.handle('api:request', (event, payload) => {
    assertAuthorizedSender(event);
    return ipcController!.apiRequest(payload);
  });

  ipcMain.handle('api:stream-start', (event, payload) => {
    assertAuthorizedSender(event);
    return ipcController!.apiStreamStart(payload, (streamEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('api:stream-event', streamEvent);
      }
    });
  });

  ipcMain.handle('api:stream-abort', (event, requestId) => {
    assertAuthorizedSender(event);
    return ipcController!.apiStreamAbort(requestId);
  });

  ipcMain.handle('store:read', (event, collection) => {
    assertAuthorizedSender(event);
    return ipcController!.storeRead(collection);
  });

  ipcMain.handle('store:write', (event, collection, data) => {
    assertAuthorizedSender(event);
    if (collection === 'settings' && data && typeof data === 'object' && 'language' in data) {
      const lang = (data as any).language === 'ar' ? 'ar' : 'en';
      const menuTemplate = buildMacApplicationMenuTemplate(
        lang,
        {
          onNavigate: (r) => mainWindow?.webContents.send('app:navigate', r),
          onMenuAction: (a) => mainWindow?.webContents.send('app:menu-action', a),
        },
        !app.isPackaged
      );
      Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate as any));
    }
    return ipcController!.storeWrite(collection, data);
  });

  ipcMain.handle('backup:create', (event, opts) => {
    assertAuthorizedSender(event);
    return ipcController!.backupCreate(opts);
  });

  ipcMain.handle('backup:import', (event, opts) => {
    assertAuthorizedSender(event);
    return ipcController!.backupImport(opts);
  });

  ipcMain.handle('files:export-text', (event, opts) => {
    assertAuthorizedSender(event);
    return ipcController!.filesExportText(opts);
  });

  ipcMain.handle('external:open', (event, url) => {
    assertAuthorizedSender(event);
    return ipcController!.externalOpen(url);
  });

  ipcMain.handle('data:erase-all', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.dataEraseAll();
  });

  ipcMain.handle('data:clear-logs', (event) => {
    assertAuthorizedSender(event);
    loggerInstance?.clearLogs();
    return { cleared: true };
  });

  // ADD-ON A: Signed Registry Updates
  ipcMain.handle('registry:get-status', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.registryGetStatus();
  });

  ipcMain.handle('registry:verify-and-apply', (event, params) => {
    assertAuthorizedSender(event);
    return ipcController!.registryVerifyAndApply(params);
  });

  ipcMain.handle('registry:fetch-and-apply', (event, params) => {
    assertAuthorizedSender(event);
    return ipcController!.registryFetchAndApply(params);
  });

  ipcMain.handle('registry:approve-host-change', (event, providerId) => {
    assertAuthorizedSender(event);
    return ipcController!.registryApproveHostChange(providerId);
  });

  ipcMain.handle('registry:reject-host-change', (event, providerId) => {
    assertAuthorizedSender(event);
    return ipcController!.registryRejectHostChange(providerId);
  });

  // ADD-ON B: Leak Hunter
  ipcMain.handle('leakhunter:pick-and-scan', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.leakHunterPickAndScanFolders();
  });

  ipcMain.handle('leakhunter:mark-rotated', (event, findingId, rotated) => {
    assertAuthorizedSender(event);
    return ipcController!.leakHunterMarkRotated(findingId, rotated);
  });

  ipcMain.handle('leakhunter:reveal-in-finder', (event, filePath) => {
    assertAuthorizedSender(event);
    return ipcController!.leakHunterRevealInFinder(filePath);
  });

  // ADD-ON C: Local Gateway
  ipcMain.handle('gateway:get-status', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayGetStatus();
  });

  ipcMain.handle('gateway:start', (event, port) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayStart(port);
  });

  ipcMain.handle('gateway:stop', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayStop();
  });

  ipcMain.handle('gateway:update-config', (event, patch) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayUpdateConfig(patch);
  });

  ipcMain.handle('gateway:reveal-token', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayRevealToken();
  });

  ipcMain.handle('gateway:rotate-token', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayRotateToken();
  });

  ipcMain.handle('gateway:clear-logs', (event) => {
    assertAuthorizedSender(event);
    return ipcController!.gatewayClearLogs();
  });

  // 6. Build native macOS application menu
  const currentSettings = jsonStore.read('settings');
  const initialLang = currentSettings.language === 'ar' ? 'ar' : 'en';
  const menuTemplate = buildMacApplicationMenuTemplate(
    initialLang,
    {
      onNavigate: (route) => mainWindow?.webContents.send('app:navigate', route),
      onMenuAction: (action) => mainWindow?.webContents.send('app:menu-action', action),
    },
    !app.isPackaged
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate as any));

  // 7. Create main BrowserWindow & optional menu bar Tray
  mainWindow = createMainWindow(userDataDir);
  setupTrayIfNeeded(path.resolve(__dirname, '..'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow(userDataDir);
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// Flush stores and cancel active streams on before-quit per 07_P3 §13
app.on('before-quit', () => {
  mainExecutorInstance?.abortAllStreams();
  jsonStoreInstance?.flush();
  if (ipcController) {
    void ipcController.shutdown();
  }
});

app.on('window-all-closed', () => {
  const quitOnClose = Boolean(jsonStoreInstance?.read('settings').quitOnLastWindowClosed);
  if (process.platform !== 'darwin' || quitOnClose) {
    app.quit();
  }
});

