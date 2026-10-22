/**
 * Single Source of Truth for Canonical Definitions (§2 & docs/CANONICAL.md).
 * All canonical statuses, error categories, and model dimensions are defined ONCE here.
 */

export const KEY_STATUSES = [
  'untested',
  'testing',
  'working',
  'rate-limited',
  'unauthorized',
  'forbidden',
  'no-credit',
  'no-usable-model',
  'provider-unavailable',
  'network-error',
  'blocked-or-network',
  'config-error',
  'unknown-error',
] as const;

export type KeyStatus = (typeof KEY_STATUSES)[number];

export const AUTH_VERIFIED_VALUES = ['yes', 'no', 'unknown'] as const;
export type AuthVerified = (typeof AUTH_VERIFIED_VALUES)[number];

export const ERROR_CATEGORIES = [
  'auth',
  'forbidden',
  'insufficient-credit',
  'endpoint-not-found',
  'model-not-found',
  'bad-request',
  'timeout',
  'conflict',
  'rate-limit',
  'quota-exhausted',
  'server-error',
  'bad-gateway',
  'service-unavailable',
  'network',
  'cors-or-network',
  'malformed-response',
  'empty-response',
  'unknown',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const ERROR_CATEGORY_TO_KEY_STATUS: Record<ErrorCategory, KeyStatus> = {
  'auth': 'unauthorized',
  'forbidden': 'forbidden',
  'insufficient-credit': 'no-credit',
  'endpoint-not-found': 'config-error',
  'model-not-found': 'no-usable-model',
  'bad-request': 'config-error',
  'timeout': 'network-error',
  'conflict': 'unknown-error',
  'rate-limit': 'rate-limited',
  'quota-exhausted': 'rate-limited',
  'server-error': 'provider-unavailable',
  'bad-gateway': 'provider-unavailable',
  'service-unavailable': 'provider-unavailable',
  'network': 'network-error',
  'cors-or-network': 'blocked-or-network',
  'malformed-response': 'config-error',
  'empty-response': 'unknown-error',
  'unknown': 'unknown-error',
};

export const MODEL_TIERS = ['free', 'trial', 'paid', 'unknown'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const TIER_EVIDENCES = [
  'provider-api',
  'user',
  'registry',
  'naming-rule',
  'none',
] as const;
export type TierEvidence = (typeof TIER_EVIDENCES)[number];

export const MODEL_AVAILABILITIES = [
  'available',
  'unavailable',
  'deprecated',
  'unknown',
] as const;
export type ModelAvailability = (typeof MODEL_AVAILABILITIES)[number];

export const TEST_REQUEST_DEFAULTS = {
  message: 'Hi',
  maxOutputTokens: 256,
  temperature: undefined,
  timeoutMs: 30000,
  chatTimeoutMs: 120000,
  defaultFallbackAttempts: 2,
} as const;
