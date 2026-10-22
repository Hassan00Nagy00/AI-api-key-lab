import {
  ModelTier,
  MODEL_TIERS,
  TierEvidence,
  TIER_EVIDENCES,
  ModelAvailability,
  MODEL_AVAILABILITIES,
  ErrorCategory,
} from '../domain/canonical';

export { MODEL_TIERS, TIER_EVIDENCES, MODEL_AVAILABILITIES };
export type { ModelTier, TierEvidence, ModelAvailability };

export type ProviderProtocol =
  | 'openai-compatible'
  | 'anthropic-compatible'
  | 'google-gemini'
  | 'cohere'
  | 'generic-rest';

export type FreeTierType = 'permanent' | 'trial' | 'renewable' | 'limited' | 'unknown';

export interface ModelConfig {
  id: string;
  name?: string;
  tier?: ModelTier;
  tierEvidence?: TierEvidence;
  availability?: ModelAvailability;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsStreaming?: boolean;
  supportsChat?: boolean;
  pricing?: {
    inputPerMillion?: number;
    outputPerMillion?: number;
  };
  recommended?: boolean;
  notes?: string;
}

export interface ProviderRequiredParam {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}

export interface KeyFormatPattern {
  prefix: string;
  minLength: number;
  maxLength?: number;
  regex: string;
  description?: string;
}

/**
 * ReDoS-safe key shape definition per §13A (no arbitrary regex)
 */
export type KeyShapeCharset = 'alphanumeric-dash-underscore' | 'alphanumeric' | 'ascii-printable';

export interface ProviderKeyShape {
  prefix: string;
  minLength: number;
  maxLength: number;
  charset: KeyShapeCharset;
  needsVerification?: boolean;
  description?: string;
}

/**
 * Provider error signal entry per §2 PROVIDER SIGNAL PRIORITY
 */
export interface ProviderErrorSignal {
  httpStatus?: number;
  match: string;
  category: ErrorCategory;
  needsVerification?: boolean;
  verifiedByFixture?: string;
}

/**
 * Ordered test model preference entry per §2 (5a)
 */
export interface ProviderTestModelPreference {
  modelId: string;
  verifiedAt: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  description?: string;
  website?: string;
  keyUrl?: string;
  protocol: ProviderProtocol;
  baseUrl?: string | null;
  requiredParams?: ProviderRequiredParam[];
  allowedHosts: string[];
  keyFormats?: KeyFormatPattern[];
  keyShape?: ProviderKeyShape[];
  errorSignals?: ProviderErrorSignal[];
  testModelPreference?: ProviderTestModelPreference[];
  cheapPatterns?: string[];
  avoidPatterns?: string[];
  requiresAccount?: boolean;
  requiresCreditCard?: boolean;
  requiresPhoneVerification?: boolean;
  supportsModelListing?: boolean;
  modelsRequiresAuth?: boolean;
  authBeforeRateLimit?: boolean;
  supportsStreaming?: boolean;
  supportsChat?: boolean;
  browserCallable?: 'yes' | 'no' | 'unknown';
  freeTier?: {
    type: FreeTierType;
    description?: string;
  };
  models?: ModelConfig[];
  excludeModelPatterns?: string[];
  headers?: Record<string, string>;
  authentication?: {
    type: 'bearer' | 'api-key-header' | 'query' | 'custom';
    headerName?: string;
  };
  endpoints?: {
    models?: string;
    chat?: string;
    generate?: string;
  };
  adapter?: string;
  source: 'bundled' | 'remote' | 'user';
  registryVersion?: string;
  verifiedAt?: string | null;
  needsVerification?: boolean;
  customConfig?: GenericRestCustomConfig;
}

export interface GenericRestCustomConfig {
  modelsEndpoint?: string;
  chatEndpoint?: string;
  httpMethod: 'POST' | 'GET';
  modelField?: string;
  messageFormat?: 'openai' | 'simple-text' | 'raw';
  responseJsonPath?: string;
  requestTemplate?: string;
  customHeaders?: Record<string, string>;
}


