import { ModelAvailability, ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { ApiKeyRecord } from '../types/key';
import { ProviderRegistry } from './providerRegistry';
import { ApiExecutor, defaultExecutor } from './executor';
import { BudgetService } from './budgetService';

const MODEL_WATCH_STORAGE_KEY = 'ai_lab_model_watch_snapshots_v1';
const QUOTA_SNAPSHOT_STORAGE_KEY = 'ai_lab_quota_snapshots_v1';

const nodeWatchMemory = new Map<string, string>();

function watchGet(key: string): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(key);
  }
  return nodeWatchMemory.get(key) || null;
}

function watchSet(key: string, val: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, val);
  } else {
    nodeWatchMemory.set(key, val);
  }
}

export interface ModelWatchEntry {
  id: string;
  availability: ModelAvailability;
}

export interface ModelWatchSnapshot {
  providerId: string;
  checkedAt: string;
  models: ModelWatchEntry[];
  lastNotifiedDate?: string; // Coalesce notifications at most once per day
}

export interface ModelWatchDiff {
  providerId: string;
  providerName: string;
  checkedAt: string;
  previousCheckedAt: string | null;
  added: string[];
  removed: string[];
  deprecatedMarked: string[];
  hasChanges: boolean;
  notificationCoalesced: boolean;
}

/**
 * Model Watch Service (§13A SHOULD).
 * Tier 0 only — NEVER a generation call.
 * One key per provider (prefers a working key).
 * Snapshot = set of model IDs + availability + time; diff reports new / removed / deprecated-marked.
 * No "frozen model" detection. Notifications are coalesced (at most one per day).
 */
export class ModelWatchService {
  private static executor: ApiExecutor = defaultExecutor;

  static setExecutor(customExecutor: ApiExecutor): void {
    this.executor = customExecutor;
  }

