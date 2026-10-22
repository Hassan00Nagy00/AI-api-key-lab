import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { BudgetService } from './budgetService';
import { ExpiryService } from './expiryService';
import { ModelWatchService, ModelWatchDiff } from './modelWatchAndQuota';
import { StorageService } from './storage';
import { ProviderRegistry } from './providerRegistry';
import { ApiTestService } from './testService';
import { defaultExecutor, ApiExecutor } from './executor';

export interface ScheduledHealthCheckReport {
  checkedKeyIds: string[];
  skippedExpiredKeyIds: string[];
  skippedUnauthorizedKeyIds: string[];
  skippedBudgetExhaustedKeyIds: string[];
}

export interface ScheduledModelWatchReport {
  checkedProviders: string[];
  selectedKeysByProvider: Record<string, string>;
  skippedExpiredKeyIds: string[];
  skippedUnauthorizedKeyIds: string[];
  skippedTier0BudgetKeyIds: string[];
  diffs: ModelWatchDiff[];
  coalescedNotification: string | null;
}

/**
 * Unified Scheduler (`07_P3 §0A.4` & `05_MASTER_PROMPT §5 / §13A`):
 * - Health checks and opt-in scheduled Model Watch (Tier 0 only, one key per provider,
 *   default 24 h, minimum 6 h) share ONE scheduler that runs only while the app is open
 *   and is off by default.
 * - Both obey the Budget Guard and skip expired (`ExpiryService.shouldSkipScheduledCheck`)
 *   and `unauthorized` (`key.status === 'unauthorized'`) keys.
 */
export class SchedulerService {
  private static healthTimer: ReturnType<typeof setInterval> | null = null;
  private static modelWatchTimer: ReturnType<typeof setInterval> | null = null;
  private static executor: ApiExecutor = defaultExecutor;

  static setExecutor(customExecutor: ApiExecutor): void {
    this.executor = customExecutor;
  }

  /**
   * Normalizes the Model Watch interval to enforce default 24 h and minimum 6 h (`07_P3 §0A.4`).
   */
  static normalizeModelWatchIntervalHours(hours?: number): number {
    if (typeof hours !== 'number' || Number.isNaN(hours)) {
      return 24;
    }
    return Math.max(6, Math.round(hours));
  }

  /**
   * Checks whether a key is eligible for any scheduled job (Health Check or Model Watch).
   * Skips expired and `unauthorized` keys.
   */
  static evaluateKeyEligibility(
    key: ApiKeyRecord,
    mode: 'health-check' | 'model-watch-tier0',
    now: Date = new Date()
  ): {
    eligible: boolean;
    reason?: 'unauthorized' | 'expired' | 'budget-exhausted';
  } {
    if (key.status === 'unauthorized') {
      return { eligible: false, reason: 'unauthorized' };
    }
    if (ExpiryService.shouldSkipScheduledCheck(key, now)) {
      return { eligible: false, reason: 'expired' };
    }
    if (mode === 'health-check' && BudgetService.isKeyBudgetExhausted(key.id)) {
      return { eligible: false, reason: 'budget-exhausted' };
    }
    if (mode === 'model-watch-tier0') {
      const state = BudgetService.getState(now);
      const settings = StorageService.getSettings();
      const capTier0 = settings.dailyTier0CapGlobal ?? 300;
      if (state.globalTier0Calls >= capTier0) {
        return { eligible: false, reason: 'budget-exhausted' };
      }
    }
    return { eligible: true };
  }

  /**
   * Runs one pass of Scheduled Health Checks across eligible keys.
   * Respects `settings.healthMonitoringEnabled` unless `forceRun` is true for testing.
   */
  static async runHealthCheckPass(options?: {
    keys?: ApiKeyRecord[];
    providers?: ProviderConfig[];
    now?: Date;
    forceRun?: boolean;
    runTestFn?: (key: ApiKeyRecord, provider: ProviderConfig) => Promise<unknown>;
  }): Promise<ScheduledHealthCheckReport> {
    const settings = StorageService.getSettings();
    const report: ScheduledHealthCheckReport = {
      checkedKeyIds: [],
      skippedExpiredKeyIds: [],
      skippedUnauthorizedKeyIds: [],
      skippedBudgetExhaustedKeyIds: [],
    };

    if (!options?.forceRun && !settings.healthMonitoringEnabled) {
      return report;
    }

    const now = options?.now || new Date();
    const keys = options?.keys || StorageService.getKeys();
    const providers = options?.providers || ProviderRegistry.getAll();

    for (const key of keys) {
      const eligibility = this.evaluateKeyEligibility(key, 'health-check', now);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'unauthorized') {
          report.skippedUnauthorizedKeyIds.push(key.id);
        } else if (eligibility.reason === 'expired') {
          report.skippedExpiredKeyIds.push(key.id);
        } else if (eligibility.reason === 'budget-exhausted') {
          report.skippedBudgetExhaustedKeyIds.push(key.id);
        }
        continue;
      }

      const provider = providers.find((p) => p.id === key.providerId);
      if (!provider) continue;

