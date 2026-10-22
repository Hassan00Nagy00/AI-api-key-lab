import React, { useState, useEffect, useCallback } from 'react';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { ApiKeyRecord } from '../types/key';
import { ProviderRegistry } from '../services/providerRegistry';
import { BrowserApiExecutor } from '../services/executor';
import { ModelSelector } from '../services/modelSelector';
import { ModelWatchService, ModelWatchDiff } from '../services/modelWatchAndQuota';
import { BudgetService } from '../services/budgetService';
import { SearchBar } from '../components/common/SearchBar';
import { TierBadge } from '../components/common/TierBadge';
import { BidiToken } from '../components/common/BidiToken';
import { t } from '../locales/i18n';
import { Layers, RefreshCw, Sparkles, Radio, Clock, BellRing } from 'lucide-react';

interface ModelsViewProps {
  providers: ProviderConfig[];
  keys: ApiKeyRecord[];
}

export const ModelsView: React.FC<ModelsViewProps> = ({ providers, keys }) => {
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [watchSummary, setWatchSummary] = useState<string | null>(null);
  const [watchDiffs, setWatchDiffs] = useState<ModelWatchDiff[]>([]);

  // Load registry models initially
  const loadRegistryModels = useCallback(() => {
    const list: DiscoveredModel[] = [];
    const now = new Date().toISOString();

    for (const p of providers) {
      if (p.models) {
        for (const m of p.models) {
          list.push({
            id: m.id,
            name: m.name || m.id,
            providerId: p.id,
            tier: m.tier || 'unknown',
            tierEvidence: m.tierEvidence || 'registry',
            availability: m.availability || 'available',
            contextWindow: m.contextWindow || 4096,
            supportsStreaming: m.supportsStreaming ?? true,
            supportsChat: m.supportsChat ?? true,
            source: 'registry',
            discoveredAt: now,
          });
        }
      }
    }
    setModels(list);
    setLastUpdated(now);
  }, [providers]);

  useEffect(() => {
    loadRegistryModels();
  }, [loadRegistryModels]);

  // Live Discovery Refresh & Manual Model Watch per §9 & §13A
  const handleRefreshLive = async () => {
    setIsRefreshing(true);
    const executor = new BrowserApiExecutor();
    let currentModels = [...models];
    const diffs: ModelWatchDiff[] = [];

    // One key per provider (prefers a working key) per §13A Model Watch
    const providerIds = Array.from(new Set(keys.map(k => k.providerId)));
    for (const provId of providerIds) {
      const key = ModelWatchService.pickBestKeyForProvider(keys, provId);
      const baseProvider = ProviderRegistry.get(provId);
      if (!key || !baseProvider || baseProvider.supportsModelListing === false) continue;

      const tier0Check = BudgetService.checkAndConsumeTier0(key.id);
      if (!tier0Check.allowed) break;

      const provider: ProviderConfig = key.customBaseUrl
        ? { ...baseProvider, baseUrl: key.customBaseUrl }
        : baseProvider;

      const adapter = ProviderRegistry.getAdapter(provider);
      const req = adapter.buildListModels(provider);
      if (!req) continue;

      try {
        const boundHost = key.boundHost || provider.allowedHosts[0];
        const res = await executor.execute(req, {
          keyId: key.id,
          boundHost,
          signal: new AbortController().signal,
        });

        if (res.status >= 200 && res.status < 300) {
          const parsed = adapter.parseModels(res.bodyText, provider);
          if (parsed && parsed.length > 0) {
            const diff = ModelWatchService.computeDiffAndSave(provider, parsed);
            diffs.push(diff);
            currentModels = ModelSelector.mergeLiveWithRegistryModels(
              currentModels,
              parsed,
              provider.id
            );
          }
        }
      } catch {
        // Continue with other providers
      }
    }

    setWatchDiffs(diffs);
    const changed = diffs.filter(d => d.hasChanges && !d.notificationCoalesced);
    setWatchSummary(
      changed.length > 0
        ? `Model Watch: Changes detected across ${changed.length} provider(s).`
        : keys.length > 0
        ? 'Model Watch complete: No model additions, removals, or deprecations detected.'
        : 'Add a working key first to run live Tier-0 Model Watch.'
    );
    setModels(currentModels);
    setLastUpdated(new Date().toISOString());
    setIsRefreshing(false);
  };

  const filtered = models.filter(m => {
    const matchesSearch =
      m.id.toLowerCase().includes(search.toLowerCase()) ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.providerId.toLowerCase().includes(search.toLowerCase());

    const matchesTier =
      tierFilter === 'all' ||
      (tierFilter === 'free' && m.tier === 'free') ||
      (tierFilter === 'trial' && m.tier === 'trial') ||
      (tierFilter === 'paid' && m.tier === 'paid') ||
      (tierFilter === 'unknown' && (!m.tier || m.tier === 'unknown'));

    return matchesSearch && matchesTier;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Layers size={20} className="text-blue-400" />
            <span>{t('models.title')}</span>
            <span className="text-xs font-mono text-zinc-500 font-normal">
              ({filtered.length} models)
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {t('models.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {lastUpdated && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
              <Clock size={12} className="text-zinc-500" />
              <span>Updated: {new Date(lastUpdated).toLocaleTimeString()}</span>
            </span>
          )}
          <button
            type="button"
            onClick={handleRefreshLive}
            disabled={isRefreshing}
            data-testid="check-model-changes-btn"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
          >
            <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
            <span>{isRefreshing ? t('models.refreshing') : 'Check for Model Changes'}</span>
          </button>
        </div>
      </div>

      {/* Model Watch Coalesced Diff Banner (§13A) */}
      {watchSummary && (
        <div
          data-testid="model-watch-banner"
          className="p-4 rounded-2xl border border-blue-500/30 bg-blue-950/20 text-xs text-blue-200 space-y-2"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold text-blue-300">
              <BellRing size={15} />
              <span>{watchSummary}</span>
            </div>
            <button
              type="button"
              onClick={() => setWatchSummary(null)}
              className="text-zinc-400 hover:text-zinc-200"
            >
              Dismiss
            </button>
          </div>
          {watchDiffs.some(d => d.hasChanges) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
              {watchDiffs.map(d => (
                <div key={d.providerId} className="p-2.5 rounded-xl bg-zinc-950/70 border border-zinc-800">
                  <div className="font-bold text-zinc-200 uppercase mb-1">{d.providerId}</div>
                  {d.added.length > 0 && (
                    <div className="text-emerald-400">+ New: {d.added.join(', ')}</div>
                  )}
                  {d.removed.length > 0 && (
                    <div className="text-rose-400">- Removed: {d.removed.join(', ')}</div>
                  )}
                  {d.deprecatedMarked.length > 0 && (
                    <div className="text-amber-400">! Deprecated: {d.deprecatedMarked.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-zinc-900/60 rounded-2xl border border-zinc-800">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder={t('models.search')}
          className="w-full sm:w-72"
        />

        <select
          value={tierFilter}
          onChange={e => setTierFilter(e.target.value)}
          className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="all">All Tiers</option>
          <option value="free">Confirmed Free Tier</option>
          <option value="trial">Trial Tier</option>
          <option value="paid">Paid</option>
          <option value="unknown">Tier Unverified</option>
        </select>
      </div>

      {/* Models Table */}
      <div className="w-full overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-zinc-800/80 bg-zinc-900/90 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              <th className="py-3 px-4">{t('models.model')}</th>
              <th className="py-3 px-4">{t('models.provider')}</th>
              <th className="py-3 px-4">{t('models.tier')}</th>
              <th className="py-3 px-4">{t('models.context')}</th>
              <th className="py-3 px-4">{t('models.source')}</th>
              <th className="py-3 px-4">{t('models.availability')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-xs text-zinc-300">
            {filtered.map((m, idx) => (
              <tr key={`${m.providerId}:::${m.id}:::${idx}`} className="hover:bg-zinc-800/40 transition-colors">
                <td className="py-3.5 px-4 font-mono font-medium text-zinc-100">
                  <div className="flex items-center gap-2">
                    <BidiToken>{m.id}</BidiToken>
                    {m.isNew && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        NEW
                      </span>
                    )}
                  </div>
                  {m.name && m.name !== m.id && (
                    <span className="block text-[11px] text-zinc-400 font-sans mt-0.5">
                      {m.name}
                    </span>
                  )}
                </td>

                <td className="py-3.5 px-4 font-semibold text-zinc-300 uppercase text-xs">
                  {m.providerId}
                </td>

                <td className="py-3.5 px-4">
                  <TierBadge tier={m.tier} evidence={m.tierEvidence} size="sm" />
                </td>

                <td className="py-3.5 px-4 font-mono text-zinc-400 text-xs">
                  {m.contextWindow ? (
                    <BidiToken>{m.contextWindow.toLocaleString()} tokens</BidiToken>
                  ) : (
                    '—'
                  )}
                </td>

                <td className="py-3.5 px-4">
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono ${
                      m.source === 'live'
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : 'bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {m.source === 'live' ? <Radio size={10} /> : <Sparkles size={10} />}
                    <span>{m.source === 'live' ? t('models.sourceLive') : t('models.sourceRegistry')}</span>
                  </span>
                </td>

                <td className="py-3.5 px-4 text-xs">
                  {m.availability === 'unavailable' ? (
                    <span className="text-amber-400 font-medium">Unavailable</span>
                  ) : (
                    <span className="text-emerald-400 font-medium">Available</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
