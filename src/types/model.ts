import { ModelTier, TierEvidence, ModelAvailability } from './provider';

export interface DiscoveredModel {
  id: string;
  name: string;
  providerId: string;
  tier: ModelTier;
  tierEvidence: TierEvidence;
  availability: ModelAvailability;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsStreaming?: boolean;
  supportsChat?: boolean;
  source: 'live' | 'registry' | 'user';
  discoveredAt: string;
  isNew?: boolean;
  observed?: {
    lastWorkingAt?: string;
    lastFailureCategory?: string;
    medianLatencyMs?: number;
    successRate?: number;
    testCount?: number;
  };
}

export interface ModelRankingOptions {
  userSelectedModel?: string;
  lastKnownGoodModel?: string;
  allowPaidWithConfirmation?: boolean;
}
