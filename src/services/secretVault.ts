import { encryptData, decryptData } from './crypto';
import { EncryptedBackupEnvelope } from '../types/backup';

const VAULT_STORAGE_KEYS = {
  SECRETS: 'ai_lab_secrets_vault_v1',
  VAULT_SALT: 'ai_lab_vault_salt_v1',
  VAULT_ENCRYPTED: 'ai_lab_vault_encrypted_flag_v1',
};

const nodeVaultMemory = new Map<string, string>();

function vaultGet(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return nodeVaultMemory.get(key) || null;
}

function vaultSet(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, val);
  } else {
    nodeVaultMemory.set(key, val);
  }
}

const memorySecretsStore = new Map<string, string>();
let vaultPassphrase: string | null = null;
let isVaultUnlocked = false;

/**
 * Low-level Secret Vault module (§0A.6 Mechanical Late-Binding Rule).
 * ONLY `src/services/executor.ts` (ApiExecutor) and `src/services/secretStore.ts` (SecretStore)
 * are allowed to import this module. Enforced by ESLint `no-restricted-imports` and unit tests.
 */
export class SecretVault {
  static isVaultEncrypted(): boolean {
    return vaultGet(VAULT_STORAGE_KEYS.VAULT_ENCRYPTED) === 'true';
  }

  static isUnlocked(): boolean {
    if (!this.isVaultEncrypted()) {
      return true;
    }
    return isVaultUnlocked;
  }

  static getInstallSalt(): string {
    let salt = vaultGet(VAULT_STORAGE_KEYS.VAULT_SALT);
    if (!salt) {
      const randomBytes = new Uint8Array(16);
      crypto.getRandomValues(randomBytes);
      salt = Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      vaultSet(VAULT_STORAGE_KEYS.VAULT_SALT, salt);
    }
    return salt;
  }

  static async unlockVault(passphrase: string): Promise<boolean> {
    const rawVault = vaultGet(VAULT_STORAGE_KEYS.SECRETS);
    if (!rawVault) {
      vaultPassphrase = passphrase;
      isVaultUnlocked = true;
      vaultSet(VAULT_STORAGE_KEYS.VAULT_ENCRYPTED, 'true');
      return true;
    }

    try {
      const envelope: EncryptedBackupEnvelope = JSON.parse(rawVault);
      const decryptedJson = await decryptData(envelope, passphrase);
      const secretsMap: Record<string, string> = JSON.parse(decryptedJson);

      memorySecretsStore.clear();
      for (const [keyId, secret] of Object.entries(secretsMap)) {
        memorySecretsStore.set(keyId, secret);
      }

      vaultPassphrase = passphrase;
      isVaultUnlocked = true;
      vaultSet(VAULT_STORAGE_KEYS.VAULT_ENCRYPTED, 'true');
      return true;
    } catch {
      return false;
    }
  }

  static lockVault(): void {
    memorySecretsStore.clear();
    vaultPassphrase = null;
    isVaultUnlocked = false;
  }

  static async saveSecret(keyId: string, secret: string): Promise<void> {
    memorySecretsStore.set(keyId, secret);

    const secretsObj: Record<string, string> = {};
    for (const [id, s] of memorySecretsStore.entries()) {
      secretsObj[id] = s;
    }

    if (vaultPassphrase) {
      const envelope = await encryptData(JSON.stringify(secretsObj), vaultPassphrase);
      vaultSet(VAULT_STORAGE_KEYS.SECRETS, JSON.stringify(envelope));
      vaultSet(VAULT_STORAGE_KEYS.VAULT_ENCRYPTED, 'true');
    } else {
      vaultSet(VAULT_STORAGE_KEYS.SECRETS, JSON.stringify({ unencryptedSecrets: secretsObj }));
      vaultSet(VAULT_STORAGE_KEYS.VAULT_ENCRYPTED, 'false');
    }
  }

  static getSecret(keyId: string): string | null {
    if (memorySecretsStore.has(keyId)) {
      return memorySecretsStore.get(keyId) || null;
    }

    if (!this.isVaultEncrypted()) {
      const raw = vaultGet(VAULT_STORAGE_KEYS.SECRETS);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.unencryptedSecrets && parsed.unencryptedSecrets[keyId]) {
            const secret = parsed.unencryptedSecrets[keyId];
            memorySecretsStore.set(keyId, secret);
            return secret;
          }
        } catch {
          // ignore
        }
      }
    }

    return null;
  }

  static async removeSecret(keyId: string): Promise<void> {
    memorySecretsStore.delete(keyId);
    const secretsObj: Record<string, string> = {};
    for (const [id, s] of memorySecretsStore.entries()) {
      secretsObj[id] = s;
    }

    if (vaultPassphrase) {
      const envelope = await encryptData(JSON.stringify(secretsObj), vaultPassphrase);
      vaultSet(VAULT_STORAGE_KEYS.SECRETS, JSON.stringify(envelope));
    } else {
      vaultSet(VAULT_STORAGE_KEYS.SECRETS, JSON.stringify({ unencryptedSecrets: secretsObj }));
    }
  }

  static clearAll(): void {
    nodeVaultMemory.clear();
    memorySecretsStore.clear();
    vaultPassphrase = null;
    isVaultUnlocked = false;
  }
}
