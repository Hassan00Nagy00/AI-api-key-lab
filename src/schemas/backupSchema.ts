import { z } from 'zod';
import { ApiKeyRecordSchema } from './keySchema';
import { ProviderConfigSchema } from './providerSchema';

export const EncryptedBackupEnvelopeSchema = z.object({
  format: z.literal('ai-api-key-lab-backup'),
  version: z.literal(1),
  createdAt: z.string(),
  encrypted: z.literal(true),
  kdf: z.object({
    name: z.literal('PBKDF2-HMAC-SHA256'),
    iterations: z.number().min(600000),
    salt: z.string().min(16),
  }),
  cipher: z.object({
    name: z.literal('AES-256-GCM'),
    iv: z.string().min(12),
    tagLength: z.literal(128),
  }),
  payload: z.string().min(1),
});

export const DecryptedBackupPayloadSchema = z.object({
  keys: z.array(ApiKeyRecordSchema),
  secrets: z.array(z.object({
    keyId: z.string(),
    secret: z.string(),
  })).optional(),
  providers: z.array(ProviderConfigSchema),
  history: z.array(z.any()).default([]),
  chatSessions: z.array(z.any()).default([]),
  settings: z.any(),
  exportedAt: z.string(),
});

export const PlainExportPayloadSchema = z.object({
  format: z.literal('ai-api-key-lab-export'),
  version: z.literal(1),
  exportedAt: z.string(),
  keys: z.array(ApiKeyRecordSchema),
  providers: z.array(ProviderConfigSchema),
  history: z.array(z.any()).default([]),
  settings: z.any(),
});
