import React from 'react';
import { Modal } from '../common/Modal';
import { TestLadderStage, TestResult } from '../../types/test';
import { t } from '../../locales/i18n';
import { StatusBadge } from '../common/StatusBadge';
import { TierBadge } from '../common/TierBadge';
import { BidiToken } from '../common/BidiToken';
import { Check, Loader2, AlertCircle, MessageSquare, Code2, RefreshCw } from 'lucide-react';

interface TestProgressModalProps {
  isOpen: boolean;
  stage: TestLadderStage;
  stageMessage: string;
  activeModel?: string;
  isFallback?: boolean;
  result: TestResult | null;
  onClose: () => void;
  onOpenChat?: (result: TestResult) => void;
  onOpenConfig?: (result: TestResult) => void;
  onRetest?: () => void;
}

export const TestProgressModal: React.FC<TestProgressModalProps> = ({
  isOpen,
  stage,
  stageMessage,
  activeModel,
  isFallback,
  result,
  onClose,
  onOpenChat,
  onOpenConfig,
  onRetest,
}) => {
  const isTesting = stage !== 'completed' && stage !== 'failed' && !result;

  const stagesList: Array<{ id: TestLadderStage; label: string }> = [
    { id: 'detecting-provider', label: t('test.detecting') },
    { id: 'listing-models', label: t('test.listing') },
    { id: 'selecting-model', label: t('test.selecting') },
    { id: 'sending-prompt', label: t('test.sending') },
    { id: 'validating-response', label: t('test.validating') },
  ];

  const currentStageIndex = stagesList.findIndex(s => s.id === stage);

  return (
    <Modal
      isOpen={isOpen}
      onClose={isTesting ? () => {} : onClose}
      title={result ? (result.status === 'working' ? t('test.successTitle') : t('test.failureTitle')) : t('test.title')}
      maxWidth="lg"
    >
      <div className="space-y-6">
        {/* Progress Ladder while testing */}
        {isTesting && (
          <div className="space-y-4 py-2">
            {isFallback && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0" />
                <span>{t('test.fallbackNotice')}</span>
              </div>
            )}

            <div className="space-y-3">
              {stagesList.map((s, idx) => {
                const isPassed = currentStageIndex > idx;
                const isCurrent = currentStageIndex === idx || stage === s.id;

                return (
                  <div key={s.id} className="flex items-center gap-3 text-xs">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isPassed
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          : isCurrent
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/40 animate-pulse'
                          : 'bg-zinc-800 text-zinc-600'
                      }`}
                    >
                      {isPassed ? <Check size={12} /> : isCurrent ? <Loader2 size={12} className="animate-spin" /> : idx + 1}
                    </div>
                    <span
                      className={`${
                        isPassed
                          ? 'text-zinc-300'
                          : isCurrent
                          ? 'text-blue-300 font-medium'
                          : 'text-zinc-500'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 text-[11px] text-zinc-400 font-mono bg-zinc-950/60 p-3 rounded-xl border border-zinc-800">
              <span className="text-zinc-500">{'>'} </span>
              {stageMessage}
              {activeModel && (
                <span className="text-blue-400 ml-1">
                  [<BidiToken>{activeModel}</BidiToken>]
                </span>
              )}
            </div>
          </div>
        )}

        {/* Finished Result Display */}
        {result && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <StatusBadge status={result.status} />
                {result.modelTier && (
                  <TierBadge tier={result.modelTier} evidence={result.tierEvidence} />
                )}
              </div>
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-500">{t('keys.latency')}: </span>
                <BidiToken className={result.latencyMs < 1000 ? 'text-emerald-400 font-bold' : result.latencyMs < 3000 ? 'text-blue-400 font-bold' : 'text-amber-400 font-bold'}>
                  {result.latencyMs} ms
                </BidiToken>
              </div>
            </div>

            {/* Model & Provider info */}
            <div className="grid grid-cols-2 gap-3 p-3 bg-zinc-950/50 rounded-xl border border-zinc-800/80 text-xs">
              <div>
                <span className="text-zinc-500 text-[11px]">{t('keys.provider')}</span>
                <p className="font-medium text-zinc-200 uppercase">{result.providerId}</p>
              </div>
              <div>
                <span className="text-zinc-500 text-[11px]">{t('models.model')}</span>
                <p className="font-mono text-zinc-200">
                  <BidiToken>{result.model}</BidiToken>
                </p>
              </div>
            </div>

            {/* Success generation output */}
            {result.status === 'working' && result.responseSnippet && (
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-zinc-400">Response output ("Hi"):</span>
                <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-xs text-zinc-200 font-mono leading-relaxed" dir="ltr">
                  <BidiToken monospace={false}>{result.responseSnippet}</BidiToken>
                </div>
              </div>
            )}

            {/* Error message if failed */}
            {result.status !== 'working' && (
              <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl space-y-2 text-xs">
                <p className="font-medium text-rose-300">{result.errorMessage || 'Unknown failure'}</p>
                {result.errorDetails && (
                  <pre className="p-2 bg-black/40 rounded border border-rose-500/10 text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap" dir="ltr">
                    {result.errorDetails}
                  </pre>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-3 border-t border-zinc-800">
              {onRetest && (
                <button
                  type="button"
                  onClick={onRetest}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
                >
                  <RefreshCw size={13} />
                  <span>{t('keys.retestKey')}</span>
                </button>
              )}

              {result.status === 'working' && onOpenChat && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenChat(result);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-colors shadow-sm shadow-emerald-500/20 cursor-pointer"
                >
                  <MessageSquare size={13} />
                  <span>{t('test.startChat')}</span>
                </button>
              )}

              {result.status === 'working' && onOpenConfig && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenConfig(result);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  <Code2 size={13} />
                  <span>{t('test.copyCode')}</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
              >
                {t('test.close')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
