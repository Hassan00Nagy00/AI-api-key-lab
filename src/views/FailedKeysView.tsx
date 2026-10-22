import React from 'react';
import { ApiKeyRecord } from '../types/key';
import { TestResult } from '../types/test';
import { DiagnosticsService } from '../services/diagnosticsService';
import { StatusBadge } from '../components/common/StatusBadge';
import { MaskedKeyDisplay } from '../components/keys/MaskedKeyDisplay';
import { BidiToken } from '../components/common/BidiToken';
import { EmptyState } from '../components/common/EmptyState';
import { t } from '../locales/i18n';
import { XCircle, RefreshCw, Edit3, HelpCircle, AlertTriangle } from 'lucide-react';

interface FailedKeysViewProps {
  keys: ApiKeyRecord[];
  history: TestResult[];
  onTestKey: (key: ApiKeyRecord) => void;
  onEditKey: (key: ApiKeyRecord) => void;
}

export const FailedKeysView: React.FC<FailedKeysViewProps> = ({
  keys,
  history,
  onTestKey,
  onEditKey,
}) => {
  const failedKeys = keys.filter(
    k =>
      k.status === 'unauthorized' ||
      k.status === 'forbidden' ||
      k.status === 'no-credit' ||
      k.status === 'config-error' ||
      k.status === 'provider-unavailable' ||
      k.status === 'no-usable-model' ||
      k.status === 'blocked-or-network' ||
      k.status === 'network-error'
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <XCircle size={20} className="text-rose-400" />
          <span>{t('nav.failedTests')}</span>
          <span className="text-xs font-mono text-zinc-500 font-normal">
            ({failedKeys.length})
          </span>
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Detailed failure diagnosis, root-cause analysis, and recommended remediation for each non-working key.
        </p>
      </div>

      {failedKeys.length === 0 ? (
        <EmptyState
          icon={XCircle}
          title={t('keys.noFailedKeys')}
          description={t('keys.noFailedKeysDesc')}
        />
      ) : (
        <div className="space-y-4">
          {failedKeys.map(k => {
            const lastTest = history.find(h => h.keyId === k.id);
            const diag = DiagnosticsService.getDiagnostic(
              lastTest?.errorCategory || 'unknown',
              k.status,
              lastTest?.httpStatus
            );

            return (
              <div
                key={k.id}
                className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-4"
              >
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-800/80">
                  <div className="flex items-center gap-3">
                    <StatusBadge status={k.status} />
                    <div>
                      <span className="font-semibold text-zinc-100 text-sm">{k.label}</span>
                      <span className="text-xs text-zinc-500 font-mono ml-2 uppercase">
                        [{k.providerId}]
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <MaskedKeyDisplay keyId={k.id} maskedKey={k.maskedKey} />
                    <button
                      type="button"
                      onClick={() => onTestKey(k)}
                      title={t('keys.retestKey')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      <span>{t('keys.retestKey')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditKey(k)}
                      title={t('keys.editKey')}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
                    >
                      <Edit3 size={14} />
                    </button>
                  </div>
                </div>

                {/* Diagnostic Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  {/* Causes */}
                  <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 space-y-2">
                    <div className="flex items-center gap-1.5 text-zinc-300 font-semibold">
                      <HelpCircle size={14} className="text-amber-400" />
                      <span>{t('diagnostics.possibleCauses')}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px] leading-relaxed">
                      {diag.possibleCauses.map((cause, idx) => (
                        <li key={idx}>{cause}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Remediation */}
                  <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 space-y-2">
                    <div className="flex items-center gap-1.5 text-zinc-300 font-semibold">
                      <AlertTriangle size={14} className="text-blue-400" />
                      <span>{t('diagnostics.recommendedActions')}</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px] leading-relaxed">
                      {diag.recommendedActions.map((act, idx) => (
                        <li key={idx}>{act}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Raw technical error banner */}
                {lastTest?.errorMessage && (
                  <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800/80 text-[11px] font-mono text-rose-300 overflow-x-auto" dir="ltr">
                    <span className="text-zinc-500">Error: </span>
                    <BidiToken monospace>{lastTest.errorMessage}</BidiToken>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
