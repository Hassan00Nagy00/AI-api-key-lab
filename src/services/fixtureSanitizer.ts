import { KeyStatus, ErrorCategory } from '../domain/canonical';
import { RedactorService } from './redactor';

export type GoldenFixtureCase =
  | 'model-list'
  | 'valid-hi'
  | 'wrong-key'
  | 'wrong-model'
  | 'rate-limit';

export interface GoldenFixtureRecord {
  providerId: string;
  case: GoldenFixtureCase;
  recordedAt: string;
  httpStatus: number;
  headers: Record<string, string>;
  bodyText: string;
  expectedStatus?: KeyStatus;
  expectedCategory?: ErrorCategory;
  note?: string;
}

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const ORG_PROJECT_ID_REGEX = /\b(?:org-[A-Za-z0-9_-]{6,}|proj_[A-Za-z0-9_-]{6,}|projects\/[0-9a-zA-Z_-]{4,}|accounts\/[0-9a-zA-Z_-]{4,})\b/g;
const REQUEST_ID_REGEX = /\b(?:req_[A-Za-z0-9_-]{6,}|chatcmpl-[A-Za-z0-9_-]{6,}|msg_[A-Za-z0-9_-]{6,})\b/g;

const SAFE_HEADER_ALLOWLIST = new Set([
  'content-type',
  'retry-after',
  'x-ratelimit-limit-requests',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-tokens',
]);

/**
 * Golden Fixture Sanitizer (§13A MUST).
 * Removes the key, account/project/org IDs, request IDs, emails, and token-like strings,
 * and attaches `recordedAt` and `providerId`.
 */
export class FixtureSanitizer {
  static sanitizeText(rawText: string, secretKey?: string): string {
    if (!rawText) return '';
    let out = rawText;

    if (secretKey && secretKey.trim().length > 0) {
      const trimmed = secretKey.trim();
      out = out.split(trimmed).join('[REDACTED_KEY]');
      // Also scrub any 6+ char prefixes/suffixes of the key
      if (trimmed.length >= 12) {
        const first8 = trimmed.slice(0, 8);
        const last8 = trimmed.slice(-8);
        out = out.split(first8).join('[REDACTED_KEY_PART]');
        out = out.split(last8).join('[REDACTED_KEY_PART]');
      }
    }

    out = out.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
    out = out.replace(ORG_PROJECT_ID_REGEX, '[REDACTED_ACCOUNT_OR_PROJECT_ID]');
    out = out.replace(REQUEST_ID_REGEX, '[REDACTED_REQUEST_ID]');
    out = RedactorService.redactString(out, secretKey ? [secretKey] : []);

    return out;
  }

  static sanitizeHeaders(headers: Record<string, string>, secretKey?: string): Record<string, string> {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers || {})) {
      const lowerKey = k.toLowerCase();
      if (SAFE_HEADER_ALLOWLIST.has(lowerKey)) {
        clean[lowerKey] = this.sanitizeText(String(v), secretKey);
      }
    }
    return clean;
  }

  static createSanitizedFixture(params: {
    providerId: string;
    caseName: GoldenFixtureCase;
    httpStatus: number;
    headers: Record<string, string>;
    rawBody: string;
    secretKey?: string;
    recordedAt?: string;
    expectedStatus?: KeyStatus;
    expectedCategory?: ErrorCategory;
  }): GoldenFixtureRecord {
    return {
      providerId: params.providerId,
      case: params.caseName,
      recordedAt: params.recordedAt || new Date().toISOString(),
      httpStatus: params.httpStatus,
      headers: this.sanitizeHeaders(params.headers, params.secretKey),
      bodyText: this.sanitizeText(params.rawBody, params.secretKey),
      expectedStatus: params.expectedStatus,
      expectedCategory: params.expectedCategory,
    };
  }

  /**
   * Check if a golden fixture is older than 180 days (§13A).
   */
  static checkStaleness(
    recordedAt: string,
    now: Date = new Date()
  ): { isStale: boolean; ageDays: number } {
    const ts = Date.parse(recordedAt);
    if (Number.isNaN(ts)) {
      return { isStale: true, ageDays: 9999 };
    }
    const ageDays = Math.floor((now.getTime() - ts) / (1000 * 60 * 60 * 24));
    return {
      isStale: ageDays > 180,
      ageDays,
    };
  }
}
