import { z } from 'zod';
import { KEY_STATUSES, AUTH_VERIFIED_VALUES, MODEL_TIERS } from '../domain/canonical';

export const KeyStatusSchema = z.enum(KEY_STATUSES);

export const AuthVerifiedSchema = z.enum(AUTH_VERIFIED_VALUES);

export const LastKnownGoodSchema = z.object({
  at: z.string(),
  model: z.string(),
  latencyMs: z.number(),
  modelTier: z.enum(MODEL_TIERS).optional(),
});

export const ApiKeyRecordSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  providerId: z.string().min(1),
  boundHost: z.string().min(1),
  keyFingerprint: z.string().min(1),
  maskedKey: z.string().min(1),
  status: KeyStatusSchema,
  authVerified: AuthVerifiedSchema,
  lastTestedAt: z.string().optional(),
  lastKnownGood: LastKnownGoodSchema.optional(),
  selectedModel: z.string().optional(),
  customBaseUrl: z.string().optional(),
  customParams: z.record(z.string(), z.string()).optional(),
  group: z.string().optional(),
  labels: z.array(z.string()).optional(),
  expiresAt: z.string().optional(),
  expiryNote: z.string().optional(),
  billingWarningAcknowledged: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isDemo: z.boolean().optional(),
});

export const AddKeyInputSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  providerId: z.string().min(1, 'Provider is required'),
  secret: z.string().min(1, 'API Key is required'),
  customBaseUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  selectedModel: z.string().optional(),
  customParams: z.record(z.string(), z.string()).optional(),
  group: z.string().optional(),
  labels: z.array(z.string()).optional(),
  expiresAt: z.string().optional(),
  expiryNote: z.string().optional(),
});

