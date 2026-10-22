import crypto from 'node:crypto';
import fs from 'node:fs';
import {
  AppInfo,
  BackupCreateOpts,
  BackupImportOpts,
  ElectronApiResponse,
  FileExportOpts,
  GatewayStatusSnapshot,
  ImportReport,
  KeyMeta,
  KeyMetaPatch,
  KeySaveInput,
  LeakScanReport,
  RegistryStatusInfo,
  RegistryUpdateResult,
  StoreCollection,
  StoreCollectionMap,
  StreamEvent,
} from '../types/electron';
import { encryptData, decryptData, generateKeyFingerprint, maskKey } from '../services/crypto';
import { ProviderRegistry } from '../services/providerRegistry';
import { JsonStore, SanitizedLogger, writeFileAtomicSync } from './jsonStore';
import { SecretStore } from './secretStore';
import { MainProcessExecutor } from './mainExecutor';
import { SignedRegistryManager } from './signedRegistry';
import { LeakHunterService } from './leakHunter';
import { LocalGatewayService } from './localGateway';
import {
  ApiRequestPayloadSchema,
  BackupCreateOptsSchema,
  BackupImportOptsSchema,
  FileExportOptsSchema,
  FilePathSchema,
  GatewayConfigPatchSchema,
  GatewayPortOptionalSchema,
  KeyIdSchema,
  KeyMetaPatchSchema,
  KeyRebindInputSchema,
  KeySaveInputSchema,
  LeakMarkRotatedSchema,
  ProviderIdSchema,
  RegistryFetchInputSchema,
  RegistryVerifyInputSchema,
  StoreCollectionSchema,
  validateExternalOpenUrl,
} from './ipcSchemas';
import { validateOutboundUrlSync } from './ssrfGuard';
import { DecryptedBackupPayload, EncryptedBackupEnvelope } from '../types/backup';

