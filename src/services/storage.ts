import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';
import { TestResult } from '../types/test';
import { ChatSession } from '../types/chat';
import { AppSettings, defaultSettings } from '../types/settings';
import { SecretStore } from './secretStore';
import { RedactorService } from './redactor';

const STORAGE_KEYS = {
  KEYS: 'ai_lab_keys_metadata_v1',
  PROVIDERS: 'ai_lab_providers_v1',
  HISTORY: 'ai_lab_test_history_v1',
  CHAT_SESSIONS: 'ai_lab_chat_sessions_v1',
  SETTINGS: 'ai_lab_settings_v1',
};

const nodeMemoryStorage = new Map<string, string>();
let memoryChatSessions: ChatSession[] = [];

function safeGet(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return nodeMemoryStorage.get(key) || null;
}

function safeSet(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, val);
  } else {
    nodeMemoryStorage.set(key, val);
  }
}

function safeRemove(key: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  } else {
    nodeMemoryStorage.delete(key);
  }
}

function safeClear(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear();
  } else {
    nodeMemoryStorage.clear();
  }
}

export class StorageService {
  /**
   * Check if encryption is enabled (passphrase is configured)
   */
  static isVaultEncrypted(): boolean {
    return SecretStore.isVaultEncrypted();
  }

  /**
   * Check if vault is currently unlocked in memory
   */
  static isUnlocked(): boolean {
    return SecretStore.isUnlocked();
  }

  /**
   * Get local installation salt for duplicate detection after backup decryption (§13A)
   */
  static getInstallSalt(): string {
    return SecretStore.getInstallSalt();
  }

  /**
   * Unlock vault with user passphrase
   */
  static async unlockVault(passphrase: string): Promise<boolean> {
    return SecretStore.unlockVault(passphrase);
  }

  /**
   * Lock vault and purge in-memory secrets
   */
  static lockVault(): void {
    SecretStore.lockVault();
  }

  /**
   * Save secret via SecretStore and register with RedactorService
   */
  static async saveSecret(keyId: string, secret: string): Promise<void> {
    RedactorService.registerSensitiveValue(secret);
    return SecretStore.saveSecret(keyId, secret);
  }

  /**
   * Get raw secret via SecretStore (for explicit user reveal/export/backup)
   */
  static getSecret(keyId: string): string | null {
    return SecretStore.getSecret(keyId);
  }

  /**
   * Remove a secret from storage
   */
  static async removeSecret(keyId: string): Promise<void> {
    return SecretStore.removeSecret(keyId);
  }

  /**
   * Keys Metadata CRUD
   */
  static getKeys(): ApiKeyRecord[] {
    const raw = safeGet(STORAGE_KEYS.KEYS);
    if (!raw) return [];
    try {
      const keys: ApiKeyRecord[] = JSON.parse(raw);
      // Ensure transient 'testing' status reverts to 'untested' on startup per §2
      return keys.map(k => (k.status === 'testing' ? { ...k, status: 'untested' } : k));
    } catch {
      return [];
    }
  }

  static saveKeyMetadata(key: ApiKeyRecord): void {
    const sanitizedKey = RedactorService.redactObject(key);
    const keys = this.getKeys();
    const index = keys.findIndex(k => k.id === sanitizedKey.id);
    if (index >= 0) {
      keys[index] = sanitizedKey;
    } else {
      keys.push(sanitizedKey);
    }
    safeSet(STORAGE_KEYS.KEYS, JSON.stringify(keys));
  }

  static deleteKey(id: string): void {
    const keys = this.getKeys().filter(k => k.id !== id);
    safeSet(STORAGE_KEYS.KEYS, JSON.stringify(keys));
    void this.removeSecret(id);
  }

