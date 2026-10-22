import React, { useState } from 'react';
import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';
import { ProviderRegistry } from '../services/providerRegistry';
import { t } from '../locales/i18n';
import { FlaskConical, Play, CheckCircle2, AlertCircle } from 'lucide-react';
import { StatusBadge } from '../components/common/StatusBadge';

interface ApiTesterViewProps {
  keys: ApiKeyRecord[];
  providers: ProviderConfig[];
  onTestKeyWithModel: (key: ApiKeyRecord, modelId?: string) => void;
  onOpenAddKey: () => void;
}

export const ApiTesterView: React.FC<ApiTesterViewProps> = ({
  keys,
  providers,
  onTestKeyWithModel,
  onOpenAddKey,
}) => {
  const [selectedKeyId, setSelectedKeyId] = useState<string>(keys[0]?.id || '');
  const selectedKey = keys.find(k => k.id === selectedKeyId);
  const selectedProvider = selectedKey ? ProviderRegistry.get(selectedKey.providerId) : null;
  const [customModel, setCustomModel] = useState<string>('');

  const handleRunTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKey) return;
    onTestKeyWithModel(selectedKey, customModel.trim() || undefined);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <FlaskConical size={20} className="text-emerald-400" />
          <span>{t('nav.apiTester')}</span>
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Execute full Tier 0 to Tier 2 verification ladders on any stored API key with specific or fallback models.
        </p>
      </div>

      {keys.length === 0 ? (
        <div className="p-12 text-center text-xs text-zinc-400 border border-dashed border-zinc-800 rounded-2xl space-y-3">
          <p>No API keys configured yet.</p>
          <button
            type="button"
            onClick={onOpenAddKey}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors cursor-pointer"
          >
            Add an API Key to Test
          </button>
        </div>
      ) : (
        <form onSubmit={handleRunTest} className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Select API Key to Test
              </label>
              <select
                value={selectedKeyId}
                onChange={e => setSelectedKeyId(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {keys.map(k => (
                  <option key={k.id} value={k.id}>
                    {k.label} ({k.providerId.toUpperCase()}) — {k.status}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Target Model (Optional — default: ranked auto-selection)
              </label>
              <input
                type="text"
                value={customModel}
                onChange={e => setCustomModel(e.target.value)}
                placeholder="Leave blank for ranked algorithm selection"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {selectedKey && (
            <div className="p-4 bg-zinc-950/70 rounded-xl border border-zinc-800 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">Current Key Status:</span>
                <StatusBadge status={selectedKey.status} size="sm" />
              </div>
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-zinc-500">Bound Host:</span>
                <span className="text-zinc-300">{selectedKey.boundHost}</span>
              </div>
              {selectedKey.lastKnownGood && (
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-zinc-500">Last Working Model:</span>
                  <span className="text-emerald-400">{selectedKey.lastKnownGood.model} ({selectedKey.lastKnownGood.latencyMs}ms)</span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={!selectedKey}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
            >
              <Play size={14} />
              <span>Execute Verification Ladder</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