export interface NativePlatformHooks {
  getAppVersion(): string;
  isPackaged(): boolean;
  confirmSensitiveAction(opts: { title: string; message: string; detail?: string }): Promise<boolean>;
  writeClipboardText(text: string): void;
  readClipboardText(): string;
  showSaveDialog(opts: {
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(opts: {
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  showOpenFolderDialog?(): Promise<{ canceled: boolean; filePaths: string[] }>;
  revealFileInFinder?(filePath: string): void;
  openExternalUrl(url: string): Promise<void>;
}

export class IpcController {
  private jsonStore: JsonStore;
  private secretStore: SecretStore;
  private executor: MainProcessExecutor;
  private logger: SanitizedLogger;
  private platform: NativePlatformHooks;
  private registryManager: SignedRegistryManager;
  private leakHunter: LeakHunterService;
  private localGateway: LocalGatewayService;
  private clipboardTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(deps: {
    jsonStore: JsonStore;
    secretStore: SecretStore;
    executor: MainProcessExecutor;
    logger: SanitizedLogger;
    platform: NativePlatformHooks;
    userDataDir?: string;
    registryManager?: SignedRegistryManager;
    leakHunter?: LeakHunterService;
    localGateway?: LocalGatewayService;
  }) {
    this.jsonStore = deps.jsonStore;
    this.secretStore = deps.secretStore;
    this.executor = deps.executor;
    this.logger = deps.logger;
    this.platform = deps.platform;

    const baseDir = deps.userDataDir || '.';
    this.registryManager =
      deps.registryManager ||
      new SignedRegistryManager({
        userDataDir: baseDir,
        logger: this.logger,
      });
    this.leakHunter =
      deps.leakHunter ||
      new LeakHunterService({
        userDataDir: baseDir,
        logger: this.logger,
      });
    this.localGateway =
      deps.localGateway ||
      new LocalGatewayService({
        userDataDir: baseDir,
        jsonStore: this.jsonStore,
        secretStore: this.secretStore,
        executor: this.executor,
        logger: this.logger,
      });

    // Run startup reconciliation between keys_meta.json and secrets.vault.json
    const currentMeta = this.jsonStore.read('keys_meta');
    const reconciled = this.secretStore.reconcileWithMetadata(currentMeta);
    if (reconciled.orphanSecretsRemoved > 0 || reconciled.missingSecretsCount > 0) {
      this.jsonStore.write('keys_meta', reconciled.reconciledMeta);
    }
  }


  getAppInfo(): AppInfo {
    return {
      version: this.platform.getAppVersion(),
      platform: (process.platform as 'darwin' | 'linux' | 'win32') || 'darwin',
      arch: process.arch || 'arm64',
      isPackaged: this.platform.isPackaged(),
      keychainAvailable: this.secretStore.isAvailable(),
      corruptionNotice: this.jsonStore.getCorruptionNotice(),
    };
  }

  async keysSave(rawInput: unknown): Promise<KeyMeta> {
    const input: KeySaveInput = KeySaveInputSchema.parse(rawInput);

    // Load custom providers into registry if needed
    const customProviders = this.jsonStore.read('custom_providers');
    for (const cp of customProviders) {
      ProviderRegistry.registerProvider(cp);
    }

    const provider = ProviderRegistry.get(input.providerId);
    const effectiveBaseUrl = input.baseUrl?.trim() || provider?.baseUrl;

    let boundHost = provider?.allowedHosts[0] || 'localhost';
    if (effectiveBaseUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(effectiveBaseUrl);
      } catch {
        throw new Error(`Invalid baseUrl: ${effectiveBaseUrl}`);
      }
      boundHost = parsedUrl.hostname.toLowerCase();

      // Validate SSRF on custom baseUrl
      const isLocalProvider = ['ollama', 'lmstudio', 'custom-local', 'local'].includes(input.providerId);
      const urlCheck = validateOutboundUrlSync(effectiveBaseUrl, {
        boundHost,
        providerId: input.providerId,
        allowLocalProviderHttp: isLocalProvider,
      });
      if (!urlCheck.valid) {
        throw new Error(urlCheck.error);
      }

      if (isLocalProvider && (boundHost === 'localhost' || boundHost === '127.0.0.1')) {
        const consents = this.jsonStore.read('local_consents');
        consents[`${input.providerId}:${boundHost}`] = true;
        this.jsonStore.write('local_consents', consents);
      }
    }

    const id = input.id || crypto.randomUUID();
    const trimmedSecret = input.secret.trim();

    // Fail-closed: save secret to Keychain first
    this.secretStore.saveSecret(id, trimmedSecret);

    const fingerprint = await generateKeyFingerprint(trimmedSecret);
    const masked = maskKey(trimmedSecret);
    const now = new Date().toISOString();

    const keysMeta = this.jsonStore.read('keys_meta');
    const existingIdx = keysMeta.findIndex((k) => k.id === id);

    const metaRecord: KeyMeta = {
      id,
      label: input.label.trim(),
      providerId: input.providerId,
      boundHost,
      keyFingerprint: fingerprint,
      maskedKey: masked,
      status: 'untested',
      authVerified: 'unknown',
      selectedModel: input.selectedModel,
      customBaseUrl: input.baseUrl?.trim() || undefined,
      group: input.group,
      labels: input.labels || [],
      createdAt: existingIdx >= 0 ? keysMeta[existingIdx].createdAt : now,
      updatedAt: now,
    };

    if (existingIdx >= 0) {
      keysMeta[existingIdx] = metaRecord;
    } else {
      keysMeta.push(metaRecord);
    }

    this.jsonStore.write('keys_meta', keysMeta);
    this.logger.log('INFO', 'Saved API key to Keychain vault', { keyId: id, providerId: input.providerId, boundHost });

    return metaRecord;
  }

  async keysUpdateMeta(rawId: unknown, rawPatch: unknown): Promise<KeyMeta> {
    const id = KeyIdSchema.parse(rawId);
    const patch: KeyMetaPatch = KeyMetaPatchSchema.parse(rawPatch);

    const keysMeta = this.jsonStore.read('keys_meta');
    const idx = keysMeta.findIndex((k) => k.id === id);
    if (idx < 0) {
      throw new Error(`Key "${id}" not found`);
    }

    const updated: KeyMeta = {
      ...keysMeta[idx],
      ...patch,
      id,
      updatedAt: new Date().toISOString(),
    };

    keysMeta[idx] = updated;
    this.jsonStore.write('keys_meta', keysMeta);
    return updated;
  }

  async keysDelete(rawId: unknown): Promise<void> {
    const id = KeyIdSchema.parse(rawId);
    const keysMeta = this.jsonStore.read('keys_meta').filter((k) => k.id !== id);
    this.jsonStore.write('keys_meta', keysMeta);
    this.secretStore.deleteSecret(id);
    this.logger.log('INFO', 'Deleted API key and secret', { keyId: id });
  }

  async keysList(): Promise<KeyMeta[]> {
    const keysMeta = this.jsonStore.read('keys_meta');
    const reconciled = this.secretStore.reconcileWithMetadata(keysMeta);
    return reconciled.reconciledMeta;
  }

  async keysCopySecret(rawId: unknown, clearAfterMs = 30000): Promise<{ copied: boolean; clearAfterMs: number }> {
    const id = KeyIdSchema.parse(rawId);
    const keysMeta = this.jsonStore.read('keys_meta');
    const meta = keysMeta.find((k) => k.id === id);
    if (!meta) {
      throw new Error(`Key "${id}" not found`);
    }

    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Copy Raw API Key to Clipboard',
      message: `Copy raw secret for "${meta.label}" (${meta.maskedKey})?`,
      detail: 'The key will be copied to your macOS clipboard and automatically cleared after 30 seconds.',
    });

    if (!confirmed) {
      return { copied: false, clearAfterMs: 0 };
    }

    const secret = this.secretStore.getSecret(id);
    if (!secret) {
      throw new Error('Secret is missing from Keychain vault');
    }

    this.platform.writeClipboardText(secret);

    const timer = setTimeout(() => {
      try {
        if (this.platform.readClipboardText() === secret) {
          this.platform.writeClipboardText('');
        }
      } catch {
        // ignore
      }
      this.clipboardTimers.delete(timer);
    }, clearAfterMs);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    this.clipboardTimers.add(timer);

    return { copied: true, clearAfterMs };
  }

  async keysRevealSecret(rawId: unknown): Promise<{ secret: string; expiresAfterMs: number }> {
    const id = KeyIdSchema.parse(rawId);
    const keysMeta = this.jsonStore.read('keys_meta');
    const meta = keysMeta.find((k) => k.id === id);
    if (!meta) {
      throw new Error(`Key "${id}" not found`);
    }

    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Reveal API Key Secret',
      message: `Authenticate to reveal "${meta.label}" (${meta.maskedKey})`,
      detail: 'The revealed secret will automatically re-mask after 15 seconds.',
    });

