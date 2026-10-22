import fs from 'node:fs';
import path from 'node:path';
import { StoreCollection, StoreCollectionMap } from '../types/electron';
import { defaultSettings } from '../types/settings';

export interface VersionedStoreEnvelope<T> {
  schemaVersion: number;
  updatedAt: string;
  data: T;
}

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Redacts API key patterns, Bearer tokens, and known secrets from any log or error string.
 */
export function redactSecretsFromText(text: string, knownSecrets: string[] = []): string {
  if (!text) return text;
  let scrubbed = text;

  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) {
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scrubbed = scrubbed.replace(new RegExp(escaped, 'g'), '[REDACTED_SECRET]');
    }
  }

  // Redact common API key prefixes and Authorization headers
  scrubbed = scrubbed
    .replace(/Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/\b(sk-[A-Za-z0-9_\-]{8,})\b/g, 'sk-[REDACTED]')
    .replace(/\b(AIza[A-Za-z0-9_\-]{12,})\b/g, 'AIza[REDACTED]')
    .replace(/\b(gsk_[A-Za-z0-9_\-]{12,})\b/g, 'gsk_[REDACTED]')
    .replace(/\b(xai-[A-Za-z0-9_\-]{12,})\b/g, 'xai-[REDACTED]')
    .replace(/(["']?(?:x-api-key|x-goog-api-key|authorization)["']?\s*:\s*["'])([^"']+)(["'])/gi, '$1[REDACTED]$3');

  return scrubbed;
}

/**
 * Atomic file write using temp file + fsync + rename per §7
 */
export function writeFileAtomicSync(targetPath: string, content: string, mode = 0o600): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;

  const fd = fs.openSync(tempPath, 'w', mode);
  try {
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tempPath, targetPath);
}

/**
 * Sanitized structured logger writing to ~/Library/Logs/AI API Key Lab/app.log
 */
export class SanitizedLogger {
  private logFilePath: string;

  constructor(logsDir: string) {
    fs.mkdirSync(logsDir, { recursive: true });
    this.logFilePath = path.join(logsDir, 'app.log');
  }

  log(level: 'INFO' | 'WARN' | 'ERROR', event: string, meta?: Record<string, unknown>, knownSecrets: string[] = []): void {
    try {
      const entry = {
        timestamp: new Date().toISOString(),
        level,
        event: redactSecretsFromText(event, knownSecrets),
        meta: meta ? JSON.parse(redactSecretsFromText(JSON.stringify(meta), knownSecrets)) : undefined,
      };
      fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Avoid crashing main process if log write fails
    }
  }

  clearLogs(): void {
    try {
      if (fs.existsSync(this.logFilePath)) {
        writeFileAtomicSync(this.logFilePath, '', 0o600);
      }
    } catch {
      // ignore
    }
  }

  getLogPath(): string {
    return this.logFilePath;
  }
}

export class JsonStore {
  private userDataDir: string;
  private logger?: SanitizedLogger;
  private lastCorruptionNotice: string | null = null;

  constructor(userDataDir: string, logger?: SanitizedLogger) {
    this.userDataDir = userDataDir;
    this.logger = logger;
    fs.mkdirSync(this.userDataDir, { recursive: true });
  }

  getFilePath(collection: StoreCollection): string {
    return path.join(this.userDataDir, `${collection}.json`);
  }

  getDefaultData<K extends StoreCollection>(collection: K): StoreCollectionMap[K] {
    switch (collection) {
      case 'keys_meta':
        return [] as unknown as StoreCollectionMap[K];
      case 'settings':
        return { ...defaultSettings } as unknown as StoreCollectionMap[K];
      case 'history':
        return [] as unknown as StoreCollectionMap[K];
      case 'custom_providers':
        return [] as unknown as StoreCollectionMap[K];
      case 'chat_sessions':
        return [] as unknown as StoreCollectionMap[K];
      case 'local_consents':
        return {} as unknown as StoreCollectionMap[K];
      default:
        return [] as unknown as StoreCollectionMap[K];
    }
  }

  read<K extends StoreCollection>(collection: K): StoreCollectionMap[K] {
    const filePath = this.getFilePath(collection);
    if (!fs.existsSync(filePath)) {
      return this.getDefaultData(collection);
    }

    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as VersionedStoreEnvelope<StoreCollectionMap[K]>;
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.schemaVersion !== 'number' ||
        parsed.data === undefined
      ) {
        throw new Error('Missing schemaVersion or data envelope');
      }

      if (collection === 'keys_meta' && Array.isArray(parsed.data)) {
        // Revert any transient 'testing' status to 'untested' on load
        return parsed.data.map((k: any) =>
          k.status === 'testing' ? { ...k, status: 'untested' } : k
        ) as unknown as StoreCollectionMap[K];
      }

      return parsed.data;
    } catch (err: unknown) {
      // Corrupted file recovery per §7: rename to <name>.corrupt.<timestamp>.json
      const ts = Date.now();
      const corruptPath = path.join(this.userDataDir, `${collection}.corrupt.${ts}.json`);
      try {
        fs.renameSync(filePath, corruptPath);
      } catch {
        // ignore if rename fails
      }

      const notice = `Corrupted store "${collection}.json" was backed up to "${path.basename(corruptPath)}" and re-initialized.`;
      this.lastCorruptionNotice = notice;
      this.logger?.log('WARN', notice, {
        error: err instanceof Error ? err.message : 'Parse error',
      });

      const fallback = this.getDefaultData(collection);
      this.write(collection, fallback);
      return fallback;
    }
  }

  write<K extends StoreCollection>(collection: K, data: StoreCollectionMap[K]): void {
    const filePath = this.getFilePath(collection);
    const envelope: VersionedStoreEnvelope<StoreCollectionMap[K]> = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      data,
    };
    writeFileAtomicSync(filePath, JSON.stringify(envelope, null, 2), 0o600);
  }

  getCorruptionNotice(): string | null {
    return this.lastCorruptionNotice;
  }

  /**
   * Flushes and normalizes persisted collections on before-quit (07_P3 §13).
   */
  flush(): void {
    try {
      const keysMetaPath = this.getFilePath('keys_meta');
      if (fs.existsSync(keysMetaPath)) {
        const current = this.read('keys_meta');
        this.write('keys_meta', current);
      }
    } catch {
      // ignore flush errors during shutdown
    }
  }

  eraseAllCollections(): void {
    const collections: StoreCollection[] = [
      'keys_meta',
      'settings',
      'history',
      'custom_providers',
      'chat_sessions',
      'local_consents',
    ];
    for (const col of collections) {
      const p = this.getFilePath(col);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  }
}
