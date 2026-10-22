import { SecretVault } from './secretVault';

/**
 * SecretStore facade (§0A.6).
 * Only `ApiExecutor` and `SecretStore` may import `SecretVault`.
 */
export class SecretStore {
  static isVaultEncrypted(): boolean {
    return SecretVault.isVaultEncrypted();
  }

  static isUnlocked(): boolean {
    return SecretVault.isUnlocked();
  }

  static getInstallSalt(): string {
    return SecretVault.getInstallSalt();
  }

  static async unlockVault(passphrase: string): Promise<boolean> {
    return SecretVault.unlockVault(passphrase);
  }

  static lockVault(): void {
    SecretVault.lockVault();
  }

  static async saveSecret(keyId: string, secret: string): Promise<void> {
    return SecretVault.saveSecret(keyId, secret);
  }

  static getSecret(keyId: string): string | null {
    return SecretVault.getSecret(keyId);
  }

  static async removeSecret(keyId: string): Promise<void> {
    return SecretVault.removeSecret(keyId);
  }

  static clearAll(): void {
    SecretVault.clearAll();
  }
}
