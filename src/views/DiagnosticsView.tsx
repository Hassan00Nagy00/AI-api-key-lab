import React, { useState } from 'react';
import { DiagnosticsService } from '../services/diagnosticsService';
import { DiagnosticsBundleService } from '../services/diagnosticsBundleService';
import { QuotaSnapshotService } from '../services/modelWatchAndQuota';
import { StorageService } from '../services/storage';
import { ErrorCategory } from '../types/test';
import { t } from '../locales/i18n';
import {
  Stethoscope,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  HelpCircle,
  Download,
  FileText,
  Gauge,
} from 'lucide-react';

export const DiagnosticsView: React.FC = () => {
  const [expandedCategory, setExpandedCategory] = useState<string | null>('cors-or-network');
  const [bundlePreview, setBundlePreview] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const keys = StorageService.getKeys();
  const quotaSnapshots = QuotaSnapshotService.getSnapshots();

  const categories: ErrorCategory[] = [
    'cors-or-network',
    'auth',
    'forbidden',
    'insufficient-credit',
    'rate-limit',
    'model-not-found',
    'endpoint-not-found',
    'server-error',
    'bad-request',
    'timeout',
  ];

  const handleExportBundle = (format: 'json' | 'txt') => {
    setIsExporting(true);
    try {
      const { json, text } = DiagnosticsBundleService.generateBundle();
      const content = format === 'json' ? json : text;
      setBundlePreview(content);

      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ai-key-lab-diagnostics-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <Stethoscope size={20} className="text-teal-400" />
            <span>{t('diagnostics.title')}</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {t('diagnostics.subtitle')}
          </p>
        </div>

        {/* One-Click Redacted Diagnostics Bundle (§13A) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isExporting}
            onClick={() => handleExportBundle('json')}
            data-testid="export-diagnostics-json-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <Download size={14} />
            <span>Export Redacted JSON</span>
          </button>
          <button
            type="button"
            disabled={isExporting}
            onClick={() => handleExportBundle('txt')}
            data-testid="export-diagnostics-txt-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <FileText size={14} />
            <span>Export Text Report</span>
          </button>
        </div>
      </div>

      {bundlePreview && (
        <div className="p-4 rounded-2xl border border-teal-500/30 bg-zinc-950 space-y-2">
          <div className="flex items-center justify-between text-xs text-teal-300 font-semibold">
            <span>Redacted Diagnostics Bundle Preview (Zero Secrets / Custom Hosts Hashed)</span>
            <button
              type="button"
              onClick={() => setBundlePreview(null)}
              className="text-zinc-400 hover:text-zinc-200"
            >
              Close Preview
            </button>
          </div>
          <pre className="max-h-56 overflow-y-auto p-3 rounded-xl bg-zinc-900 text-[11px] font-mono text-zinc-300 whitespace-pre-wrap">
            {bundlePreview}
          </pre>
        </div>
      )}

      {/* Quota & Rate-Limit Header Snapshots (§13A) */}
      <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Gauge size={16} className="text-blue-400" />
          <span>Provider Quota & Rate-Limit Header Snapshots</span>
        </div>
        {keys.length === 0 ? (
          <p className="text-xs text-zinc-500">No keys configured yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {keys.map(k => {
              const snap = quotaSnapshots.find(s => s.keyId === k.id);
              const statusText = QuotaSnapshotService.formatQuotaStatus(snap);
              return (
                <div
                  key={k.id}
                  className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 text-xs flex items-center justify-between gap-2"
                >
                  <div>
                    <span className="font-semibold text-zinc-200">{k.label}</span>
                    <span className="ml-1.5 text-[10px] font-mono uppercase text-zinc-500">
                      ({k.providerId})
                    </span>
                  </div>
                  <div className="text-right font-mono text-[11px]">
                    <span className={!snap || !snap.hasHeaders ? 'text-zinc-500' : 'text-emerald-400'}>
                      {statusText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Prominent CORS Browser Honesty Notice per §6 */}
      <div className="p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 space-y-2">
        <div className="flex items-center gap-2 font-semibold text-cyan-300">
          <ShieldAlert size={16} className="shrink-0" />
          <span>Browser Execution & CORS Boundaries</span>
        </div>
        <p className="leading-relaxed text-[11px] text-cyan-100/90">
          {t('diagnostics.browserLimitationNotice')}
        </p>
      </div>

      {/* Categories Accordion */}
      <div className="space-y-3">
        {categories.map(cat => {
          const diag = DiagnosticsService.getDiagnostic(cat, 'unknown-error');
          const isExpanded = expandedCategory === cat;

          return (
            <div
              key={cat}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden transition-colors"
            >
              <button
                type="button"
                onClick={() => setExpandedCategory(isExpanded ? null : cat)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-zinc-800/40 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      cat === 'auth' || cat === 'forbidden'
                        ? 'bg-rose-500'
                        : cat === 'rate-limit'
                        ? 'bg-amber-500'
                        : cat === 'cors-or-network'
                        ? 'bg-cyan-400'
                        : 'bg-zinc-500'
                    }`}
                  />
                  <div>
                    <span className="font-semibold text-zinc-100 text-xs block">{diag.title}</span>
                    <span className="text-[11px] text-zinc-400 font-mono">Category: {cat}</span>
                  </div>
                </div>

                <div className="text-zinc-500">
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </div>
              </button>

              {isExpanded && (
                <div className="p-4 pt-1 border-t border-zinc-800/80 space-y-4 text-xs bg-zinc-950/40">
                  <p className="text-zinc-300 leading-relaxed">{diag.explanation}</p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800/80 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-zinc-200 font-semibold text-[11px]">
                        <HelpCircle size={13} className="text-amber-400" />
                        <span>{t('diagnostics.possibleCauses')}</span>
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px]">
                        {diag.possibleCauses.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="p-3 bg-zinc-900/80 rounded-xl border border-zinc-800/80 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-zinc-200 font-semibold text-[11px]">
                        <AlertCircle size={13} className="text-blue-400" />
                        <span>{t('diagnostics.recommendedActions')}</span>
                      </div>
                      <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px]">
                        {diag.recommendedActions.map((a, i) => (
                          <li key={i}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
