import { ApiKeyRecord, AuthVerified, KeyStatus, LastKnownGood } from './key';
import { ProviderConfig } from './provider';
import { TestResult } from './test';
import { ChatSession } from './chat';
import { AppSettings } from './settings';

export interface AppInfo {
  version: string;
  platform: 'darwin' | 'linux' | 'win32';
  arch: 'arm64' | 'x64' | string;
  isPackaged: boolean;
  keychainAvailable: boolean;
  corruptionNotice?: string | null;
}

export interface KeySaveInput {
  id?: string;
  providerId: string;
  label: string;
  secret: string; // Input-only; never echoed back
  baseUrl?: string; // Validated to derive boundHost
  selectedModel?: string;
  group?: string;
  labels?: string[];
}

export interface KeyMeta extends ApiKeyRecord {
  secretMissing?: boolean;
}

export interface KeyMetaPatch {
  label?: string;
  status?: KeyStatus;
  authVerified?: AuthVerified;
  lastTestedAt?: string;
  lastKnownGood?: LastKnownGood;
  selectedModel?: string;
  customBaseUrl?: string;
  customParams?: Record<string, string>;
  group?: string;
  labels?: string[];
}

export interface ApiRequestPayload {
  requestId: string;
  keyId?: string; // Main looks up secret by keyId and substitutes {{secret}}
  boundHost?: string;
  providerId?: string;
  allowLocalHttp?: boolean;
  url: string;
  method: 'GET' | 'POST' | 'DELETE';
  headers: Record<string, string>; // May contain '{{secret}}' placeholder, never raw secret
  query?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface ElectronApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  latencyMs: number;
  errorCode?: string;
}

export type StreamEvent =
  | {
      requestId: string;
      type: 'chunk';
      chunk: string;
      status?: number;
      headers?: Record<string, string>;
    }
  | {
      requestId: string;
      type: 'done';
      status: number;
      statusText: string;
      headers: Record<string, string>;
      bodyText: string;
      latencyMs: number;
    }
  | {
      requestId: string;
      type: 'error';
      errorCode: string;
      message: string;
      status?: number;
      latencyMs: number;
    }
  | {
      requestId: string;
      type: 'aborted';
      latencyMs: number;
    };

export type StoreCollection =
  | 'keys_meta'
  | 'settings'
  | 'history'
  | 'custom_providers'
  | 'chat_sessions'
  | 'local_consents';

export interface StoreCollectionMap {
  keys_meta: KeyMeta[];
  settings: AppSettings;
  history: TestResult[];
  custom_providers: ProviderConfig[];
  chat_sessions: ChatSession[];
  local_consents: Record<string, boolean>;
}

export interface BackupCreateOpts {
  includeSecrets: boolean;
  passphrase?: string;
}

export interface BackupImportOpts {
  passphrase?: string;
  rawJsonContent?: string;
}

export interface ImportReport {
  canceled?: boolean;
  keysImported: number;
  providersImported: number;
  historyImported: number;
}

