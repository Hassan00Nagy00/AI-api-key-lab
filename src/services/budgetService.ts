import { ApiKeyRecord } from '../types/key';
import { ProviderConfig, ModelTier } from '../types/provider';
import { StorageService } from './storage';

const BUDGET_STORAGE_KEY = 'ai_lab_budget_counters_v1';

export type GenerationRequestSource =
  | 'test'
  | 'fallback'
  | 'health-check'
  | 'playground'
  | 'gateway';

export interface DailyBudgetState {
  date: string; // Local calendar day YYYY-MM-DD
  globalGenerations: number;
  perKeyGenerations: Record<string, number>;
  globalTier0Calls: number;
  perKeyTier0Calls: Record<string, number>;
}

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  isGlobalCap?: boolean;
  isKeyCap?: boolean;
  canSoftOverrideInPlayground?: boolean;
  remainingKeyGenerations: number;
  remainingGlobalGenerations: number;
  usedKeyGenerations: number;
  usedGlobalGenerations: number;
  capPerKey: number;
  capGlobal: number;
}

const nodeBudgetMemory = new Map<string, string>();

function getRawBudget(): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(BUDGET_STORAGE_KEY);
  }
  return nodeBudgetMemory.get(BUDGET_STORAGE_KEY) || null;
}

function setRawBudget(val: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(BUDGET_STORAGE_KEY, val);
  } else {
    nodeBudgetMemory.set(BUDGET_STORAGE_KEY, val);
  }
}

export const UNKNOWN_TIER_BILLING_WARNING =
  'This account may have billing enabled; a model of unknown tier can be billed.';

/**
 * Budget Guard Service (§13A MUST).
 * Every generation request (tests, fallbacks, health checks, playground, gateway) goes through this service.
 * Tier-0 list calls have their own, separate counter and cap.
 */
export class BudgetService {
  static getLocalCalendarDay(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static getState(now: Date = new Date()): DailyBudgetState {
    const today = this.getLocalCalendarDay(now);
    const raw = getRawBudget();
    if (raw) {
      try {
        const parsed: DailyBudgetState = JSON.parse(raw);
        if (parsed && parsed.date === today) {
          return {
            date: today,
            globalGenerations: parsed.globalGenerations || 0,
            perKeyGenerations: parsed.perKeyGenerations || {},
            globalTier0Calls: parsed.globalTier0Calls || 0,
            perKeyTier0Calls: parsed.perKeyTier0Calls || {},
          };
        }
      } catch {
        // reset for today
      }
    }
    return {
      date: today,
      globalGenerations: 0,
      perKeyGenerations: {},
      globalTier0Calls: 0,
      perKeyTier0Calls: {},
    };
  }

  static saveState(state: DailyBudgetState): void {
    setRawBudget(JSON.stringify(state));
  }

  static resetCounters(now: Date = new Date()): void {
    this.saveState({
      date: this.getLocalCalendarDay(now),
      globalGenerations: 0,
      perKeyGenerations: {},
      globalTier0Calls: 0,
      perKeyTier0Calls: {},
    });
  }

  static getUsageSummary(keyId?: string): BudgetCheckResult {
    const settings = StorageService.getSettings();
    const capPerKey = settings.dailyGenerationCapPerKey ?? 20;
    const capGlobal = settings.dailyGenerationCapGlobal ?? 100;
    const state = this.getState();
    const usedKey = keyId ? state.perKeyGenerations[keyId] || 0 : 0;
    const usedGlobal = state.globalGenerations;

    const isKeyCap = keyId ? usedKey >= capPerKey : false;
    const isGlobalCap = usedGlobal >= capGlobal;
    const allowed = !isKeyCap && !isGlobalCap;

    return {
      allowed,
      isKeyCap,
      isGlobalCap,
      canSoftOverrideInPlayground: !allowed,
      remainingKeyGenerations: Math.max(0, capPerKey - usedKey),
      remainingGlobalGenerations: Math.max(0, capGlobal - usedGlobal),
      usedKeyGenerations: usedKey,
      usedGlobalGenerations: usedGlobal,
      capPerKey,
      capGlobal,
      reason: isKeyCap
        ? `Budget Guard: Daily generation cap reached for this key (${usedKey}/${capPerKey} today).`
        : isGlobalCap
        ? `Budget Guard: Global daily generation cap reached (${usedGlobal}/${capGlobal} today).`
        : undefined,
    };
  }

  /**
   * Check and consume 1 generation request from the daily budget.
   * At the cap: hard stop with a clear message (Playground: soft warning + confirmation override).
   */
  static checkAndConsumeGeneration(
    keyId: string,
    options?: {
      source?: GenerationRequestSource;
      allowPlaygroundOverride?: boolean;
    }
  ): BudgetCheckResult {
    const summary = this.getUsageSummary(keyId);
    const isPlaygroundOverride =
      options?.source === 'playground' && options?.allowPlaygroundOverride === true;

    if (!summary.allowed && !isPlaygroundOverride) {
      return summary;
    }

    const state = this.getState();
    state.globalGenerations += 1;
    state.perKeyGenerations[keyId] = (state.perKeyGenerations[keyId] || 0) + 1;
    this.saveState(state);

    return this.getUsageSummary(keyId);
  }

  /**
   * Tier-0 model list calls have their own, separate counter and cap (§13A).
   */
  static checkAndConsumeTier0(keyId: string): {
    allowed: boolean;
    usedGlobalTier0: number;
    capGlobalTier0: number;
    reason?: string;
  } {
    const settings = StorageService.getSettings();
    const capTier0 = settings.dailyTier0CapGlobal ?? 300;
    const state = this.getState();

    if (state.globalTier0Calls >= capTier0) {
      return {
        allowed: false,
        usedGlobalTier0: state.globalTier0Calls,
        capGlobalTier0: capTier0,
        reason: `Budget Guard: Daily Tier-0 model listing cap reached (${state.globalTier0Calls}/${capTier0} today).`,
      };
    }

    state.globalTier0Calls += 1;
    state.perKeyTier0Calls[keyId] = (state.perKeyTier0Calls[keyId] || 0) + 1;
    this.saveState(state);

    return {
      allowed: true,
      usedGlobalTier0: state.globalTier0Calls,
      capGlobalTier0: capTier0,
    };
  }

  /**
   * Health checks never run for a key whose budget is exhausted (§13A).
   */
  static isKeyBudgetExhausted(keyId: string): boolean {
    const summary = this.getUsageSummary(keyId);
    return !summary.allowed;
  }

  /**
   * Check whether the one-time billing warning should be displayed (§13A):
   * "This account may have billing enabled; a model of unknown tier can be billed."
   */
  static shouldShowBillingWarning(
    key: ApiKeyRecord,
    provider: ProviderConfig,
    modelTier?: ModelTier
  ): boolean {
    if (key.billingWarningAcknowledged) {
      return false;
    }
    const tierIsUnknown = !modelTier || modelTier === 'unknown';
    const providerCouldBill =
      provider.requiresCreditCard === true ||
      provider.freeTier?.type === 'trial' ||
      provider.freeTier?.type === 'limited' ||
      provider.freeTier?.type === 'unknown';
    return tierIsUnknown || providerCouldBill;
  }

  static acknowledgeBillingWarning(keyId: string): void {
    const keys = StorageService.getKeys();
    const target = keys.find(k => k.id === keyId);
    if (target && !target.billingWarningAcknowledged) {
      StorageService.saveKeyMetadata({
        ...target,
        billingWarningAcknowledged: true,
      });
    }
  }
}
