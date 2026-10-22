import React from 'react';
import { ApiKeyRecord } from '../../types/key';
import { StatusBadge } from '../common/StatusBadge';
import { TierBadge } from '../common/TierBadge';
import { MaskedKeyDisplay } from './MaskedKeyDisplay';
import { BidiToken } from '../common/BidiToken';
import { t } from '../../locales/i18n';
import { Play, MessageSquare, Code2, Trash2, Edit3, RotateCcw } from 'lucide-react';

interface ApiKeyTableProps {
  keys: ApiKeyRecord[];
  onTest: (key: ApiKeyRecord) => void;
  onOpenChat: (key: ApiKeyRecord) => void;
  onOpenConfig: (key: ApiKeyRecord) => void;
  onEdit: (key: ApiKeyRecord) => void;
  onDelete: (key: ApiKeyRecord) => void;
  onMarkUntested?: (key: ApiKeyRecord) => void;
}

export const ApiKeyTable: React.FC<ApiKeyTableProps> = ({
  keys,
  onTest,
  onOpenChat,
  onOpenConfig,
  onEdit,
  onDelete,
  onMarkUntested,
}) => {
  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-zinc-800/80 bg-zinc-900/90 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
            <th className="py-3 px-4">{t('keys.provider')}</th>
            <th className="py-3 px-4">{t('keys.label')}</th>
            <th className="py-3 px-4">{t('keys.key')}</th>
            <th className="py-3 px-4">{t('keys.workingModel')}</th>
            <th className="py-3 px-4">{t('keys.status')}</th>
            <th className="py-3 px-4">{t('keys.latency')}</th>
            <th className="py-3 px-4">{t('keys.lastTested')}</th>
            <th className="py-3 px-4 text-right">{t('keys.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60 text-xs text-zinc-300">
          {keys.map(k => {
            const workingModel = k.lastKnownGood?.model || k.selectedModel || '—';
            const latency = k.lastKnownGood?.latencyMs;

            return (
              <tr
                key={k.id}
                className="hover:bg-zinc-800/40 transition-colors group"
              >
                {/* Provider */}
                <td className="py-3.5 px-4 font-medium text-zinc-200">
                  <span className="uppercase text-[11px] font-bold text-zinc-400 tracking-wide block">
                    {k.providerId}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    <BidiToken monospace>{k.boundHost}</BidiToken>
                  </span>
                </td>

                {/* Label */}
                <td className="py-3.5 px-4 font-medium text-zinc-100">
                  {k.label}
                  {k.isDemo && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[10px] font-bold">
                      {t('keys.demoBadge')}
                    </span>
                  )}
                </td>

                {/* Masked Key */}
                <td className="py-3.5 px-4">
                  <MaskedKeyDisplay keyId={k.id} maskedKey={k.maskedKey} />
                </td>

                {/* Working Model + Tier Badge */}
                <td className="py-3.5 px-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-zinc-200 text-xs">
                      <BidiToken>{workingModel}</BidiToken>
                    </span>
                    {k.lastKnownGood?.modelTier && (
                      <div>
                        <TierBadge tier={k.lastKnownGood.modelTier} size="sm" />
                      </div>
                    )}
                  </div>
                </td>

                {/* Status Badge */}
                <td className="py-3.5 px-4">
                  <StatusBadge status={k.status} size="sm" />
                </td>

                {/* Latency */}
                <td className="py-3.5 px-4 font-mono text-zinc-400">
                  {latency ? (
                    <BidiToken className={latency < 1000 ? 'text-emerald-400' : latency < 3000 ? 'text-blue-400' : 'text-amber-400'}>
                      {latency} ms
                    </BidiToken>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>

                {/* Last Tested */}
                <td className="py-3.5 px-4 text-zinc-500 text-[11px]">
                  {k.lastTestedAt ? (
                    <BidiToken monospace={false}>
                      {new Date(k.lastTestedAt).toLocaleDateString()} {new Date(k.lastTestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </BidiToken>
                  ) : (
                    '—'
                  )}
                </td>

                {/* Actions */}
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Test Key CTA */}
                    <button
                      type="button"
                      onClick={() => onTest(k)}
                      title={t('keys.testKey')}
                      className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Play size={14} className="text-blue-400" />
                    </button>

                    {/* Chat CTA (only enabled if working or previously working) */}
                    <button
                      type="button"
                      onClick={() => onOpenChat(k)}
                      title={t('keys.openChat')}
                      disabled={k.status !== 'working' && !k.lastKnownGood}
                      className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-800 disabled:opacity-30 disabled:pointer-events-none rounded-lg transition-colors cursor-pointer"
                    >
                      <MessageSquare size={14} className="text-emerald-400" />
                    </button>

                    {/* Copy Config */}
                    <button
                      type="button"
                      onClick={() => onOpenConfig(k)}
                      title={t('keys.copyConfig')}
                      className="p-1.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Code2 size={14} className="text-purple-400" />
                    </button>

                    {/* Edit Key */}
                    <button
                      type="button"
                      onClick={() => onEdit(k)}
                      title={t('keys.editKey')}
                      className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <Edit3 size={14} />
                    </button>

                    {/* Mark as untested */}
                    {onMarkUntested && k.status !== 'untested' && (
                      <button
                        type="button"
                        onClick={() => onMarkUntested(k)}
                        title={t('keys.markUntested')}
                        className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <RotateCcw size={14} />
                      </button>
                    )}

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => onDelete(k)}
                      title={t('keys.deleteKey')}
                      className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
