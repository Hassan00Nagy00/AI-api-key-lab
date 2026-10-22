import { ApiKeyRecord, SecretStoreEntry } from './key';
import { ProviderConfig } from './provider';
import { TestResult } from './test';
import { ChatSession } from './chat';
import { AppSettings } from './settings';

export interface EncryptedBackupEnvelope {
  format: 'ai-api-key-lab-backup';
  version: 1;
  createdAt: string;
  encrypted: true;
  kdf: {
    name: 'PBKDF2-HMAC-SHA256';
    iterations: number; // >= 600,000
    salt: string;       // base64, 16+ random bytes
  };
  cipher: {
    name: 'AES-256-GCM';
    iv: string;         // base64, 12 random bytes
    tagLength: 128;
  };
  payload: string;      // base64 ciphertext+tag
}

export interface DecryptedBackupPayload {
  keys: ApiKeyRecord[];
  secrets?: SecretStoreEntry[];
  providers: ProviderConfig[];
  history: TestResult[];
  chatSessions: ChatSession[];
  settings: AppSettings;
  exportedAt: string;
}

export interface PlainExportPayload {
  format: 'ai-api-key-lab-export';
  version: 1;
  exportedAt: string;
  keys: ApiKeyRecord[]; // Secrets are masked unless explicit secret export
  providers: ProviderConfig[];
  history: TestResult[];
  settings: AppSettings;
}