  static getSnapshots(): Record<string, ModelWatchSnapshot> {
    const raw = watchGet(MODEL_WATCH_STORAGE_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  static saveSnapshots(snapshots: Record<string, ModelWatchSnapshot>): void {
    watchSet(MODEL_WATCH_STORAGE_KEY, JSON.stringify(snapshots));
  }

  /**
   * Select at most one key per provider, preferring a `working` key.
   */
  static pickBestKeyForProvider(keys: ApiKeyRecord[], providerId: string): ApiKeyRecord | null {
    const matching = keys.filter(k => k.providerId === providerId);
    if (matching.length === 0) return null;
    const working = matching.find(k => k.status === 'working');
    return working || matching[0];
  }

  /**
   * Compare a newly fetched live model list against the previous snapshot for a provider.
   */
  static computeDiffAndSave(
    provider: ProviderConfig,
    liveModels: DiscoveredModel[],
    now: Date = new Date()
  ): ModelWatchDiff {
    const snapshots = this.getSnapshots();
    const prev = snapshots[provider.id] || null;
    const checkedAt = now.toISOString();
    const todayStr = BudgetService.getLocalCalendarDay(now);

    const currentEntries: ModelWatchEntry[] = liveModels.map(m => ({
      id: m.id,
      availability: m.availability || 'available',
    }));

    const added: string[] = [];
    const removed: string[] = [];
    const deprecatedMarked: string[] = [];

    if (prev) {
      const prevMap = new Map(prev.models.map(m => [m.id, m.availability]));
      const currMap = new Map(currentEntries.map(m => [m.id, m.availability]));

      for (const curr of currentEntries) {
        if (!prevMap.has(curr.id)) {
          added.push(curr.id);
        } else if (
          curr.availability === 'deprecated' &&
          prevMap.get(curr.id) !== 'deprecated'
        ) {
          deprecatedMarked.push(curr.id);
        }
      }

      for (const oldEntry of prev.models) {
        if (!currMap.has(oldEntry.id)) {
          removed.push(oldEntry.id);
        }
      }
    }

    const hasChanges = added.length > 0 || removed.length > 0 || deprecatedMarked.length > 0;
    const alreadyNotifiedToday = prev?.lastNotifiedDate === todayStr;
    const notificationCoalesced = hasChanges && alreadyNotifiedToday;

    snapshots[provider.id] = {
      providerId: provider.id,
      checkedAt,
      models: currentEntries,
      lastNotifiedDate: hasChanges ? todayStr : prev?.lastNotifiedDate,
    };
    this.saveSnapshots(snapshots);

    return {
      providerId: provider.id,
      providerName: provider.name,
      checkedAt,
      previousCheckedAt: prev?.checkedAt || null,
      added,
      removed,
      deprecatedMarked,
      hasChanges,
      notificationCoalesced,
    };
  }

  /**
   * Perform a manual Tier-0 check for model changes on a provider using one key (preferring working).
   */
  static async checkForProviderModelChanges(
    provider: ProviderConfig,
    key: ApiKeyRecord,
    signal?: AbortSignal
  ): Promise<{ diff: ModelWatchDiff; models: DiscoveredModel[] }> {
    const effectiveProvider: ProviderConfig = key.customBaseUrl
      ? { ...provider, baseUrl: key.customBaseUrl }
      : provider;
    const adapter = ProviderRegistry.getAdapter(effectiveProvider);
    const listReq = adapter.buildListModels(effectiveProvider);

    if (!listReq || effectiveProvider.supportsModelListing === false) {
      throw new Error(`Provider "${provider.name}" does not expose a Tier-0 model listing endpoint.`);
    }

    const tier0Budget = BudgetService.checkAndConsumeTier0(key.id);
    if (!tier0Budget.allowed) {
      throw new Error(tier0Budget.reason || 'Tier-0 daily cap reached');
    }

    const boundHost = key.boundHost || effectiveProvider.allowedHosts[0] || 'localhost';
    const res = await this.executor.execute(listReq, {
      keyId: key.id,
      boundHost,
      providerId: effectiveProvider.id,
      signal: signal || new AbortController().signal,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Tier-0 model list failed with HTTP ${res.status}`);
    }

    const liveModels = adapter.parseModels(res.bodyText, effectiveProvider);
    const diff = this.computeDiffAndSave(effectiveProvider, liveModels);
    return { diff, models: liveModels };
  }

  /**
   * Builds a coalesced daily notification string from ModelWatchDiff entries that have changes
   * and have not already been coalesced today.
   */
  static buildCoalescedDailyNotification(diffs: ModelWatchDiff[]): string | null {
    const actionable = diffs.filter((d) => d.hasChanges && !d.notificationCoalesced);
    if (actionable.length === 0) return null;

    const lines = actionable.map((d) => {
      const parts: string[] = [];
      if (d.added.length > 0) parts.push(`+${d.added.length} new`);
      if (d.removed.length > 0) parts.push(`-${d.removed.length} removed`);
      if (d.deprecatedMarked.length > 0) parts.push(`${d.deprecatedMarked.length} deprecated`);
      return `${d.providerName}: ${parts.join(', ')}`;
    });

    return `Model Watch Update — ${lines.join(' | ')}`;
  }
}

export interface QuotaSnapshotEntry {
  id: string;
  keyId: string;
  providerId: string;
  model: string;
  capturedAt: string;
  limitRequests?: number;
  remainingRequests?: number;
  limitTokens?: number;
  remainingTokens?: number;
  hasHeaders: boolean;
}

/**
 * Quota Snapshots Service (§13A COULD).
 * Stores rate-limit header values ONLY from requests the app already made, with time.
 * Never predicts a renewal date; reports "Provider limit unknown" when headers are absent.
 */
export class QuotaSnapshotService {
  static getSnapshots(): QuotaSnapshotEntry[] {
    const raw = watchGet(QUOTA_SNAPSHOT_STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  static recordFromHeaders(params: {
    keyId: string;
    providerId: string;
    model: string;
    headers?: {
      limitRequests?: string;
      remainingRequests?: string;
      limitTokens?: string;
      remainingTokens?: string;
    };
    capturedAt?: string;
  }): QuotaSnapshotEntry {
    const h = params.headers || {};
    const parseNum = (v?: string): number | undefined => {
      if (!v) return undefined;
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? n : undefined;
    };

    const limitRequests = parseNum(h.limitRequests);
    const remainingRequests = parseNum(h.remainingRequests);
    const limitTokens = parseNum(h.limitTokens);
    const remainingTokens = parseNum(h.remainingTokens);
    const hasHeaders =
      limitRequests !== undefined ||
      remainingRequests !== undefined ||
      limitTokens !== undefined ||
      remainingTokens !== undefined;

    const entry: QuotaSnapshotEntry = {
      id: crypto.randomUUID(),
      keyId: params.keyId,
      providerId: params.providerId,
      model: params.model,
      capturedAt: params.capturedAt || new Date().toISOString(),
      limitRequests,
      remainingRequests,
      limitTokens,
      remainingTokens,
      hasHeaders,
    };

    const list = this.getSnapshots();
    list.unshift(entry);
    if (list.length > 200) {
      list.length = 200;
    }
    watchSet(QUOTA_SNAPSHOT_STORAGE_KEY, JSON.stringify(list));
    return entry;
  }

  static formatQuotaStatus(entry?: QuotaSnapshotEntry | null): string {
    if (!entry || !entry.hasHeaders) {
      return 'Provider limit unknown';
    }
    const parts: string[] = [];
    if (entry.remainingRequests !== undefined && entry.limitRequests !== undefined) {
      parts.push(`Requests: ${entry.remainingRequests}/${entry.limitRequests}`);
    } else if (entry.remainingRequests !== undefined) {
      parts.push(`Remaining requests: ${entry.remainingRequests}`);
    }
    if (entry.remainingTokens !== undefined && entry.limitTokens !== undefined) {
      parts.push(`Tokens: ${entry.remainingTokens}/${entry.limitTokens}`);
    }
    return parts.join(' · ') || 'Provider limit unknown';
  }
}
