import { z } from 'zod';
import {
  MODEL_TIERS,
  TIER_EVIDENCES,
  MODEL_AVAILABILITIES,
  ERROR_CATEGORIES,
} from '../domain/canonical';

export const ProviderProtocolSchema = z.enum([
  'openai-compatible',
  'anthropic-compatible',
  'google-gemini',
  'cohere',
  'generic-rest',
]);

export const ModelTierSchema = z.enum(MODEL_TIERS);
export const TierEvidenceSchema = z.enum(TIER_EVIDENCES);
export const ModelAvailabilitySchema = z.enum(MODEL_AVAILABILITIES);

export const ModelConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  tier: ModelTierSchema.optional(),
  tierEvidence: TierEvidenceSchema.optional(),
  availability: ModelAvailabilitySchema.optional(),
  contextWindow: z.number().optional(),
  maxOutputTokens: z.number().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsChat: z.boolean().optional(),
  pricing: z.object({
    inputPerMillion: z.number().optional(),
    outputPerMillion: z.number().optional(),
  }).optional(),
  recommended: z.boolean().optional(),
  notes: z.string().optional(),
});

export const ProviderKeyShapeSchema = z.object({
  prefix: z.string(),
  minLength: z.number().int().min(1),
  maxLength: z.number().int().min(1),
  charset: z.enum(['alphanumeric-dash-underscore', 'alphanumeric', 'ascii-printable']),
  needsVerification: z.boolean().optional(),
  description: z.string().optional(),
});

export const ProviderErrorSignalSchema = z.object({
  httpStatus: z.number().int().optional(),
  match: z.string().min(1),
  category: z.enum(ERROR_CATEGORIES),
  needsVerification: z.boolean().optional(),
  verifiedByFixture: z.string().optional(),
});

export const ProviderTestModelPreferenceSchema = z.object({
  modelId: z.string().min(1),
  verifiedAt: z.string().min(1),
});

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  website: z.string().optional(),
  keyUrl: z.string().optional(),
  protocol: ProviderProtocolSchema,
  baseUrl: z.string().nullable().optional(),
  requiredParams: z.array(z.object({
    name: z.string(),
    label: z.string(),
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
  })).optional(),
  allowedHosts: z.array(z.string().min(1)),
  keyShape: z.array(ProviderKeyShapeSchema).optional(),
  errorSignals: z.array(ProviderErrorSignalSchema).optional(),
  testModelPreference: z.array(ProviderTestModelPreferenceSchema).optional(),
  cheapPatterns: z.array(z.string()).optional(),
  avoidPatterns: z.array(z.string()).optional(),
  requiresAccount: z.boolean().optional(),
  requiresCreditCard: z.boolean().optional(),
  requiresPhoneVerification: z.boolean().optional(),
  supportsModelListing: z.boolean().optional(),
  modelsRequiresAuth: z.boolean().optional(),
  authBeforeRateLimit: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsChat: z.boolean().optional(),
  browserCallable: z.enum(['yes', 'no', 'unknown']).optional(),
  freeTier: z.object({
    type: z.enum(['permanent', 'trial', 'renewable', 'limited', 'unknown']),
    description: z.string().optional(),
  }).optional(),
  models: z.array(ModelConfigSchema).optional(),
  excludeModelPatterns: z.array(z.string()).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  authentication: z.object({
    type: z.enum(['bearer', 'api-key-header', 'query', 'custom']),
    headerName: z.string().optional(),
  }).optional(),
  endpoints: z.object({
    models: z.string().optional(),
    chat: z.string().optional(),
    generate: z.string().optional(),
  }).optional(),
  adapter: z.string().optional(),
  source: z.enum(['bundled', 'remote', 'user']),
  registryVersion: z.string().optional(),
  verifiedAt: z.string().nullable().optional(),
  needsVerification: z.boolean().optional(),
  customConfig: z.object({
    modelsEndpoint: z.string().optional(),
    chatEndpoint: z.string().optional(),
    httpMethod: z.enum(['POST', 'GET']),
    modelField: z.string().optional(),
    messageFormat: z.enum(['openai', 'simple-text', 'raw']).optional(),
    responseJsonPath: z.string().optional(),
    requestTemplate: z.string().optional(),
    customHeaders: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

