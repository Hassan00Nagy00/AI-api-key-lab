import React, { useState } from 'react';
import { TestResult } from '../types/test';
import { StatusBadge } from '../components/common/StatusBadge';
import { TierBadge } from '../components/common/TierBadge';
import { BidiToken } from '../components/common/BidiToken';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { StorageService } from '../services/storage';
import { t } from '../locales/i18n';
import { History, Trash2, CheckCircle2, Clock } from 'lucide-react';

interface HistoryViewProps {
  history: TestResult[];
  onRefresh: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ history, onRefresh }) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const total = history.length;
  const workingCount = history.filter(h => h.status === 'working').length;
  const successRate = total > 0 ? Math.round((workingCount / total) * 100) : 0;

  const totalLatency = history.reduce((acc, h) => acc + h.latencyMs, 0);
  const avgLatency = total > 0 ? Math.round(totalLatency / total) : 0;

  const handleClearHistory = () => {
    StorageService.clearHistory();
    onRefresh();
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <History size={20} className="text-blue-400" />
            <span>{t('history.title')}</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {t('history.subtitle')}
          </p>
        </div>

        {total > 0 && (
          <button
            type="button"
            onClick={() => setShowClearConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-rose-300 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl transition-colors cursor-pointer self-start sm:self-auto"
          >
            <Trash2 size={13} />
            <span>{t('history.clear')}</span>
          </button>
        )}
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">{t('history.totalTests')}</span>
            <span className="text-2xl font-bold font-mono text-zinc-100">
              <BidiToken>{total}</BidiToken>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-zinc-800 text-zinc-400">
            <History size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">{t('history.successRate')}</span>
            <span className="text-2xl font-bold font-mono text-emerald-400">
              <BidiToken>{successRate}%</BidiToken>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400">
            <CheckCircle2 size={18} />
          </div>
        </div>

        <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
          <div>
            <span className="text-xs text-zinc-400 block mb-0.5">{t('history.avgLatency')}</span>
            <span className="text-2xl font-bold font-mono text-blue-400">
              <BidiToken>{avgLatency} ms</BidiToken>
            </span>
          </div>
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400">
            <Clock size={18} />
          </div>
        </div>
      </div>

      {/* History Table */}
      {total === 0 ? (
        <div className="p-12 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
          {t('history.noHistory')}
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-900/90 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <th className="py-3 px-4">{t('keys.provider')}</th>
                <th className="py-3 px-4">{t('models.model')}</th>
                <th className="py-3 px-4">{t('keys.status')}</th>
                <th className="py-3 px-4">{t('keys.latency')}</th>
                <th className="py-3 px-4">HTTP</th>
                <th className="py-3 px-4">Date & Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-xs text-zinc-300">
              {history.map(item => (
                <tr key={item.id} className="hover:bg-zinc-800/40 transition-colors">
                  <td className="py-3.5 px-4 font-bold text-zinc-200 uppercase">
                    {item.providerId}
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-300">
                    <BidiToken>{item.model}</BidiToken>
                    {item.modelTier && (
                      <div className="mt-0.5">
                        <TierBadge tier={item.modelTier} evidence={item.tierEvidence} size="sm" />
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4">
                    <StatusBadge status={item.status} size="sm" />
                  </td>
                  <td className="py-3.5 px-4 font-mono text-xs">
                    <BidiToken
                      className={
                        item.latencyMs < 1000
                          ? 'text-emerald-400 font-bold'
                          : item.latencyMs < 3000
                          ? 'text-blue-400 font-bold'
                          : 'text-amber-400 font-bold'
                      }
                    >
                      {item.latencyMs} ms
                    </BidiToken>
                  </td>
                  <td className="py-3.5 px-4 font-mono text-zinc-400 text-xs">
                    {item.httpStatus || '—'}
                  </td>
                  <td className="py-3.5 px-4 text-[11px] text-zinc-400 font-mono">
                    <BidiToken monospace={false}>
                      {new Date(item.testedAt).toLocaleDateString()} {new Date(item.testedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </BidiToken>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        onConfirm={handleClearHistory}
        title="Clear All Test History?"
        description="This will permanently delete all recorded API test audit logs."
        itemsToRemove={['All test logs', 'Latency records', 'Status observations']}
        confirmLabel="Clear History"
      />
    </div>
  );
};
