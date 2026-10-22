import React, { useState } from 'react';
import { ProviderConfig } from '../types/provider';
import { SearchBar } from '../components/common/SearchBar';
import { BidiToken } from '../components/common/BidiToken';
import { t } from '../locales/i18n';
import {
  Cpu,
  Sparkles,
  ExternalLink,
  Plus,
  ShieldCheck,
  AlertCircle,
  CreditCard,
} from 'lucide-react';

interface ProvidersViewProps {
  providers: ProviderConfig[];
  onAddKeyForProvider: (providerId: string) => void;
  onOpenCustomProvider: () => void;
}

export const ProvidersView: React.FC<ProvidersViewProps> = ({
  providers,
  onAddKeyForProvider,
  onOpenCustomProvider,
}) => {
  const [search, setSearch] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<string>('all');
  const [freeTierFilter, setFreeTierFilter] = useState<string>('all');

  const filtered = providers.filter(p => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.id.toLowerCase().includes(search.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(search.toLowerCase());

    const matchesProtocol = protocolFilter === 'all' || p.protocol === protocolFilter;
    const matchesFree =
      freeTierFilter === 'all' ||
      (freeTierFilter === 'free' && (p.freeTier?.type === 'permanent' || p.freeTier?.type === 'renewable')) ||
      (freeTierFilter === 'trial' && p.freeTier?.type === 'trial');

    return matchesSearch && matchesProtocol && matchesFree;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Cpu size={20} className="text-blue-400" />
            <span>{t('providers.title')}</span>
            <span className="text-xs font-mono text-zinc-500 font-normal">
              ({filtered.length} / {providers.length})
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {t('providers.subtitle')}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenCustomProvider}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
        >
          <Plus size={14} />
          <span>{t('providers.customProvider')}</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-zinc-900/60 rounded-2xl border border-zinc-800">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder={t('providers.search')}
          className="w-full sm:w-72"
        />

        {/* Protocol Filter */}
        <select
          value={protocolFilter}
          onChange={e => setProtocolFilter(e.target.value)}
          className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="all">All Protocols</option>
          <option value="openai-compatible">OpenAI-Compatible</option>
          <option value="anthropic-compatible">Anthropic Messages</option>
          <option value="google-gemini">Google Gemini</option>
          <option value="cohere">Cohere Native</option>
          <option value="generic-rest">Generic REST</option>
        </select>

        {/* Free Tier Filter */}
        <select
          value={freeTierFilter}
          onChange={e => setFreeTierFilter(e.target.value)}
          className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="all">All Tiers</option>
          <option value="free">Permanent / Renewable Free Tier</option>
          <option value="trial">Free Trial Credits</option>
        </select>
      </div>

      {/* Provider Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(p => {
          const hasFree = p.freeTier?.type === 'permanent' || p.freeTier?.type === 'renewable';
          const isTrial = p.freeTier?.type === 'trial';

          return (
            <div
              key={p.id}
              className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 hover:border-zinc-700/80 transition-all flex flex-col justify-between group"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-zinc-100 text-sm group-hover:text-blue-400 transition-colors">
                      {p.name}
                    </h3>
                    <span className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">
                      <BidiToken monospace>{p.protocol.replace('-compatible', '')}</BidiToken>
                    </span>
                  </div>

                  {hasFree && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
                      <Sparkles size={10} />
                      <span>{t('keys.tierFree')}</span>
                    </span>
                  )}
                  {isTrial && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-semibold">
                      <span>{t('keys.tierTrial')}</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                  {p.description || 'API provider configuration and endpoints.'}
                </p>

                {p.baseUrl && (
                  <div className="p-2 bg-zinc-950/80 rounded-lg border border-zinc-800 text-[11px] font-mono text-zinc-400 truncate">
                    <span className="text-zinc-500">Base: </span>
                    <BidiToken>{p.baseUrl}</BidiToken>
                  </div>
                )}

                {/* Flags / Requirements */}
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400 pt-1">
                  {p.requiresCreditCard ? (
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <CreditCard size={11} />
                      <span>Card Required</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-emerald-400">
                      <ShieldCheck size={11} />
                      <span>No Card Needed</span>
                    </span>
                  )}

                  {p.needsVerification && (
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <AlertCircle size={11} />
                      <span>{t('providers.needsVerification')}</span>
                    </span>
                  )}

                  {p.models && p.models.length > 0 && (
                    <span className="text-zinc-500 font-mono">
                      {p.models.length} {t('providers.modelsCount')}
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 mt-4 border-t border-zinc-800/80">
                {p.keyUrl ? (
                  <a
                    href={p.keyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                  >
                    <span>{t('providers.getKey')}</span>
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="text-xs text-zinc-500">—</span>
                )}

                <button
                  type="button"
                  onClick={() => onAddKeyForProvider(p.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  <Plus size={13} />
                  <span>{t('providers.addKeyFor')}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
