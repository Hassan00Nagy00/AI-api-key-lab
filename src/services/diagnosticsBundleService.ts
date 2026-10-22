import { StorageService } from './storage';
import { BUNDLED_PROVIDERS, BUNDLED_REGISTRY_VERSION } from '../providers/catalog';
import { KEY_STATUSES, ERROR_CATEGORIES, KeyStatus, ErrorCategory } from '../domain/canonical';
import { RedactorService } from './redactor';

export interface RedactedTestRecordSummary {
  providerId: string;
  hostSummary: string;
  model: string;
  status: KeyStatus;
  category: ErrorCategory | 'none';
  httpStatus: number | null;
  latencyMs: number;
  testedAt: string;
}

export interface DiagnosticsBundle {
  format: 'ai-api-key-lab-diagnostics-bundle';
  version: 1;
  generatedAt: string;
  appVersion: string;
  runtimeTier: 'desktop-electron' | 'browser-spa';
  environmentSummary: string;
  registryVersion: number;
  countsByStatus: Record<KeyStatus, number>;
  countsByCategory: Record<ErrorCategory, number>;
  lastTestRecords: RedactedTestRecordSummary[];
  nonSensitiveSettings: {
    theme: string;
    language: string;
    direction: string;
    fallbackAttemptsCount: number;
    dailyGenerationCapPerKey: number;
    dailyGenerationCapGlobal: number;
    dailyTier0CapGlobal: number;
    saveChatHistory: boolean;
    healthMonitoringEnabled: boolean;
  };
  toolVersions: {
    schemaVersion: number;
    bundledProvidersCount: number;
    customProvidersCount: number;
  };
}

/**
 * Diagnostics Bundle Service (§13A MUST).
 * Exports a redacted report (JSON + readable text).
 * Never includes: keys, fingerprints, prompts, responses, URLs with query strings, or raw custom hosts (replaced by hash).
 * Passes through RedactorService and is covered by the Canary-secret test.
 */
export class DiagnosticsBundleService {
  private static isBundledHost(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    return BUNDLED_PROVIDERS.some(p =>
      p.allowedHosts.some(h => h.toLowerCase() === lower)
    );
  }

  static generateBundle(maxRecords: number = 25): {
    bundle: DiagnosticsBundle;
    json: string;
    text: string;
  } {
    const keys = StorageService.getKeys();
    const history = StorageService.getHistory();
    const settings = StorageService.getSettings();
    const customProviders = StorageService.getCustomProviders();

    const countsByStatus = Object.fromEntries(
      KEY_STATUSES.map(s => [s, 0])
    ) as Record<KeyStatus, number>;

    for (const k of keys) {
      if (countsByStatus[k.status] !== undefined) {
        countsByStatus[k.status] += 1;
      }
    }

    const countsByCategory = Object.fromEntries(
      ERROR_CATEGORIES.map(c => [c, 0])
    ) as Record<ErrorCategory, number>;

    for (const h of history) {
      if (h.errorCategory && countsByCategory[h.errorCategory] !== undefined) {
        countsByCategory[h.errorCategory] += 1;
      }
    }

    const keyMap = new Map(keys.map(k => [k.id, k]));

    const lastTestRecords: RedactedTestRecordSummary[] = history
      .slice(0, maxRecords)
      .map(rec => {
        const keyRecord = keyMap.get(rec.keyId);
        const rawHost = keyRecord?.boundHost || 'unknown';
        const hostSummary =
          rawHost === 'unknown'
            ? 'unknown'
            : this.isBundledHost(rawHost)
            ? rawHost
            : RedactorService.hashCustomHost(rawHost);

        return {
          providerId: rec.providerId,
          hostSummary,
          model: rec.model,
          status: rec.status,
          category: rec.errorCategory || 'none',
          httpStatus: rec.httpStatus ?? null,
          latencyMs: rec.latencyMs,
          testedAt: rec.testedAt,
        };
      });

    const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI);
    const envSummary =
      typeof navigator !== 'undefined'
        ? `${navigator.platform || 'unknown-platform'} (${isElectron ? 'Electron' : 'Browser'})`
        : `Node ${typeof process !== 'undefined' ? process.version : 'unknown'} (${typeof process !== 'undefined' ? process.platform + '/' + process.arch : 'unknown'})`;

