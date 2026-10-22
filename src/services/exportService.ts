import { StorageService } from './storage';
import { ApiKeyRecord } from '../types/key';
import { EncryptedBackupEnvelope, DecryptedBackupPayload, PlainExportPayload } from '../types/backup';
import { encryptData, decryptData, generateKeyFingerprint } from './crypto';
import { PlainExportPayloadSchema, DecryptedBackupPayloadSchema } from '../schemas/backupSchema';
import { RedactorService } from './redactor';

export class ExportService {
  /**
   * Export plain JSON configuration (masked by default)
   */
  static exportJson(includeSecrets: boolean = false): string {
    const keys = StorageService.getKeys();
    const providers = StorageService.getCustomProviders();
    const history = StorageService.getHistory();
    const settings = StorageService.getSettings();

    const exportedKeys = keys.map(k => {
      if (includeSecrets) {
        const rawSecret = StorageService.getSecret(k.id);
        return { ...k, rawSecret: rawSecret || undefined };
      }
      return k;
    });

    const payload: PlainExportPayload = {
      format: 'ai-api-key-lab-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      keys: exportedKeys,
      providers,
      history,
      settings,
    };

    const rawJson = JSON.stringify(payload, null, 2);
    return includeSecrets ? rawJson : RedactorService.redactString(rawJson);
  }

  /**
   * Export CSV format (masked keys)
   */
  static exportCsv(): string {
    const keys = StorageService.getKeys();
    const headers = ['id', 'label', 'providerId', 'boundHost', 'maskedKey', 'status', 'authVerified', 'workingModel', 'lastTestedAt'];
    const rows = keys.map(k => [
      k.id,
      `"${k.label.replace(/"/g, '""')}"`,
      k.providerId,
      k.boundHost,
      k.maskedKey,
      k.status,
      k.authVerified,
      k.lastKnownGood?.model || '',
      k.lastTestedAt || '',
    ]);

    const rawCsv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    return RedactorService.redactString(rawCsv);
  }

  /**
   * Export .env file format
   */
  static exportDotEnv(includeSecrets: boolean = false): string {
    const keys = StorageService.getKeys();
    const lines = [
      '# AI API Key Lab Export',
      `# Generated at ${new Date().toISOString()}`,
      '',
    ];

    for (const k of keys) {
      const varPrefix = (k.providerId + '_' + k.label).toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const val = includeSecrets ? StorageService.getSecret(k.id) || k.maskedKey : k.maskedKey;
      lines.push(`${varPrefix}_KEY="${val}"`);
      if (k.lastKnownGood?.model) {
        lines.push(`${varPrefix}_MODEL="${k.lastKnownGood.model}"`);
      }
      lines.push('');
    }

    const rawEnv = lines.join('\n');
    return includeSecrets ? rawEnv : RedactorService.redactString(rawEnv);
  }

  /**
   * Create encrypted password-protected backup per §6
   */
  static async createEncryptedBackup(passphrase: string): Promise<string> {
    const keys = StorageService.getKeys();
    const providers = StorageService.getCustomProviders();
    const history = StorageService.getHistory();
    const chatSessions = StorageService.getChatSessions();
    const settings = StorageService.getSettings();

    const secrets: Array<{ keyId: string; secret: string }> = [];
    for (const k of keys) {
      const s = StorageService.getSecret(k.id);
      if (s) {
        secrets.push({ keyId: k.id, secret: s });
      }
    }

    const payload: DecryptedBackupPayload = {
      keys,
      secrets,
      providers,
      history,
      chatSessions,
      settings,
      exportedAt: new Date().toISOString(),
    };

    const envelope = await encryptData(JSON.stringify(payload), passphrase);
    return JSON.stringify(envelope, null, 2);
  }

