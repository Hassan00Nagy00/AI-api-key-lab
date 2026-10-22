import { z } from 'zod';
import { isBlockedIpAddress } from './ssrfGuard';
import { KEY_STATUSES, AUTH_VERIFIED_VALUES, MODEL_TIERS } from '../domain/canonical';
import net from 'node:net';

export const KeyStatusSchema = z.enum(KEY_STATUSES);

export const AuthVerifiedSchema = z.enum(AUTH_VERIFIED_VALUES);

export const KeySaveInputSchema = z
  .object({
    id: z.string().min(1).max(128).optional(),
    providerId: z.string().min(1).max(128),
    label: z.string().min(1).max(200),
    secret: z.string().min(1).max(8192),
    baseUrl: z.string().max(2048).optional(),
    selectedModel: z.string().max(256).optional(),
    group: z.string().max(128).optional(),
    labels: z.array(z.string().max(64)).max(25).optional(),
  })
  .strict();

export const KeyMetaPatchSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    status: KeyStatusSchema.optional(),
    authVerified: AuthVerifiedSchema.optional(),
    lastTestedAt: z.string().max(64).optional(),
    lastKnownGood: z
      .object({
        at: z.string(),
        model: z.string(),
        latencyMs: z.number(),
        modelTier: z.enum(MODEL_TIERS).optional(),
      })
      .optional(),
    selectedModel: z.string().max(256).optional(),
    customBaseUrl: z.string().max(2048).optional(),
    customParams: z.record(z.string(), z.string()).optional(),
    group: z.string().max(128).optional(),
    labels: z.array(z.string().max(64)).max(25).optional(),
  })
  .strict();

export const KeyIdSchema = z.string().min(1).max(128);

export const KeyRebindInputSchema = z
  .object({
    id: z.string().min(1).max(128),
    newBaseUrl: z.string().min(1).max(2048),
  })
  .strict();

export const ApiRequestPayloadSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    keyId: z.string().min(1).max(128).optional(),
    boundHost: z.string().max(255).optional(),
    providerId: z.string().max(128).optional(),
    allowLocalHttp: z.boolean().optional(),
    url: z.string().min(1).max(4096),
    method: z.enum(['GET', 'POST', 'DELETE']),
    headers: z.record(z.string(), z.string()),
    query: z.record(z.string(), z.string()).optional(),
    body: z.string().max(2 * 1024 * 1024).optional(),
    timeoutMs: z.number().int().min(50).max(300000),
  })
  .strict();

export const StoreCollectionSchema = z.enum([
  'keys_meta',
  'settings',
  'history',
  'custom_providers',
  'chat_sessions',
  'local_consents',
]);

export const BackupCreateOptsSchema = z
  .object({
    includeSecrets: z.boolean(),
    passphrase: z.string().min(8).max(512).optional(),
  })
  .strict();

export const BackupImportOptsSchema = z
  .object({
    passphrase: z.string().max(512).optional(),
    rawJsonContent: z.string().optional(),
  })
  .strict();

export const FileExportOptsSchema = z
  .object({
    defaultName: z.string().min(1).max(255),
    content: z.string().max(25 * 1024 * 1024),
    filters: z
      .array(
        z.object({
          name: z.string().max(64),
          extensions: z.array(z.string().max(16)),
        })
      )
      .optional(),
  })
  .strict();

export const ExternalOpenUrlSchema = z.string().min(1).max(2048);

export const RegistryVerifyInputSchema = z
  .object({
    sourceUrl: z.string().min(1).max(2048),
    rawCanonicalJson: z.string().min(2).max(10 * 1024 * 1024),
    signatureBase64: z.string().max(512),
  })
  .strict();

export const RegistryFetchInputSchema = z
  .object({
    sourceUrl: z.string().min(1).max(2048),
    signatureBase64: z.string().max(512).optional(),
  })
  .strict();

export const ProviderIdSchema = z.string().min(1).max(128);

export const LeakMarkRotatedSchema = z
  .object({
    findingId: z.string().min(1).max(128),
    rotated: z.boolean(),
  })
  .strict();

export const FilePathSchema = z.string().min(1).max(4096);

export const GatewayConfigPatchSchema = z
  .object({
    port: z.number().int().min(0).max(65535).optional(),
    priorityKeyIds: z.array(z.string().max(128)).max(200).optional(),
    enableAutomaticFailover: z.boolean().optional(),
    maxRequestsBudget: z.number().int().min(1).max(1000000).optional(),
    maxRequestsPerMinutePerKey: z.number().int().min(1).max(10000).optional(),
    resetBudgetUsage: z.boolean().optional(),
  })
  .strict();

export const GatewayPortOptionalSchema = z.number().int().min(0).max(65535).optional();


/**
 * Validates URLs passed to `external:open` / `shell.openExternal` per §2:
 * Only allows `https://` to public, non-blocked hosts. Rejects `http:`, `file:`, `javascript:`, `data:`, `mailto:`, etc.
 */
export function validateExternalOpenUrl(rawUrl: string): { valid: true; normalizedUrl: string } | { valid: false; error: string } {
  const parsedStr = ExternalOpenUrlSchema.safeParse(rawUrl);
  if (!parsedStr.success) {
    return { valid: false, error: 'Invalid external URL string' };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: 'Malformed external URL' };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      error: `Blocked external protocol "${parsed.protocol}". Only https: URLs may be opened externally.`,
    };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, error: 'External URLs must not contain embedded credentials' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost') {
    return { valid: false, error: `Blocked external host "${host}"` };
  }

  if (net.isIP(host) !== 0 || host.startsWith('::ffff:')) {
    const ipCheck = isBlockedIpAddress(host, { allowLoopback: false });
    if (ipCheck.blocked) {
      return { valid: false, error: ipCheck.reason || 'Blocked IP in external URL' };
    }
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

/**
 * Validates that an IPC event came from an authorized sender frame (`app://-` in prod or dev server URL in dev).
 */
export function verifyIpcSenderOrigin(
  senderUrl: string | undefined,
  options: { isPackaged: boolean; devServerUrl?: string }
): { valid: boolean; reason?: string } {
  if (!senderUrl) {
    return { valid: false, reason: 'Missing senderFrame URL' };
  }

  try {
    const parsed = new URL(senderUrl);
    if (options.isPackaged) {
      if (parsed.protocol === 'app:' && (parsed.hostname === '-' || parsed.hostname === 'localhost' || parsed.hostname === '')) {
        return { valid: true };
      }
      return { valid: false, reason: `Untrusted sender origin in packaged app: ${parsed.origin}` };
    } else {
      const allowedDevOrigin = options.devServerUrl ? new URL(options.devServerUrl).origin : 'http://localhost:3000';
      if (parsed.origin === allowedDevOrigin || (parsed.protocol === 'app:')) {
        return { valid: true };
      }
      return { valid: false, reason: `Untrusted sender origin in dev: ${parsed.origin}` };
    }
  } catch {
    return { valid: false, reason: `Malformed senderFrame URL: ${senderUrl}` };
  }
}
