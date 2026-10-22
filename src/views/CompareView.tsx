import React from 'react';
import { TestResult } from '../types/test';
import { ObservedService } from '../services/observedService';
import { TierBadge } from '../components/common/TierBadge';
import { BidiToken } from '../components/common/BidiToken';
import { EmptyState } from '../components/common/EmptyState';
import { t } from '../locales/i18n';
import { Scale, CheckCircle2 } from 'lucide-react';

interface CompareViewProps {
  history: TestResult[];
}

export const CompareView: React.FC<CompareViewProps> = ({ history }) => {
  const observations = ObservedService.getObservations();

  // Filter only models that have at least one observed working result
  const workingObservations = Array.from(observations.values()).filter(o => o.successCount > 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <Scale size={20} className="text-indigo-400" />
          <span>{t('compare.title')}</span>
          <span className="text-xs font-mono text-zinc-500 font-normal">
            ({workingObservations.length} models)
          </span>
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          {t('compare.subtitle')}
        </p>
      </div>

      {workingObservations.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No Observed Working Models"
          description={t('compare.empty')}
        />
      ) : (
        <div className="w-full overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-800/80 bg-zinc-900/90 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                <th className="py-3 px-4">{t('compare.provider')}</th>
                <th className="py-3 px-4">{t('compare.model')}</th>
                <th className="py-3 px-4">{t('compare.freeTier')}</th>
                <th className="py-3 px-4">{t('compare.latency')}</th>
                <th className="py-3 px-4">{t('compare.status')}</th>
                <th className="py-3 px-4">Last Working</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-xs text-zinc-300">
              {workingObservations.map(obs => {
                const sampleTest = history.find(
                  h => h.providerId === obs.providerId && h.model === obs.modelId && h.status === 'working'
                );

                return (
                  <tr key={`${obs.providerId}:::${obs.modelId}`} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-zinc-200 uppercase">
                      {obs.providerId}
                    </td>

                    <td className="py-3.5 px-4 font-mono font-medium text-zinc-100">
                      <BidiToken>{obs.modelId}</BidiToken>
                    </td>

                    <td className="py-3.5 px-4">
                      {sampleTest?.modelTier ? (
                        <TierBadge tier={sampleTest.modelTier} evidence={sampleTest.tierEvidence} size="sm" />
                      ) : (
                        <span className="text-zinc-500">—</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs">
                      <BidiToken
                        className={
                          obs.medianLatencyMs < 1000
                            ? 'text-emerald-400 font-bold'
                            : obs.medianLatencyMs < 3000
                            ? 'text-blue-400 font-bold'
                            : 'text-amber-400 font-bold'
                        }
                      >
                        {obs.medianLatencyMs} ms
                      </BidiToken>
                      <span className="text-[10px] text-zinc-500 block">median</span>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                        <CheckCircle2 size={13} />
                        <span>{obs.successRate}% ({obs.successCount}/{obs.testCount})</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-[11px] text-zinc-400 font-mono">
                      {obs.lastWorkingAt ? (
                        <BidiToken monospace={false}>
                          {new Date(obs.lastWorkingAt).toLocaleDateString()} {new Date(obs.lastWorkingAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </BidiToken>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