    if (!confirmed) {
      throw new Error('User canceled secret reveal');
    }

    const secret = this.secretStore.getSecret(id);
    if (!secret) {
      throw new Error('Secret is missing from Keychain vault');
    }

    return { secret, expiresAfterMs: 15000 };
  }

  async keysRebindHost(rawId: unknown, rawNewBaseUrl: unknown): Promise<KeyMeta> {
    const { id, newBaseUrl } = KeyRebindInputSchema.parse({ id: rawId, newBaseUrl: rawNewBaseUrl });
    const keysMeta = this.jsonStore.read('keys_meta');
    const idx = keysMeta.findIndex((k) => k.id === id);
    if (idx < 0) {
      throw new Error(`Key "${id}" not found`);
    }

    const meta = keysMeta[idx];
    let parsed: URL;
    try {
      parsed = new URL(newBaseUrl);
    } catch {
      throw new Error(`Invalid newBaseUrl: ${newBaseUrl}`);
    }

    const newHost = parsed.hostname.toLowerCase();
    const isLocalProvider = ['ollama', 'lmstudio', 'custom-local', 'local'].includes(meta.providerId);
    const ssrfCheck = validateOutboundUrlSync(newBaseUrl, {
      boundHost: newHost,
      providerId: meta.providerId,
      allowLocalProviderHttp: isLocalProvider,
    });

    if (!ssrfCheck.valid) {
      throw new Error(ssrfCheck.error);
    }

    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Re-bind API Key Host',
      message: `Change bound host for "${meta.label}" from "${meta.boundHost}" to "${newHost}"?`,
      detail: 'Your API key will only be transmitted to the newly bound host.',
    });

    if (!confirmed) {
      throw new Error('Host re-bind canceled by user');
    }

    const updated: KeyMeta = {
      ...meta,
      boundHost: newHost,
      customBaseUrl: newBaseUrl.trim(),
      status: 'untested',
      authVerified: 'unknown',
      updatedAt: new Date().toISOString(),
    };

    keysMeta[idx] = updated;
    this.jsonStore.write('keys_meta', keysMeta);
    this.logger.log('INFO', 'Re-bound API key host', { keyId: id, oldHost: meta.boundHost, newHost });
    return updated;
  }

  async apiRequest(rawPayload: unknown): Promise<ElectronApiResponse> {
    const payload = ApiRequestPayloadSchema.parse(rawPayload);
    return this.executor.executeRequest(payload);
  }

  async apiStreamStart(
    rawPayload: unknown,
    sendEvent: (event: StreamEvent) => void
  ): Promise<{ requestId: string }> {
    const payload = ApiRequestPayloadSchema.parse(rawPayload);
    void this.executor.startStream(payload, sendEvent);
    return { requestId: payload.requestId };
  }

  async apiStreamAbort(rawRequestId: unknown): Promise<void> {
    const requestId = KeyIdSchema.parse(rawRequestId);
    this.executor.abortStream(requestId);
  }

  async storeRead<K extends StoreCollection>(rawCollection: unknown): Promise<StoreCollectionMap[K]> {
    const collection = StoreCollectionSchema.parse(rawCollection) as K;
    if (collection === 'keys_meta') {
      return (await this.keysList()) as unknown as StoreCollectionMap[K];
    }
    return this.jsonStore.read(collection);
  }

  async storeWrite<K extends StoreCollection>(rawCollection: unknown, data: StoreCollectionMap[K]): Promise<void> {
    const collection = StoreCollectionSchema.parse(rawCollection) as K;
    this.jsonStore.write(collection, data);
  }

  async backupCreate(rawOpts: unknown): Promise<{ saved: boolean; filePath?: string }> {
    const opts: BackupCreateOpts = BackupCreateOptsSchema.parse(rawOpts);

    if (opts.includeSecrets) {
      if (!opts.passphrase || opts.passphrase.length < 8) {
        throw new Error('A passphrase of at least 8 characters is required when exporting secrets.');
      }

      const confirmed = await this.platform.confirmSensitiveAction({
        title: 'Export Encrypted Backup with Secrets',
        message: 'Include raw API key secrets in this encrypted backup file?',
        detail: 'Secrets will be encrypted using AES-256-GCM (PBKDF2-SHA256, 600,000 iterations).',
      });
      if (!confirmed) {
        return { saved: false };
      }
    }

    const keysMeta = await this.keysList();
    const secretsEntries: { keyId: string; secret: string }[] = [];
    if (opts.includeSecrets) {
      for (const k of keysMeta) {
        const s = this.secretStore.getSecret(k.id);
        if (s) secretsEntries.push({ keyId: k.id, secret: s });
      }
    }

    const payload: DecryptedBackupPayload = {
      keys: keysMeta,
      secrets: opts.includeSecrets ? secretsEntries : undefined,
      providers: this.jsonStore.read('custom_providers'),
      history: this.jsonStore.read('history'),
      chatSessions: this.jsonStore.read('chat_sessions'),
      settings: this.jsonStore.read('settings'),
      exportedAt: new Date().toISOString(),
    };

    const outputString = opts.includeSecrets && opts.passphrase
      ? JSON.stringify(await encryptData(JSON.stringify(payload), opts.passphrase), null, 2)
      : JSON.stringify(payload, null, 2);

    const dialogRes = await this.platform.showSaveDialog({
      defaultPath: `ai-api-key-lab-backup-${Date.now()}.json`,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    });

    if (dialogRes.canceled || !dialogRes.filePath) {
      return { saved: false };
    }

    writeFileAtomicSync(dialogRes.filePath, outputString, 0o600);
    return { saved: true, filePath: dialogRes.filePath };
  }

  async backupImport(rawOpts: unknown): Promise<ImportReport> {
    const opts: BackupImportOpts = BackupImportOptsSchema.parse(rawOpts);
    let rawJson = opts.rawJsonContent;

    if (!rawJson) {
      const openRes = await this.platform.showOpenDialog({
        filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      });
      if (openRes.canceled || openRes.filePaths.length === 0) {
        return { canceled: true, keysImported: 0, providersImported: 0, historyImported: 0 };
      }
      rawJson = fs.readFileSync(openRes.filePaths[0], 'utf8');
    }

    const parsed = JSON.parse(rawJson);
    let payload: DecryptedBackupPayload;

    if (parsed && parsed.encrypted === true && parsed.payload) {
      if (!opts.passphrase) {
        throw new Error('Passphrase is required to decrypt this backup file.');
      }
      const decryptedStr = await decryptData(parsed as EncryptedBackupEnvelope, opts.passphrase);
      payload = JSON.parse(decryptedStr) as DecryptedBackupPayload;
    } else {
      payload = parsed as DecryptedBackupPayload;
    }

    const currentKeys = this.jsonStore.read('keys_meta');
    let keysImported = 0;

    if (Array.isArray(payload.keys)) {
      const secretsMap = new Map<string, string>();
      if (Array.isArray(payload.secrets)) {
        for (const entry of payload.secrets) {
          if (entry && entry.keyId && entry.secret) {
            secretsMap.set(entry.keyId, entry.secret);
          }
        }
      }

      for (const k of payload.keys) {
        const secret = secretsMap.get(k.id);
        if (secret) {
          this.secretStore.saveSecret(k.id, secret);
        }
        const existingIdx = currentKeys.findIndex((ek) => ek.id === k.id);
        const importedMeta: KeyMeta = {
          ...k,
          secretMissing: !this.secretStore.hasSecret(k.id),
        };
        if (existingIdx >= 0) {
          currentKeys[existingIdx] = importedMeta;
        } else {
          currentKeys.push(importedMeta);
        }
        keysImported++;
      }
      this.jsonStore.write('keys_meta', currentKeys);
    }

    let providersImported = 0;
    if (Array.isArray(payload.providers)) {
      const currentProviders = this.jsonStore.read('custom_providers');
      for (const cp of payload.providers) {
        const idx = currentProviders.findIndex((p) => p.id === cp.id);
        if (idx >= 0) currentProviders[idx] = cp;
        else currentProviders.push(cp);
        providersImported++;
      }
      this.jsonStore.write('custom_providers', currentProviders);
    }

    let historyImported = 0;
    if (Array.isArray(payload.history)) {
      const currentHistory = this.jsonStore.read('history');
      const existingIds = new Set(currentHistory.map((h) => h.id));
      for (const h of payload.history) {
        if (!existingIds.has(h.id)) {
          currentHistory.push(h);
          historyImported++;
        }
      }
      this.jsonStore.write('history', currentHistory.slice(0, 500));
    }

    if (payload.settings) {
      const currentSettings = this.jsonStore.read('settings');
      this.jsonStore.write('settings', { ...currentSettings, ...payload.settings });
    }

    return {
      canceled: false,
      keysImported,
      providersImported,
      historyImported,
    };
  }

  async filesExportText(rawOpts: unknown): Promise<{ saved: boolean; filePath?: string }> {
    const opts: FileExportOpts = FileExportOptsSchema.parse(rawOpts);
    const dialogRes = await this.platform.showSaveDialog({
      defaultPath: opts.defaultName,
      filters: opts.filters,
    });
    if (dialogRes.canceled || !dialogRes.filePath) {
      return { saved: false };
    }
    writeFileAtomicSync(dialogRes.filePath, opts.content, 0o600);
    return { saved: true, filePath: dialogRes.filePath };
  }

  async externalOpen(rawUrl: unknown): Promise<{ opened: boolean }> {
    const check = validateExternalOpenUrl(typeof rawUrl === 'string' ? rawUrl : '');
    if (!check.valid) {
      throw new Error(check.error);
    }
    await this.platform.openExternalUrl(check.normalizedUrl);
    return { opened: true };
  }

  async dataEraseAll(): Promise<{ erased: boolean }> {
    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Erase All AI API Key Lab Data',
      message: 'Permanently delete all API keys, Keychain secrets, custom providers, test history, and logs?',
      detail: 'This action cannot be undone.',
    });

    if (!confirmed) {
      return { erased: false };
    }

    await this.localGateway.stop();
    this.secretStore.eraseAllSecrets();
    this.jsonStore.eraseAllCollections();
    this.logger.clearLogs();
    return { erased: true };
  }

  // --- ADD-ON A: Signed Registry Updates ---

  async registryGetStatus(): Promise<RegistryStatusInfo> {
    return this.registryManager.getStatus();
  }

  async registryVerifyAndApply(rawParams: unknown): Promise<RegistryUpdateResult> {
    const params = RegistryVerifyInputSchema.parse(rawParams);
    const storedKeys = await this.keysList();
    return this.registryManager.verifyAndApplyRemoteRegistry({
      sourceUrl: params.sourceUrl,
      rawCanonicalJson: params.rawCanonicalJson,
      signatureBase64: params.signatureBase64,
      storedKeys,
    });
  }

  async registryFetchAndApply(rawParams: unknown): Promise<RegistryUpdateResult> {
    const params = RegistryFetchInputSchema.parse(rawParams);
    const storedKeys = await this.keysList();
    return this.registryManager.fetchAndApplyRemoteRegistry({
      sourceUrl: params.sourceUrl,
      signatureBase64: params.signatureBase64,
      storedKeys,
    });
  }

  async registryApproveHostChange(rawProviderId: unknown): Promise<RegistryUpdateResult> {
    const providerId = ProviderIdSchema.parse(rawProviderId);
    const status = this.registryManager.getStatus();
    const pending = status.pendingHostChanges.find((c) => c.providerId === providerId);
    if (!pending) {
      throw new Error(`No pending host change for provider "${providerId}"`);
    }

    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Approve Provider Host List Change',
      message: `Allow signed registry v${pending.remoteVersion} to change allowedHosts for "${pending.providerName}"?`,
      detail: `Current hosts: ${pending.currentHosts.join(', ')}\nProposed hosts: ${pending.proposedHosts.join(', ')}\nAffected stored keys: ${pending.affectedKeyCount}`,
    });

    if (!confirmed) {
      throw new Error('Host list change approval canceled by user');
    }

    return this.registryManager.approvePendingHostChange(providerId);
  }

  async registryRejectHostChange(rawProviderId: unknown): Promise<RegistryUpdateResult> {
    const providerId = ProviderIdSchema.parse(rawProviderId);
    return this.registryManager.rejectPendingHostChange(providerId);
  }

  // --- ADD-ON B: Leak Hunter ---

  async leakHunterPickAndScanFolders(): Promise<LeakScanReport> {
    if (!this.platform.showOpenFolderDialog) {
      throw new Error('Folder picker dialog is not available in this environment.');
    }

    const dialogRes = await this.platform.showOpenFolderDialog();
    if (dialogRes.canceled || dialogRes.filePaths.length === 0) {
      return {
        canceled: true,
        scannedFolders: [],
        scannedAt: new Date().toISOString(),
        filesScanned: 0,
        filesSkipped: 0,
        containsGitRepo: false,
        gitWarning: null,
        findings: [],
      };
    }

    const activeProviders = this.registryManager.getStatus().providers;
    return this.leakHunter.scanExplicitFolders(dialogRes.filePaths, activeProviders);
  }

  async leakHunterMarkRotated(rawFindingId: unknown, rawRotated: unknown): Promise<{ id: string; rotated: boolean }> {
    const { findingId, rotated } = LeakMarkRotatedSchema.parse({
      findingId: rawFindingId,
      rotated: rawRotated,
    });
    return this.leakHunter.markFindingRotated(findingId, rotated);
  }

  async leakHunterRevealInFinder(rawFilePath: unknown): Promise<{ revealed: boolean }> {
    const filePath = FilePathSchema.parse(rawFilePath);
    if (!this.leakHunter.isAuthorizedFilePath(filePath)) {
      throw new Error('Cannot reveal a file outside of user-scanned folders.');
    }
    if (!fs.existsSync(filePath)) {
      throw new Error('File no longer exists on disk.');
    }
    this.platform.revealFileInFinder?.(filePath);
    return { revealed: true };
  }

  // --- ADD-ON C: Local Gateway ---

  async gatewayGetStatus(): Promise<GatewayStatusSnapshot> {
    return this.localGateway.getStatus();
  }

  async gatewayStart(rawPort?: unknown): Promise<GatewayStatusSnapshot> {
    const port = GatewayPortOptionalSchema.parse(rawPort);
    return this.localGateway.start(port);
  }

  async gatewayStop(): Promise<GatewayStatusSnapshot> {
    return this.localGateway.stop();
  }

  async gatewayUpdateConfig(rawPatch: unknown): Promise<GatewayStatusSnapshot> {
    const patch = GatewayConfigPatchSchema.parse(rawPatch);
    return this.localGateway.updateConfig(patch);
  }

  async gatewayRevealToken(): Promise<{ token: string; expiresAfterMs: number }> {
    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Reveal Local Gateway Bearer Token',
      message: 'Authenticate to reveal your Local Gateway bearer token',
      detail: 'External local tools (Cursor, Aider, OpenCode, scripts) use this token to call http://127.0.0.1 without accessing raw provider keys.',
    });

    if (!confirmed) {
      throw new Error('Gateway token reveal canceled by user');
    }

    const token = this.localGateway.getRawGatewayToken();
    if (!token) {
      throw new Error('Gateway token is unavailable in Keychain');
    }

    return { token, expiresAfterMs: 15000 };
  }

  async gatewayRotateToken(): Promise<{ maskedToken: string }> {
    const confirmed = await this.platform.confirmSensitiveAction({
      title: 'Rotate Local Gateway Bearer Token',
      message: 'Generate a new Local Gateway bearer token and invalidate the current one?',
      detail: 'Any local tool using the previous token will need to be updated.',
    });

    if (!confirmed) {
      throw new Error('Gateway token rotation canceled by user');
    }

    return this.localGateway.rotateGatewayToken();
  }

  async gatewayClearLogs(): Promise<GatewayStatusSnapshot> {
    this.localGateway.clearActivityLog();
    return this.localGateway.getStatus();
  }

  async shutdown(): Promise<void> {
    for (const timer of this.clipboardTimers) {
      clearTimeout(timer);
    }
    this.clipboardTimers.clear();
    this.executor.abortAllStreams();
    this.jsonStore.flush();
    await this.localGateway.stop();
  }
}

