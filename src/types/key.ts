import {
  KeyStatus,
  KEY_STATUSES,
  AuthVerified,
  AUTH_VERIFIED_VALUES,
  ModelTier,
} from '../domain/canonical';

export { KEY_STATUSES, AUTH_VERIFIED_VALUES };
export type { KeyStatus, AuthVerified };

export interface LastKnownGood {
  at: string;
  model: string;
  latencyMs: number;
  modelTier?: ModelTier;
}

export interface ApiKeyRecord {
  id: string;
  label: string;
  providerId: string;
  boundHost: string;
  keyFingerprint: string; // Salted hash for duplicate detection
  maskedKey: string;      // sk-••••7F3A
  status: KeyStatus;
  authVerified: AuthVerified;
  lastTestedAt?: string;
  lastKnownGood?: LastKnownGood;
  selectedModel?: string;
  customBaseUrl?: string;
  customParams?: Record<string, string>;
  group?: string;
  labels?: string[];
  expiresAt?: string;     // Optional user-declared expiration ISO timestamp (§13A)
  expiryNote?: string;    // Optional note on expiration (§13A)
  billingWarningAcknowledged?: boolean; // One-time billing warning acknowledgement (§13A)
  createdAt: string;
  updatedAt: string;
  isDemo?: boolean;
}

export interface SecretStoreEntry {
  keyId: string;
  secret: string;
}

