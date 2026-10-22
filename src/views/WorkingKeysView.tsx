import React, { useState } from 'react';
import { ApiKeyRecord } from '../types/key';
import { ApiKeyTable } from '../components/keys/ApiKeyTable';
import { SearchBar } from '../components/common/SearchBar';
import { EmptyState } from '../components/common/EmptyState';
import { t } from '../locales/i18n';
import { CheckCircle2, AlertTriangle, KeyRound, ArrowUpDown } from 'lucide-react';

interface WorkingKeysViewProps {
  keys: ApiKeyRecord[];
  onTestKey: (key: ApiKeyRecord) => void;
  onOpenChat: (key: ApiKeyRecord) => void;
  onOpenConfig: (key: ApiKeyRecord) => void;
  onEditKey: (key: ApiKeyRecord) => void;
  onDeleteKey: (key: ApiKeyRecord) => void;
  onOpenAddKey: () => void;
}

export const WorkingKeysView: React.FC<WorkingKeysViewProps> = ({
  keys,
  onTestKey,
  onOpenChat,
  onOpenConfig,
  onEditKey,
  onDeleteKey,
  onOpenAddKey,
}) => {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'provider' | 'latency' | 'tested'>('tested');

  // Currently Working Keys (status === 'working')
  const workingKeys = keys.filter(
    k =>
      k.status === 'working' &&
      (k.label.toLowerCase().includes(search.toLowerCase()) ||
        k.providerId.toLowerCase().includes(search.toLowerCase()) ||
        (k.lastKnownGood?.model || '').toLowerCase().includes(search.toLowerCase()))
  );

  // Previously Working Keys (has lastKnownGood but current transient failure)
  const prevWorkingKeys = keys.filter(
    k =>
      k.status !== 'working' &&
      k.lastKnownGood &&
      (k.label.toLowerCase().includes(search.toLowerCase()) ||
        k.providerId.toLowerCase().includes(search.toLowerCase()) ||
        (k.lastKnownGood?.model || '').toLowerCase().includes(search.toLowerCase()))
  );

  const sortFn = (a: ApiKeyRecord, b: ApiKeyRecord) => {
    if (sortBy === 'provider') return a.providerId.localeCompare(b.providerId);
    if (sortBy === 'latency') return (a.lastKnownGood?.latencyMs || 9999) - (b.lastKnownGood?.latencyMs || 9999);
    return new Date(b.lastTestedAt || 0).getTime() - new Date(a.lastTestedAt || 0).getTime();
  };

  const sortedWorking = [...workingKeys].sort(sortFn);
  const sortedPrevWorking = [...prevWorkingKeys].sort(sortFn);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <CheckCircle2 size={20} className="text-emerald-400" />
            <span>{t('keys.workingSectionTitle')}</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {t('keys.workingSectionSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder={t('keys.searchPlaceholder')}
            className="w-64"
          />

          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1.5 text-xs text-zinc-400">
            <ArrowUpDown size={13} />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as any)}
              className="bg-transparent text-zinc-200 text-xs focus:outline-none cursor-pointer"
            >
              <option value="tested" className="bg-zinc-900">Sort: Last Tested</option>
              <option value="latency" className="bg-zinc-900">Sort: Latency</option>
              <option value="provider" className="bg-zinc-900">Sort: Provider</option>
            </select>
          </div>
        </div>
      </div>

      {/* Currently Working Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
            Currently Verified
          </span>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            {sortedWorking.length}
          </span>
        </div>

        {sortedWorking.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title={t('keys.noWorkingKeys')}
            description={t('keys.noWorkingKeysDesc')}
            action={{
              label: t('dashboard.addKeyCta'),
              onClick: onOpenAddKey,
              icon: KeyRound,
            }}
          />
        ) : (
          <ApiKeyTable
            keys={sortedWorking}
            onTest={onTestKey}
            onOpenChat={onOpenChat}
            onOpenConfig={onOpenConfig}
            onEdit={onEditKey}
            onDelete={onDeleteKey}
          />
        )}
      </section>

      {/* Previously Working Section per §7 */}
      {sortedPrevWorking.length > 0 && (
        <section className="space-y-3 pt-4 border-t border-zinc-800/80">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-amber-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
              {t('keys.prevWorkingSectionTitle')}
            </span>
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
              {sortedPrevWorking.length}
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            {t('keys.prevWorkingSectionSubtitle')}
          </p>

          <ApiKeyTable
            keys={sortedPrevWorking}
            onTest={onTestKey}
            onOpenChat={onOpenChat}
            onOpenConfig={onOpenConfig}
            onEdit={onEditKey}
            onDelete={onDeleteKey}
          />
        </section>
      )}
    </div>
  );
};
