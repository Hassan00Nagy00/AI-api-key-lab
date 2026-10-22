import { KeyStatus, AuthVerified } from './key';
import { ModelTier, TierEvidence } from './provider';
import {
  ErrorCategory,
  ERROR_CATEGORIES,
  ERROR_CATEGORY_TO_KEY_STATUS,
} from '../domain/canonical';

export { ERROR_CATEGORIES, ERROR_CATEGORY_TO_KEY_STATUS };
export type { ErrorCategory };


export type TestLadderStage =
  | 'idle'
  | 'detecting-provider'
  | 'configuring-auth'
  | 'listing-models'      // Tier 0
  | 'selecting-model'
  | 'sending-prompt'      // Tier 2
  | 'validating-response'
  | 'completed'
  | 'failed';

export interface TestResult {
  id: string;
  keyId: string;
  providerId: string;
  status: KeyStatus;
  authVerified: AuthVerified;
  model: string;
  modelTier?: ModelTier;
  tierEvidence?: TierEvidence;
  httpStatus?: number;
  latencyMs: number;
  timeToFirstTokenMs?: number;
  responseSnippet?: string;
  reasoningSnippet?: string;
  reasoningOnlyWarning?: boolean;
  errorCategory?: ErrorCategory;
  errorMessage?: string;
  errorDetails?: string;
  testedAt: string;
  isFallbackModel?: boolean;
  attemptCount?: number;
  retryAfterSeconds?: number;
  rateLimitHeaders?: {
    limitRequests?: string;
    remainingRequests?: string;
    resetRequests?: string;
    limitTokens?: string;
    remainingTokens?: string;
    resetTokens?: string;
  };
}

export interface PreparedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyText: string;
  isOpaqueError?: boolean;
  latencyMs: number;
}