  /**
   * Provider Configurations
   */
  static getCustomProviders(): ProviderConfig[] {
    const raw = safeGet(STORAGE_KEYS.PROVIDERS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static saveCustomProvider(provider: ProviderConfig): void {
    const custom = this.getCustomProviders();
    const index = custom.findIndex(p => p.id === provider.id);
    if (index >= 0) {
      custom[index] = provider;
    } else {
      custom.push(provider);
    }
    safeSet(STORAGE_KEYS.PROVIDERS, JSON.stringify(custom));
  }

  static deleteCustomProvider(id: string): void {
    const custom = this.getCustomProviders().filter(p => p.id !== id);
    safeSet(STORAGE_KEYS.PROVIDERS, JSON.stringify(custom));
  }

  /**
   * Test History (redacted so secrets never enter history)
   */
  static getHistory(): TestResult[] {
    const raw = safeGet(STORAGE_KEYS.HISTORY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static addHistoryResult(result: TestResult): void {
    const sanitized = RedactorService.redactObject(result);
    const history = this.getHistory();
    history.unshift(sanitized);
    if (history.length > 500) {
      history.length = 500;
    }
    safeSet(STORAGE_KEYS.HISTORY, JSON.stringify(history));
  }

  static clearHistory(): void {
    safeRemove(STORAGE_KEYS.HISTORY);
  }

  /**
   * Chat Sessions (§13A: Browser tier defaults saveChatHistory to OFF; secrets never appear in saved chats)
   */
  static getChatSessions(): ChatSession[] {
    const settings = this.getSettings();
    if (!settings.saveChatHistory) {
      return [...memoryChatSessions];
    }
    const raw = safeGet(STORAGE_KEYS.CHAT_SESSIONS);
    if (!raw) return [...memoryChatSessions];
    try {
      const persisted: ChatSession[] = JSON.parse(raw);
      return persisted;
    } catch {
      return [...memoryChatSessions];
    }
  }

  static saveChatSession(session: ChatSession): void {
    const sanitized = RedactorService.redactObject(session);
    const memIdx = memoryChatSessions.findIndex(s => s.id === sanitized.id);
    if (memIdx >= 0) {
      memoryChatSessions[memIdx] = sanitized;
    } else {
      memoryChatSessions.unshift(sanitized);
    }

    const settings = this.getSettings();
    if (settings.saveChatHistory) {
      safeSet(STORAGE_KEYS.CHAT_SESSIONS, JSON.stringify(memoryChatSessions));
    } else {
      safeRemove(STORAGE_KEYS.CHAT_SESSIONS);
    }
  }

  static deleteChatSession(id: string): void {
    memoryChatSessions = memoryChatSessions.filter(s => s.id !== id);
    const settings = this.getSettings();
    if (settings.saveChatHistory) {
      safeSet(STORAGE_KEYS.CHAT_SESSIONS, JSON.stringify(memoryChatSessions));
    }
  }

  /**
   * Settings
   */
  static getSettings(): AppSettings {
    const raw = safeGet(STORAGE_KEYS.SETTINGS);
    if (!raw) return defaultSettings;
    try {
      return { ...defaultSettings, ...JSON.parse(raw) };
    } catch {
      return defaultSettings;
    }
  }

  static saveSettings(settings: AppSettings): void {
    safeSet(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
    if (!settings.saveChatHistory) {
      safeRemove(STORAGE_KEYS.CHAT_SESSIONS);
    }
  }

  /**
   * Raw storage dump for auditing/canary tests (excluding the secret vault itself)
   */
  static getNonVaultStorageDump(): Record<string, string | null> {
    return {
      [STORAGE_KEYS.KEYS]: safeGet(STORAGE_KEYS.KEYS),
      [STORAGE_KEYS.PROVIDERS]: safeGet(STORAGE_KEYS.PROVIDERS),
      [STORAGE_KEYS.HISTORY]: safeGet(STORAGE_KEYS.HISTORY),
      [STORAGE_KEYS.CHAT_SESSIONS]: safeGet(STORAGE_KEYS.CHAT_SESSIONS),
      [STORAGE_KEYS.SETTINGS]: safeGet(STORAGE_KEYS.SETTINGS),
    };
  }

  /**
   * Clear All Data (with destructive confirmation)
   */
  static clearAllData(): void {
    safeClear();
    memoryChatSessions = [];
    SecretStore.clearAll();
  }
}

