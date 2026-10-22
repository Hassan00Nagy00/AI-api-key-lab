import { ApiKeyRecord } from '../types/key';

export type ExpiryAlertLevel =
  | 'none'
  | 'ok'
  | 'expiring-7d'
  | 'expiring-3d'
  | 'expiring-1d'
  | 'expired';

export interface KeyExpiryEvaluation {
  keyId: string;
  level: ExpiryAlertLevel;
  isExpired: boolean;
  daysRemaining: number | null;
  badgeText: string | null;
  bannerText: string | null;
  expiresAt?: string;
  expiryNote?: string;
}

/**
 * Expiry Alerts Service (§13A SHOULD).
 * Evaluates optional user-entered `expiresAt` (+ `expiryNote`) on a key.
 * Metadata only — NEVER changes `ApiKeyRecord.status`.
 * Expired keys are skipped by scheduled health checks.
 * Honesty note: No notification can fire while the app is closed.
 */
export class ExpiryService {
  static evaluateKey(key: ApiKeyRecord, now: Date = new Date()): KeyExpiryEvaluation {
    if (!key.expiresAt) {
      return {
        keyId: key.id,
        level: 'none',
        isExpired: false,
        daysRemaining: null,
        badgeText: null,
        bannerText: null,
      };
    }

    const expiryTime = Date.parse(key.expiresAt);
    if (Number.isNaN(expiryTime)) {
      return {
        keyId: key.id,
        level: 'none',
        isExpired: false,
        daysRemaining: null,
        badgeText: null,
        bannerText: null,
      };
    }

    const diffMs = expiryTime - now.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffMs <= 0) {
      return {
        keyId: key.id,
        level: 'expired',
        isExpired: true,
        daysRemaining: 0,
        badgeText: 'expired (user-declared)',
        bannerText: `Key "${key.label}" is expired (user-declared)${key.expiryNote ? ` — ${key.expiryNote}` : ''}. Scheduled checks skip this key.`,
        expiresAt: key.expiresAt,
        expiryNote: key.expiryNote,
      };
    }

    if (daysRemaining <= 1) {
      return {
        keyId: key.id,
        level: 'expiring-1d',
        isExpired: false,
        daysRemaining,
        badgeText: 'Expires in ≤1d',
        bannerText: `Key "${key.label}" expires within 24 hours (${new Date(expiryTime).toLocaleDateString()}).`,
        expiresAt: key.expiresAt,
        expiryNote: key.expiryNote,
      };
    }

    if (daysRemaining <= 3) {
      return {
        keyId: key.id,
        level: 'expiring-3d',
        isExpired: false,
        daysRemaining,
        badgeText: `Expires in ${daysRemaining}d`,
        bannerText: `Key "${key.label}" expires in ${daysRemaining} days (${new Date(expiryTime).toLocaleDateString()}).`,
        expiresAt: key.expiresAt,
        expiryNote: key.expiryNote,
      };
    }

    if (daysRemaining <= 7) {
      return {
        keyId: key.id,
        level: 'expiring-7d',
        isExpired: false,
        daysRemaining,
        badgeText: `Expires in ${daysRemaining}d`,
        bannerText: `Key "${key.label}" expires in ${daysRemaining} days (${new Date(expiryTime).toLocaleDateString()}).`,
        expiresAt: key.expiresAt,
        expiryNote: key.expiryNote,
      };
    }

    return {
      keyId: key.id,
      level: 'ok',
      isExpired: false,
      daysRemaining,
      badgeText: `Expires in ${daysRemaining}d`,
      bannerText: null,
      expiresAt: key.expiresAt,
      expiryNote: key.expiryNote,
    };
  }

  static isKeyExpired(key: ApiKeyRecord, now: Date = new Date()): boolean {
    return this.evaluateKey(key, now).isExpired;
  }

  static shouldSkipScheduledCheck(key: ApiKeyRecord, now: Date = new Date()): boolean {
    return this.isKeyExpired(key, now);
  }

  static getExpiringSoonAndExpired(
    keys: ApiKeyRecord[],
    now: Date = new Date()
  ): Array<{ key: ApiKeyRecord; evaluation: KeyExpiryEvaluation }> {
    const results: Array<{ key: ApiKeyRecord; evaluation: KeyExpiryEvaluation }> = [];
    for (const key of keys) {
      const evaluation = this.evaluateKey(key, now);
      if (
        evaluation.level === 'expired' ||
        evaluation.level === 'expiring-1d' ||
        evaluation.level === 'expiring-3d' ||
        evaluation.level === 'expiring-7d'
      ) {
        results.push({ key, evaluation });
      }
    }
    results.sort((a, b) => (a.evaluation.daysRemaining ?? 999) - (b.evaluation.daysRemaining ?? 999));
    return results;
  }
}
