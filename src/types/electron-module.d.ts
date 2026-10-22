declare module 'electron' {
  export interface IpcRendererEvent {
    sender: any;
    senderId: number;
  }

  export interface IpcMainInvokeEvent {
    frameId: number;
    processId: number;
    sender: {
      isDestroyed(): boolean;
      send(channel: string, ...args: any[]): void;
    };
    senderFrame?: {
      url: string;
    } | null;
  }

  export const contextBridge: {
    exposeInMainWorld(apiKey: string, api: any): void;
  };

  export const ipcRenderer: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void;
    removeListener(channel: string, listener: (...args: any[]) => void): void;
  };

  export const ipcMain: {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: any[]) => any): void;
  };

  export const app: {
    isPackaged: boolean;
    getVersion(): string;
    getPath(name: 'userData' | 'logs' | 'temp' | 'home' | 'appData'): string;
    requestSingleInstanceLock(): boolean;
    quit(): void;
    whenReady(): Promise<void>;
    on(event: string, listener: (...args: any[]) => void): void;
  };

  export class BrowserWindow {
    static getAllWindows(): BrowserWindow[];
    webContents: {
      send(channel: string, ...args: any[]): void;
      on(event: string, listener: (...args: any[]) => void): void;
      setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
    };
    constructor(options?: Record<string, any>);
    loadURL(url: string): Promise<void>;
    show(): void;
    focus(): void;
    restore(): void;
    maximize(): void;
    isMinimized(): boolean;
    isMaximized(): boolean;
    isFullScreen(): boolean;
    setFullScreen(flag: boolean): void;
    getBounds(): { x: number; y: number; width: number; height: number };
    once(event: string, listener: (...args: any[]) => void): void;
    on(event: string, listener: (...args: any[]) => void): void;
  }

  export const safeStorage: {
    isEncryptionAvailable(): boolean;
    encryptString(plainText: string): Buffer;
    decryptString(encrypted: Buffer): string;
  };

  export const clipboard: {
    writeText(text: string): void;
    writeBuffer(format: string, buffer: Buffer): void;
    readText(): string;
  };

  export const dialog: {
    showMessageBox(
      browserWindow: BrowserWindow | undefined,
      options: {
        type?: string;
        buttons?: string[];
        defaultId?: number;
        cancelId?: number;
        title?: string;
        message: string;
        detail?: string;
      }
    ): Promise<{ response: number }>;
    showSaveDialog(
      browserWindow: BrowserWindow | undefined,
      options: {
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }
    ): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(
      browserWindow: BrowserWindow | undefined,
      options: {
        title?: string;
        properties?: string[];
        filters?: { name: string; extensions: string[] }[];
      }
    ): Promise<{ canceled: boolean; filePaths: string[] }>;
  };

  export const shell: {
    openExternal(url: string): Promise<void>;
    showItemInFolder(fullPath: string): void;
  };


  export const systemPreferences: {
    canPromptTouchID?(): boolean;
    promptTouchID(reason: string): Promise<void>;
  };

  export const protocol: {
    registerSchemesAsPrivileged(
      customSchemes: {
        scheme: string;
        privileges?: {
          standard?: boolean;
          secure?: boolean;
          supportFetchAPI?: boolean;
          corsEnabled?: boolean;
          stream?: boolean;
        };
      }[]
    ): void;
    handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void;
  };

  export const session: {
    defaultSession: {
      resolveProxy(url: string): Promise<string>;
      setPermissionRequestHandler(
        handler: (webContents: any, permission: string, callback: (permissionGranted: boolean) => void) => void
      ): void;
      setPermissionCheckHandler(handler: (webContents: any, permission: string) => boolean): void;
      webRequest: {
        onBeforeRequest(
          listener: (
            details: { url: string },
            callback: (response: { cancel?: boolean }) => void
          ) => void
        ): void;
        onHeadersReceived(
          listener: (
            details: { responseHeaders?: Record<string, string[]> },
            callback: (response: { responseHeaders?: Record<string, string[]> }) => void
          ) => void
        ): void;
      };
    };
  };

  export const screen: {
    getAllDisplays(): {
      workArea: { x: number; y: number; width: number; height: number };
    }[];
  };

  export const Menu: {
    buildFromTemplate(template: Record<string, any>[]): any;
    setApplicationMenu(menu: any): void;
  };

  export const nativeImage: {
    createFromPath(path: string): {
      setTemplateImage(option: boolean): void;
    };
  };

  export class Tray {
    constructor(image: any);
    setToolTip(toolTip: string): void;
    setContextMenu(menu: any): void;
  }
}
