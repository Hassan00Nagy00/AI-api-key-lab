import React, { useState } from 'react';
import { ApiKeyRecord } from '../types/key';
import { ApiKeyTable } from '../components/keys/ApiKeyTable';
import { SearchBar } from '../components/common/SearchBar';
import { EmptyState } from '../components/common/EmptyState';
import { t } from '../locales/i18n';
import { KeyRound, Plus } from 'lucide-react';

interface AllKeysViewProps {
  keys: ApiKeyRecord[];
  onTestKey: (key: ApiKeyRecord) => void;
  onOpenChat: (key: ApiKeyRecord) => void;
  onOpenConfig: (key: ApiKeyRecord) => void;
  onEditKey: (key: ApiKeyRecord) => void;
  onDeleteKey: (key: ApiKeyRecord) => void;
  onMarkUntested: (key: ApiKeyRecord) => void;
  onOpenAddKey: () => void;
}

export const AllKeysView: React.FC<AllKeysViewProps> = ({
  keys,
  onTestKey,
  onOpenChat,
  onOpenConfig,
  onEditKey,
  onDeleteKey,
  onMarkUntested,
  onOpenAddKey,
}) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');

  const uniqueProviders = Array.from(new Set(keys.map(k => k.providerId)));

  const filteredKeys = keys.filter(k => {
    const matchesSearch =
      k.label.toLowerCase().includes(search.toLowerCase()) ||
      k.providerId.toLowerCase().includes(search.toLowerCase()) ||
      (k.lastKnownGood?.model || '').toLowerCase().includes(search.toLowerCase()) ||
      (k.selectedModel || '').toLowerCase().includes(search.toLowerCase());

    const matchesStatus = statusFilter === 'all' || k.status === statusFilter;
    const matchesProvider = providerFilter === 'all' || k.providerId === providerFilter;

    return matchesSearch && matchesStatus && matchesProvider;
  });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <span>{t('nav.allKeys')}</span>
            <span className="text-xs font-mono text-zinc-500 font-normal">
              ({filteredKeys.length} / {keys.length})
            </span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Manage, filter, and execute test ladders across your entire AI API key collection.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAddKey}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer self-start sm:self-auto"
        >
          <Plus size={14} />
          <span>{t('dashboard.addKeyCta')}</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 p-3 bg-zinc-900/60 rounded-2xl border border-zinc-800">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder={t('keys.searchPlaceholder')}
          className="w-full sm:w-72"
        />

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="all">All Statuses</option>
          <option value="working">Working</option>
          <option value="rate-limited">Rate Limited</option>
          <option value="unauthorized">Unauthorized (401)</option>
          <option value="untested">Untested</option>
          <option value="forbidden">Forbidden (403)</option>
          <option value="no-credit">No Credit (402)</option>
          <option value="provider-unavailable">Provider Unavailable</option>
          <option value="blocked-or-network">Blocked / Network</option>
        </select>

        {/* Provider Filter */}
        <select
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
          className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 focus:outline-none focus:border-blue-500 cursor-pointer"
        >
          <option value="all">All Providers</option>
          {uniqueProviders.map(p => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Keys Table */}
      {filteredKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t('keys.noKeys')}
          description={t('keys.noKeysDesc')}
          action={{
            label: t('dashboard.addKeyCta'),
            onClick: onOpenAddKey,
            icon: Plus,
          }}
        />
      ) : (
        <ApiKeyTable
          keys={filteredKeys}
          onTest={onTestKey}
          onOpenChat={onOpenChat}
          onOpenConfig={onOpenConfig}
          onEdit={onEditKey}
          onDelete={onDeleteKey}
          onMarkUntested={onMarkUntested}
        />
      )}
    </div>
  );
};
