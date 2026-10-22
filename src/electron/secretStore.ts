import fs from 'node:fs';
import path from 'node:path';
import { KeyMeta } from '../types/electron';
import { SanitizedLogger, writeFileAtomicSync } from './jsonStore';

export interface SafeStorageBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export class KeychainUnavailableError extends Error {
  readonly code = 'ERR_KEYCHAIN_UNAVAILABLE';
  constructor(
    message = 'macOS Keychain encryption (safeStorage) is unavailable. Refusing to store or read secrets in plaintext (fail-closed).'
  ) {
    super(message);
    this.name = 'KeychainUnavailableError';
  }
}

interface EncryptedVaultFile {
  schemaVersion: number;
  updatedAt: string;
  entries: Record<string, string>; // keyId -> base64(safeStorage.encryptString(secret))
}

export class SecretStore {
  private vaultFilePath: string;
  private safeStorage: SafeStorageBackend;
  private logger?: SanitizedLogger;

  constructor(userDataDir: string, safeStorage: SafeStorageBackend, logger?: SanitizedLogger) {
    fs.mkdirSync(userDataDir, { recursive: true });
    this.vaultFilePath = path.join(userDataDir, 'secrets.vault.json');
    this.safeStorage = safeStorage;
    this.logger = logger;
  }

  isAvailable(): boolean {
    try {
      return Boolean(this.safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  private assertAvailable(): void {
    if (!this.isAvailable()) {
      throw new KeychainUnavailableError();
    }
  }

  private readVaultEntries(): Record<string, string> {
    if (!fs.existsSync(this.vaultFilePath)) {
      return {};
    }
    try {
      const raw = fs.readFileSync(this.vaultFilePath, 'utf8');
      const parsed = JSON.parse(raw) as EncryptedVaultFile;
      if (!parsed || typeof parsed.entries !== 'object' || parsed.entries === null) {
        return {};
      }
      return { ...parsed.entries };
    } catch (err: unknown) {
      const ts = Date.now();
      const corruptPath = `${this.vaultFilePath}.corrupt.${ts}.json`;
      try {
        fs.renameSync(this.vaultFilePath, corruptPath);
      } catch {
        // ignore
      }
      this.logger?.log('WARN', 'Corrupted secrets.vault.json backed up and reset', {
        error: err instanceof Error ? err.message : 'Parse error',
      });
      return {};
    }
  }

  private writeVaultEntries(entries: Record<string, string>): void {
    const payload: EncryptedVaultFile = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      entries,
    };
    writeFileAtomicSync(this.vaultFilePath, JSON.stringify(payload, null, 2), 0o600);
  }

  /**
   * Encrypts `secret` using macOS Keychain (`safeStorage.encryptString`) and atomically persists it.
   * Fails closed with `KeychainUnavailableError` if Keychain encryption is unavailable.
   */
  saveSecret(keyId: string, secret: string): void {
    this.assertAvailable();
    if (!keyId || !secret) {
      throw new Error('keyId and non-empty secret are required');
    }
    const encryptedBuf = this.safeStorage.encryptString(secret);
    const entries = this.readVaultEntries();
    entries[keyId] = encryptedBuf.toString('base64');
    this.writeVaultEntries(entries);
  }

  /**
   * Decrypts and returns the raw secret for `keyId` ONLY inside the Main process.
   * Fails closed with `KeychainUnavailableError` if Keychain encryption is unavailable.
   */
  getSecret(keyId: string): string | null {
    this.assertAvailable();
    const entries = this.readVaultEntries();
    const b64 = entries[keyId];
    if (!b64) return null;

    const buf = Buffer.from(b64, 'base64');
    return this.safeStorage.decryptString(buf);
  }

  hasSecret(keyId: string): boolean {
    const entries = this.readVaultEntries();
    return Object.prototype.hasOwnProperty.call(entries, keyId);
  }

  deleteSecret(keyId: string): void {
    const entries = this.readVaultEntries();
    if (Object.prototype.hasOwnProperty.call(entries, keyId)) {
      delete entries[keyId];
      this.writeVaultEntries(entries);
    }
  }

  eraseAllSecrets(): void {
    if (fs.existsSync(this.vaultFilePath)) {
      fs.unlinkSync(this.vaultFilePath);
    }
  }

  /**
   * Startup reconciliation between `keys_meta.json` and `secrets.vault.json` per §6:
   * - Orphan secret (in vault without metadata): deleted from vault + logged warning.
   * - Orphan metadata (in metadata without secret in vault): marked `secretMissing: true` and `status: 'untested'`.
   */
  reconcileWithMetadata(keysMeta: KeyMeta[]): {
    reconciledMeta: KeyMeta[];
    orphanSecretsRemoved: number;
    missingSecretsCount: number;
  } {
    const entries = this.readVaultEntries();
    const metaIds = new Set(keysMeta.map((k) => k.id));
    let orphanSecretsRemoved = 0;

    for (const secretKeyId of Object.keys(entries)) {
      if (!metaIds.has(secretKeyId)) {
        delete entries[secretKeyId];
        orphanSecretsRemoved++;
        this.logger?.log('WARN', 'Removed orphan secret from vault during startup reconciliation', {
          keyId: secretKeyId,
        });
      }
    }

    if (orphanSecretsRemoved > 0) {
      this.writeVaultEntries(entries);
    }

    let missingSecretsCount = 0;
    const reconciledMeta = keysMeta.map((meta) => {
      const existsInVault = Object.prototype.hasOwnProperty.call(entries, meta.id);
      if (!existsInVault) {
        missingSecretsCount++;
        return {
          ...meta,
          secretMissing: true,
          status: 'untested' as const,
        };
      }
      if (meta.secretMissing) {
        const cleaned = { ...meta };
        delete cleaned.secretMissing;
        return cleaned;
      }
      return meta;
    });

    return {
      reconciledMeta,
      orphanSecretsRemoved,
      missingSecretsCount,
    };
  }
}
