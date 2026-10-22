import React from 'react';
import { ApiKeyRecord } from '../types/key';
import { TestResult } from '../types/test';
import { ProviderConfig } from '../types/provider';
import { AppRoute } from '../components/layout/Sidebar';
import { ExpiryService } from '../services/expiryService';
import { BudgetService } from '../services/budgetService';
import { StorageService } from '../services/storage';
import { t } from '../locales/i18n';
import { BidiToken } from '../components/common/BidiToken';
import {
  KeyRound,
  CheckCircle2,
  XCircle,
  Cpu,
  Sparkles,
  HelpCircle,
  Clock,
  ArrowRight,
  MessageSquare,
  FlaskConical,
  Plus,
  SlidersHorizontal,
  CalendarClock,
  ShieldCheck,
} from 'lucide-react';

interface DashboardViewProps {
  keys: ApiKeyRecord[];
  history: TestResult[];
  providers: ProviderConfig[];
  onNavigate: (route: AppRoute) => void;
  onOpenAddKey: () => void;
  onTestKey: (key: ApiKeyRecord) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  keys,
  history,
  providers,
  onNavigate,
  onOpenAddKey,
}) => {
  const totalKeys = keys.length;
  const workingKeys = keys.filter(k => k.status === 'working').length;
  const failedKeys = keys.filter(
    k =>
      k.status === 'unauthorized' ||
      k.status === 'forbidden' ||
      k.status === 'no-credit' ||
      k.status === 'config-error' ||
      k.status === 'provider-unavailable' ||
      k.status === 'no-usable-model'
  ).length;

  const rateLimitedKeys = keys.filter(k => k.status === 'rate-limited').length;
  const untestedKeys = keys.filter(k => k.status === 'untested').length;

  // Distinct configured providers with at least one key
  const configuredProviderIds = new Set(keys.map(k => k.providerId));
  const configuredProvidersCount = configuredProviderIds.size;

  // Models with confirmed free tier
  const freeModelsConfirmed = keys.filter(
    k => k.lastKnownGood?.modelTier === 'free'
  ).length;

  // Working with unverified tier
  const workingUnverified = keys.filter(
    k => k.status === 'working' && (!k.lastKnownGood?.modelTier || k.lastKnownGood?.modelTier === 'unknown')
  ).length;

  // Computed portfolio health percentage
  const healthPercent = totalKeys > 0 ? Math.round((workingKeys / totalKeys) * 100) : 0;

  // Last test
  const lastTest = history[0];

  // Key Expiry & Rotation Tracker (§13A)
  const expiryAlerts = ExpiryService.getExpiringSoonAndExpired(keys);

  // Budget Guard daily usage (§13A)
  const budgetUsage = BudgetService.getState();
  const settings = StorageService.getSettings();
  const globalGenCap = settings.dailyGenerationCapGlobal ?? 100;
  const globalTier0Cap = settings.dailyTier0CapGlobal ?? 300;

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* In-app Expiry & Rotation Banners (§13A) */}
      {expiryAlerts.length > 0 && (
        <div
          data-testid="expiring-soon-card"
          className="p-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300 uppercase tracking-wider">
              <CalendarClock size={15} className="text-amber-400" />
              <span>Expiring Soon & Rotation Tracker ({expiryAlerts.length})</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('all-keys')}
              className="text-xs text-amber-400 hover:text-amber-300 font-medium cursor-pointer"
            >
              Manage keys →
            </button>
          </div>
          <div className="space-y-1.5">
            {expiryAlerts.map(({ key: alertKey, evaluation }) => (
              <div
                key={alertKey.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-zinc-950/70 border border-amber-500/20 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                      evaluation.isExpired
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {evaluation.badgeText}
                  </span>
                  <span className="font-semibold text-zinc-200">{alertKey.label}</span>
                  <span className="text-zinc-500 uppercase font-mono text-[11px]">({alertKey.providerId})</span>
                </div>
                <div className="text-[11px] text-zinc-400">
                  <span>{evaluation.bannerText}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hero Banner per §7 */}
      <div className="relative overflow-hidden rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-900/90 to-zinc-950 p-8 shadow-xl">
        <div className="max-w-2xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-xs font-semibold text-blue-400">
              <Sparkles size={12} />
              <span>macOS Apple Silicon & Web Native</span>
            </div>
            <div
              onClick={() => onNavigate('settings')}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-300 cursor-pointer hover:bg-emerald-500/15"
              title="Daily Budget Guard & Cost-Safety Caps (§13A)"
            >
              <ShieldCheck size={12} />
              <span>
                Budget Guard: {budgetUsage.globalGenerations}/{globalGenCap} gen · {budgetUsage.globalTier0Calls}/{globalTier0Cap} Tier-0
              </span>
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {t('app.title')}
          </h2>

          <p className="text-sm text-zinc-400 leading-relaxed">
            {t('app.tagline')}
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-3">
            <button
              type="button"
              onClick={onOpenAddKey}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-md shadow-blue-500/20 cursor-pointer"
            >
              <Plus size={14} />
              <span>{t('dashboard.addKeyCta')}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('chat')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-all cursor-pointer"
            >
              <MessageSquare size={14} />
              <span>{t('dashboard.openChatCta')}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('backup')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-700/80 rounded-xl transition-all cursor-pointer"
            >
              <span>Import from Web / Backup</span>
            </button>
          </div>
        </div>
      </div>

      {/* Health Bar Visualization per §7 */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
              {t('dashboard.keyHealth')}
            </span>
            <span className="text-xs font-mono font-bold text-emerald-400">
              <BidiToken>{healthPercent}% working</BidiToken>
            </span>
          </div>
          <span className="text-xs text-zinc-400">
            {workingKeys} of {totalKeys} active keys operational
          </span>
        </div>

        {/* Multi-segment health bar */}
        <div className="w-full h-3 bg-zinc-950 rounded-full overflow-hidden flex border border-zinc-800">
          {totalKeys === 0 ? (
            <div className="w-full h-full bg-zinc-800/40" />
          ) : (
            <>
              <div
                style={{ width: `${(workingKeys / totalKeys) * 100}%` }}
                className="h-full bg-emerald-500 transition-all duration-300"
                title={`Working: ${workingKeys}`}
              />
              <div
                style={{ width: `${(rateLimitedKeys / totalKeys) * 100}%` }}
                className="h-full bg-amber-500 transition-all duration-300"
                title={`Rate Limited: ${rateLimitedKeys}`}
              />
              <div
                style={{ width: `${(failedKeys / totalKeys) * 100}%` }}
                className="h-full bg-rose-500 transition-all duration-300"
                title={`Failed: ${failedKeys}`}
              />
              <div
                style={{ width: `${(untestedKeys / totalKeys) * 100}%` }}
                className="h-full bg-zinc-700 transition-all duration-300"
                title={`Untested: ${untestedKeys}`}
              />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-400 pt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span>Working ({workingKeys})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span>Rate Limited ({rateLimitedKeys})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
            <span>Failed ({failedKeys})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
            <span>Untested ({untestedKeys})</span>
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Total Keys */}
        <div
          onClick={() => onNavigate('all-keys')}
          className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-medium">{t('dashboard.totalKeys')}</span>
            <KeyRound size={16} className="group-hover:text-blue-400 transition-colors" />
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-100">
            <BidiToken>{totalKeys}</BidiToken>
          </p>
        </div>

        {/* Working Keys */}
        <div
          onClick={() => onNavigate('working-keys')}
          className="p-5 rounded-2xl border border-emerald-500/20 bg-emerald-950/10 hover:border-emerald-500/40 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-emerald-400 mb-2">
            <span className="text-xs font-medium">{t('dashboard.workingKeys')}</span>
            <CheckCircle2 size={16} />
          </div>
          <p className="text-2xl font-bold font-mono text-emerald-400">
            <BidiToken>{workingKeys}</BidiToken>
          </p>
        </div>

        {/* Failed Keys */}
        <div
          onClick={() => onNavigate('failed-keys')}
          className="p-5 rounded-2xl border border-rose-500/20 bg-rose-950/10 hover:border-rose-500/40 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-rose-400 mb-2">
            <span className="text-xs font-medium">{t('dashboard.failedKeys')}</span>
            <XCircle size={16} />
          </div>
          <p className="text-2xl font-bold font-mono text-rose-400">
            <BidiToken>{failedKeys}</BidiToken>
          </p>
        </div>

        {/* Configured Providers */}
        <div
          onClick={() => onNavigate('providers')}
          className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-zinc-400 mb-2">
            <span className="text-xs font-medium">{t('dashboard.configuredProviders')}</span>
            <Cpu size={16} className="group-hover:text-blue-400 transition-colors" />
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-100">
            <BidiToken>{configuredProvidersCount}</BidiToken>
            <span className="text-xs text-zinc-500 ml-1.5 font-normal">
              / {providers.length}
            </span>
          </p>
        </div>
      </div>

      {/* Secondary Metrics: Confirmed Free Models vs Working Unverified vs Expiring Soon */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">
              {t('dashboard.freeModelsConfirmed')}
            </span>
            <span className="text-xl font-bold font-mono text-emerald-400">
              <BidiToken>{freeModelsConfirmed}</BidiToken>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
            <Sparkles size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">
              {t('dashboard.workingUnverified')}
            </span>
            <span className="text-xl font-bold font-mono text-zinc-300">
              <BidiToken>{workingUnverified}</BidiToken>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-800 text-zinc-400">
            <HelpCircle size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">
              Expiring Soon
            </span>
            <span className="text-xl font-bold font-mono text-amber-400">
              <BidiToken>{expiryAlerts.length}</BidiToken>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400">
            <CalendarClock size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">
              {t('dashboard.lastTest')}
            </span>
            <span className="text-xs font-mono text-zinc-300">
              {lastTest ? (
                <BidiToken monospace={false}>
                  {new Date(lastTest.testedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </BidiToken>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-800 text-zinc-400">
            <Clock size={18} />
          </div>
        </div>
      </div>

      {/* Quick Actions & Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            {t('dashboard.quickActions')}
          </h3>
          <div className="space-y-2 pt-1">
            <button
              onClick={onOpenAddKey}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950/70 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <KeyRound size={14} className="text-blue-400" />
                <span>{t('dashboard.addKeyCta')}</span>
              </div>
              <ArrowRight size={13} className="text-zinc-500 group-hover:text-zinc-200 transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              onClick={() => onNavigate('tester')}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950/70 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <FlaskConical size={14} className="text-emerald-400" />
                <span>{t('dashboard.testApiCta')}</span>
              </div>
              <ArrowRight size={13} className="text-zinc-500 group-hover:text-zinc-200 transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              onClick={() => onNavigate('chat')}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950/70 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <MessageSquare size={14} className="text-purple-400" />
                <span>{t('dashboard.openChatCta')}</span>
              </div>
              <ArrowRight size={13} className="text-zinc-500 group-hover:text-zinc-200 transition-transform group-hover:translate-x-0.5" />
            </button>

            <button
              onClick={() => onNavigate('custom-providers')}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-zinc-950/70 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal size={14} className="text-amber-400" />
                <span>{t('dashboard.customProviderCta')}</span>
              </div>
              <ArrowRight size={13} className="text-zinc-500 group-hover:text-zinc-200 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>

        {/* Recent Activity from Real Events Only (§7) */}
        <div className="md:col-span-2 p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              {t('dashboard.recentActivity')}
            </h3>
            {history.length > 0 && (
              <button
                onClick={() => onNavigate('history')}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
              >
                View all ({history.length})
              </button>
            )}
          </div>

          <div className="pt-1">
            {history.length === 0 ? (
              <p className="text-xs text-zinc-500 py-6 text-center">
                {t('dashboard.noRecentActivity')}
              </p>
            ) : (
              <div className="space-y-2">
                {history.slice(0, 5).map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          item.status === 'working'
                            ? 'bg-emerald-400'
                            : item.status === 'rate-limited'
                            ? 'bg-amber-400'
                            : 'bg-rose-400'
                        }`}
                      />
                      <div>
                        <span className="font-semibold text-zinc-200 uppercase mr-2">
                          {item.providerId}
                        </span>
                        <span className="font-mono text-zinc-400">
                          <BidiToken>{item.model}</BidiToken>
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-zinc-500 text-[11px] font-mono">
                      <span>{item.latencyMs}ms</span>
                      <BidiToken monospace={false}>
                        {new Date(item.testedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </BidiToken>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