  /**
   * Restore encrypted backup with passphrase.
   * Per §13A Backup duplicates: Duplicate detection recomputes the salted fingerprint AFTER decryption
   * with the local install's salt; fingerprints stored inside a backup are never trusted.
   */
  static async restoreEncryptedBackup(
    backupJson: string,
    passphrase: string
  ): Promise<{ keysRestored: number; duplicatesSkipped: number }> {
    // 1. Security Check: File Size
    if (backupJson.length > 10 * 1024 * 1024) {
      throw new Error('Backup file exceeds maximum allowed size (10MB)');
    }

    // 2. Prototype Pollution Security Check
    if (backupJson.includes('__proto__') || backupJson.includes('constructor') || backupJson.includes('prototype')) {
      throw new Error('Malicious attributes detected in backup file');
    }

    const envelope: EncryptedBackupEnvelope = JSON.parse(backupJson);
    const decryptedJson = await decryptData(envelope, passphrase);

    const parsed = JSON.parse(decryptedJson);
    const validated = DecryptedBackupPayloadSchema.parse(parsed);

    const secretMap = new Map<string, string>();
    if (validated.secrets) {
      for (const sec of validated.secrets) {
        secretMap.set(sec.keyId, sec.secret);
      }
    }

    const localInstallSalt = StorageService.getInstallSalt();
    const existingKeys = StorageService.getKeys();
    // Recompute existing local keys' fingerprints using localInstallSalt if secret is available
    const existingFingerprints = new Set<string>();
    for (const ek of existingKeys) {
      if (ek.id) {
        const localSec = StorageService.getSecret(ek.id);
        if (localSec) {
          const recomputedExisting = await generateKeyFingerprint(localSec, localInstallSalt);
          existingFingerprints.add(`${ek.providerId}:::${recomputedExisting}`);
        } else {
          existingFingerprints.add(`${ek.providerId}:::${ek.keyFingerprint}`);
        }
      }
    }

    let restoredCount = 0;
    let duplicatesSkipped = 0;

    for (const key of validated.keys) {
      const decryptedSecret = secretMap.get(key.id);
      // Never trust the backup's stored keyFingerprint; always recompute after decryption with local salt
      const recomputedFingerprint = decryptedSecret
        ? await generateKeyFingerprint(decryptedSecret, localInstallSalt)
        : await generateKeyFingerprint(`${key.providerId}:${key.id}:${key.maskedKey}`, localInstallSalt);

      const dedupeToken = `${key.providerId}:::${recomputedFingerprint}`;
      const isSameKeyId = existingKeys.some(ek => ek.id === key.id);

      if (!isSameKeyId && existingFingerprints.has(dedupeToken)) {
        duplicatesSkipped++;
        continue;
      }

      existingFingerprints.add(dedupeToken);

      const restoredKey: ApiKeyRecord = {
        ...key,
        keyFingerprint: recomputedFingerprint,
      };
      StorageService.saveKeyMetadata(restoredKey);
      if (decryptedSecret) {
        await StorageService.saveSecret(restoredKey.id, decryptedSecret);
      }
      restoredCount++;
    }

    // Restore custom providers
    for (const prov of validated.providers) {
      StorageService.saveCustomProvider(prov);
    }

    // Restore settings
    if (validated.settings) {
      StorageService.saveSettings(validated.settings);
    }

    return { keysRestored: restoredCount, duplicatesSkipped };
  }

  /**
   * Import plain configuration file
   */
  static importPlainConfig(jsonText: string): { importedCount: number } {
    if (jsonText.length > 10 * 1024 * 1024) {
      throw new Error('Import file exceeds 10MB limit');
    }

    if (jsonText.includes('__proto__') || jsonText.includes('constructor') || jsonText.includes('prototype')) {
      throw new Error('Malicious attributes detected in configuration file');
    }

    const parsed = JSON.parse(jsonText);
    const validated = PlainExportPayloadSchema.parse(parsed);

    let count = 0;
    for (const key of validated.keys) {
      // Re-mark imported keys as untested until verified on this host
      const safeKey: ApiKeyRecord = {
        ...key,
        status: 'untested',
        authVerified: 'unknown',
      };
      StorageService.saveKeyMetadata(safeKey);
      count++;
    }

    for (const prov of validated.providers) {
      StorageService.saveCustomProvider(prov);
    }

    return { importedCount: count };
  }
}