export interface FileExportOpts {
  defaultName: string;
  content: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface PendingRegistryHostChange {
  providerId: string;
  providerName: string;
  currentHosts: string[];
  proposedHosts: string[];
  proposedBaseUrl?: string | null;
  affectedKeyCount: number;
  remoteVersion: number;
}

export interface RegistryStatusInfo {
  activeVersion: number;
  bundledVersion: number;
  activeSource: 'bundled' | 'verified-disk' | 'verified-remote';
  providerCount: number;
  pendingHostChanges: PendingRegistryHostChange[];
  lastNotice: string | null;
  providers: ProviderConfig[];
}

export interface RegistryUpdateResult {
  applied: boolean;
  status: 'applied' | 'pending_host_approval' | 'rejected' | 'offline_fallback';
  errorCode?: string;
  notice: string;
  activeVersion: number;
  activeSource: 'bundled' | 'verified-disk' | 'verified-remote';
  providers: ProviderConfig[];
  pendingHostChanges: PendingRegistryHostChange[];
  usedOfflineFallback?: boolean;
}

export interface LeakFinding {
  id: string;
  providerId: string;
  providerName: string;
  filePath: string;
  relativePath: string;
  lineNumber: number;
  maskedFingerprint: string;
  isGitRepo: boolean;
  rotated: boolean;
}

export interface LeakScanReport {
  canceled?: boolean;
  scannedFolders: string[];
  scannedAt: string;
  filesScanned: number;
  filesSkipped: number;
  containsGitRepo: boolean;
  gitWarning: string | null;
  findings: LeakFinding[];
}

export interface LocalGatewayConfig {
  enabled: boolean;
  port: number;
  priorityKeyIds: string[];
  enableAutomaticFailover: boolean;
  maxRequestsBudget: number;
  requestsUsed: number;
  maxRequestsPerMinutePerKey: number;
}

export interface GatewayActivityLogEntry {
  id: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  latencyMs: number;
  status: number;
  errorCategory?: string;
}

export interface GatewayStatusSnapshot {
  running: boolean;
  bindAddress: '127.0.0.1';
  port: number;
  baseUrl: string;
  maskedToken: string;
  config: LocalGatewayConfig;
  workingKeyCount: number;
  recentLogs: GatewayActivityLogEntry[];
}

export interface ElectronAPI {
  app: {
    getInfo(): Promise<AppInfo>;
    onNavigate(cb: (route: string) => void): () => void;
    onMenuAction(cb: (action: string) => void): () => void;
  };
  keys: {
    save(input: KeySaveInput): Promise<KeyMeta>;
    updateMeta(id: string, patch: KeyMetaPatch): Promise<KeyMeta>;
    delete(id: string): Promise<void>;
    list(): Promise<KeyMeta[]>; // Metadata only — NEVER includes secret
    copySecret(id: string): Promise<{ copied: boolean; clearAfterMs: number }>;
    revealSecret(id: string): Promise<{ secret: string; expiresAfterMs: number }>;
    rebindHost(id: string, newBaseUrl: string): Promise<KeyMeta>;
  };
  api: {
    request(payload: ApiRequestPayload): Promise<ElectronApiResponse>;
    streamStart(payload: ApiRequestPayload): Promise<{ requestId: string }>;
    streamAbort(requestId: string): Promise<void>;
    onStreamEvent(cb: (event: StreamEvent) => void): () => void;
  };
  store: {
    read<K extends StoreCollection>(collection: K): Promise<StoreCollectionMap[K]>;
    write<K extends StoreCollection>(collection: K, data: StoreCollectionMap[K]): Promise<void>;
  };
  backup: {
    create(opts: BackupCreateOpts): Promise<{ saved: boolean; filePath?: string }>;
    importFile(opts: BackupImportOpts): Promise<ImportReport>;
  };
  files: {
    exportText(opts: FileExportOpts): Promise<{ saved: boolean; filePath?: string }>;
  };
  external: {
    open(url: string): Promise<{ opened: boolean }>;
  };
  data: {
    eraseAll(): Promise<{ erased: boolean }>;
    clearLogs?(): Promise<{ cleared: boolean }>;
  };
  registry?: {
    getStatus(): Promise<RegistryStatusInfo>;
    verifyAndApply(params: {
      sourceUrl: string;
      rawCanonicalJson: string;
      signatureBase64: string;
    }): Promise<RegistryUpdateResult>;
    fetchAndApply(params: { sourceUrl: string; signatureBase64?: string }): Promise<RegistryUpdateResult>;
    approveHostChange(providerId: string): Promise<RegistryUpdateResult>;
    rejectHostChange(providerId: string): Promise<RegistryUpdateResult>;
  };
  leakHunter?: {
    pickAndScanFolders(): Promise<LeakScanReport>;
    markRotated(findingId: string, rotated: boolean): Promise<{ id: string; rotated: boolean }>;
    revealInFinder(filePath: string): Promise<{ revealed: boolean }>;
  };
  gateway?: {
    getStatus(): Promise<GatewayStatusSnapshot>;
    start(port?: number): Promise<GatewayStatusSnapshot>;
    stop(): Promise<GatewayStatusSnapshot>;
    updateConfig(
      patch: Partial<Omit<LocalGatewayConfig, 'enabled'>> & { resetBudgetUsage?: boolean }
    ): Promise<GatewayStatusSnapshot>;
    revealToken(): Promise<{ token: string; expiresAfterMs: number }>;
    rotateToken(): Promise<{ maskedToken: string }>;
    clearLogs(): Promise<GatewayStatusSnapshot>;
  };
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