    const rawBundle: DiagnosticsBundle = {
      format: 'ai-api-key-lab-diagnostics-bundle',
      version: 1,
      generatedAt: new Date().toISOString(),
      appVersion: '1.0.0',
      runtimeTier: isElectron ? 'desktop-electron' : 'browser-spa',
      environmentSummary: envSummary,
      registryVersion: BUNDLED_REGISTRY_VERSION,
      countsByStatus,
      countsByCategory,
      lastTestRecords,
      nonSensitiveSettings: {
        theme: settings.theme,
        language: settings.language,
        direction: settings.direction,
        fallbackAttemptsCount: settings.fallbackAttemptsCount,
        dailyGenerationCapPerKey: settings.dailyGenerationCapPerKey,
        dailyGenerationCapGlobal: settings.dailyGenerationCapGlobal,
        dailyTier0CapGlobal: settings.dailyTier0CapGlobal,
        saveChatHistory: settings.saveChatHistory,
        healthMonitoringEnabled: settings.healthMonitoringEnabled,
      },
      toolVersions: {
        schemaVersion: 1,
        bundledProvidersCount: BUNDLED_PROVIDERS.length,
        customProvidersCount: customProviders.length,
      },
    };

    const json = RedactorService.redactString(JSON.stringify(rawBundle, null, 2));
    const safeBundle: DiagnosticsBundle = JSON.parse(json);

    const statusLines = Object.entries(safeBundle.countsByStatus)
      .filter(([, count]) => count > 0)
      .map(([st, count]) => `  - ${st}: ${count}`)
      .join('\n') || '  (no keys)';

    const categoryLines = Object.entries(safeBundle.countsByCategory)
      .filter(([, count]) => count > 0)
      .map(([cat, count]) => `  - ${cat}: ${count}`)
      .join('\n') || '  (no error records)';

    const recordLines = safeBundle.lastTestRecords
      .map(
        (r, idx) =>
          `  ${idx + 1}. [${r.testedAt}] provider=${r.providerId} host=${r.hostSummary} model=${r.model} status=${r.status} category=${r.category} http=${r.httpStatus ?? 'N/A'} latency=${r.latencyMs}ms`
      )
      .join('\n') || '  (no test records)';

    const rawText = [
      '=== AI API Key Lab — Redacted Diagnostics Bundle ===',
      `Generated At: ${safeBundle.generatedAt}`,
      `App Version: ${safeBundle.appVersion}`,
      `Runtime Tier: ${safeBundle.runtimeTier}`,
      `Environment: ${safeBundle.environmentSummary}`,
      `Registry Version: v${safeBundle.registryVersion} (Bundled: ${safeBundle.toolVersions.bundledProvidersCount}, Custom: ${safeBundle.toolVersions.customProvidersCount})`,
      '',
      'Counts by Canonical Key Status:',
      statusLines,
      '',
      'Counts by Canonical Error Category:',
      categoryLines,
      '',
      `Last ${safeBundle.lastTestRecords.length} Test Records (Redacted — no secrets, fingerprints, prompts, or responses):`,
      recordLines,
      '',
      'Non-Sensitive Settings:',
      `  theme=${safeBundle.nonSensitiveSettings.theme}, lang=${safeBundle.nonSensitiveSettings.language}, fallbackAttempts=${safeBundle.nonSensitiveSettings.fallbackAttemptsCount}`,
      `  dailyCapPerKey=${safeBundle.nonSensitiveSettings.dailyGenerationCapPerKey}, dailyCapGlobal=${safeBundle.nonSensitiveSettings.dailyGenerationCapGlobal}, saveChatHistory=${safeBundle.nonSensitiveSettings.saveChatHistory}`,
      '====================================================',
    ].join('\n');

    const text = RedactorService.redactString(rawText);

    return {
      bundle: safeBundle,
      json,
      text,
    };
  }
}