      if (options?.runTestFn) {
        // Consume 1 generation from Budget Guard for the health check
        const consumed = BudgetService.checkAndConsumeGeneration(key.id, { source: 'health-check' });
        if (!consumed.allowed) {
          report.skippedBudgetExhaustedKeyIds.push(key.id);
          continue;
        }
        await options.runTestFn(key, provider);
      } else {
        await ApiTestService.runVerificationLadder(key, provider, { isHealthCheck: true });
      }
      report.checkedKeyIds.push(key.id);
    }

    return report;
  }

  /**
   * Runs one pass of opt-in Scheduled Model Watch (`07_P3 §0A.4`):
   * - Tier 0 only (list models; never runs Tier 2 generation).
   * - Selects at most ONE eligible key per provider.
   * - Skips expired and `unauthorized` keys.
   * - Consumes from the separate Tier-0 budget counter (`BudgetService.checkAndConsumeTier0`).
   */
  static async runModelWatchPass(options?: {
    keys?: ApiKeyRecord[];
    providers?: ProviderConfig[];
    now?: Date;
    forceRun?: boolean;
    fetchTier0ModelsFn?: (key: ApiKeyRecord, provider: ProviderConfig) => Promise<DiscoveredModel[]>;
  }): Promise<ScheduledModelWatchReport> {
    const settings = StorageService.getSettings();
    const report: ScheduledModelWatchReport = {
      checkedProviders: [],
      selectedKeysByProvider: {},
      skippedExpiredKeyIds: [],
      skippedUnauthorizedKeyIds: [],
      skippedTier0BudgetKeyIds: [],
      diffs: [],
      coalescedNotification: null,
    };

    if (!options?.forceRun && !settings.scheduledModelWatchEnabled) {
      return report;
    }

    const now = options?.now || new Date();
    const keys = options?.keys || StorageService.getKeys();
    const providers = options?.providers || ProviderRegistry.getAll();

    // First filter out unauthorized, expired, and budget-exhausted keys so they are explicitly skipped & recorded
    const eligibleKeys: ApiKeyRecord[] = [];
    for (const key of keys) {
      const eligibility = this.evaluateKeyEligibility(key, 'model-watch-tier0', now);
      if (!eligibility.eligible) {
        if (eligibility.reason === 'unauthorized') {
          report.skippedUnauthorizedKeyIds.push(key.id);
        } else if (eligibility.reason === 'expired') {
          report.skippedExpiredKeyIds.push(key.id);
        } else if (eligibility.reason === 'budget-exhausted') {
          report.skippedTier0BudgetKeyIds.push(key.id);
        }
        continue;
      }
      eligibleKeys.push(key);
    }

    // Group eligible keys by provider and pick ONE eligible key per provider (preferring working keys first)
    const sortedKeys = [...eligibleKeys].sort((a, b) => {
      if (a.status === 'working' && b.status !== 'working') return -1;
      if (a.status !== 'working' && b.status === 'working') return 1;
      return 0;
    });

    const seenProviders = new Set<string>();

    for (const key of sortedKeys) {
      if (seenProviders.has(key.providerId)) {
        continue;
      }

      const provider = providers.find((p) => p.id === key.providerId);
      if (!provider || provider.supportsModelListing === false) {
        continue;
      }

      const tier0Consume = BudgetService.checkAndConsumeTier0(key.id);
      if (!tier0Consume.allowed) {
        report.skippedTier0BudgetKeyIds.push(key.id);
        continue;
      }

      seenProviders.add(provider.id);
      report.checkedProviders.push(provider.id);
      report.selectedKeysByProvider[provider.id] = key.id;

      let liveModels: DiscoveredModel[] = [];
      if (options?.fetchTier0ModelsFn) {
        liveModels = await options.fetchTier0ModelsFn(key, provider);
      } else {
        const adapter = ProviderRegistry.getAdapter(provider);
        const listReq = adapter.buildListModels(provider);
        if (listReq) {
          const res = await this.executor.execute(listReq, {
            keyId: key.id,
            boundHost: key.boundHost || provider.allowedHosts[0] || 'localhost',
            signal: new AbortController().signal,
          });
          if (res.status >= 200 && res.status < 300) {
            liveModels = adapter.parseModels(res.bodyText, provider);
          }
        }
      }

      if (liveModels.length > 0) {
        const diff = ModelWatchService.computeDiffAndSave(provider, liveModels, now);
        if (diff.hasChanges) {
          report.diffs.push(diff);
        }
      }
    }

    report.coalescedNotification = ModelWatchService.buildCoalescedDailyNotification(report.diffs);
    return report;
  }

  /**
   * Starts the unified in-memory scheduler while the application is open (`07_P3 §0A.4`).
   * Both jobs are OFF by default unless enabled in `AppSettings`.
   */
  static start(): void {
    this.stop();
    const settings = StorageService.getSettings();

    if (settings.healthMonitoringEnabled) {
      const healthHours = Math.max(1, settings.healthCheckIntervalHours || 6);
      this.healthTimer = setInterval(() => {
        void this.runHealthCheckPass();
      }, healthHours * 3600 * 1000);
      if (typeof this.healthTimer.unref === 'function') {
        this.healthTimer.unref();
      }
    }

    if (settings.scheduledModelWatchEnabled) {
      const watchHours = this.normalizeModelWatchIntervalHours(settings.modelWatchIntervalHours);
      this.modelWatchTimer = setInterval(() => {
        void this.runModelWatchPass();
      }, watchHours * 3600 * 1000);
      if (typeof this.modelWatchTimer.unref === 'function') {
        this.modelWatchTimer.unref();
      }
    }
  }

  /**
   * Stops all active timers (called on `before-quit` or when settings change).
   */
  static stop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.modelWatchTimer) {
      clearInterval(this.modelWatchTimer);
      this.modelWatchTimer = null;
    }
  }

  static isRunning(): { healthRunning: boolean; modelWatchRunning: boolean } {
    return {
      healthRunning: this.healthTimer !== null,
      modelWatchRunning: this.modelWatchTimer !== null,
    };
  }
}
