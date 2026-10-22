import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { ProviderConfig } from '../../types/provider';
import { ProviderRegistry } from '../../services/providerRegistry';
import { ProviderDetector } from '../../services/providerDetector';
import { t } from '../../locales/i18n';
import { ShieldCheck, ChevronDown, ChevronUp, ExternalLink, Sparkles, AlertCircle, Calendar } from 'lucide-react';
import { BidiToken } from '../common/BidiToken';

interface AddKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProviderId?: string;
  onAddKey: (params: {
    label: string;
    providerId: string;
    secret: string;
    customBaseUrl?: string;
    selectedModel?: string;
    expiresAt?: string;
    expiryNote?: string;
  }) => Promise<void>;
  onTestImmediately?: (keyId: string) => void;
}

export const AddKeyModal: React.FC<AddKeyModalProps> = ({
  isOpen,
  onClose,
  initialProviderId,
  onAddKey,
}) => {
  const providers = ProviderRegistry.getAll();
  const [selectedProviderId, setSelectedProviderId] = useState<string>(initialProviderId || 'google-gemini');
  const [userManuallySelected, setUserManuallySelected] = useState<boolean>(Boolean(initialProviderId));
  const [label, setLabel] = useState('');
  const [secret, setSecret] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [expiryNote, setExpiryNote] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialProviderId) {
      const found = providers.find((p) => p.id === initialProviderId);
      if (found) {
        setSelectedProviderId(found.id);
        setUserManuallySelected(true);
        setLabel(found.name);
        setSelectedModel(found.models?.[0]?.id || '');
      }
    }
  }, [isOpen, initialProviderId]);

  const selectedProvider = providers.find(p => p.id === selectedProviderId) || providers[0];
  const suggestion = useMemo(() => ProviderDetector.detect(secret, providers), [secret, providers]);

  const filteredProviders = providers.filter(
    p =>
      p.name.toLowerCase().includes(providerSearch.toLowerCase()) ||
      p.id.toLowerCase().includes(providerSearch.toLowerCase())
  );

  const handleProviderSelect = (p: ProviderConfig) => {
    setSelectedProviderId(p.id);
    setUserManuallySelected(true);
    if (!label || label === selectedProvider?.name) {
      setLabel(p.name);
    }
    setCustomBaseUrl('');
    setSelectedModel(p.models?.[0]?.id || '');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim()) {
      setError('API Key is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      await onAddKey({
        label: label.trim() || selectedProvider.name,
        providerId: selectedProvider.id,
        secret: secret.trim(),
        customBaseUrl: customBaseUrl.trim() || undefined,
        selectedModel: selectedModel.trim() || undefined,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.000Z`).toISOString() : undefined,
        expiryNote: expiryNote.trim() || undefined,
      });

      // Reset form
      setSecret('');
      setLabel('');
      setExpiresAt('');
      setExpiryNote('');
      setUserManuallySelected(false);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add API key');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('nav.addKey')}
      description="Connect an AI provider and enter your API credential."
      maxWidth="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Security Notice per §5 */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
          <ShieldCheck size={18} className="shrink-0 mt-0.5 text-blue-400" />
          <p>{t('app.securityNotice')}</p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Provider Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-zinc-300">
            {t('keys.provider')}
          </label>
          <div className="flex items-center gap-2 mb-2">
            <input
              type="text"
              value={providerSearch}
              onChange={e => setProviderSearch(e.target.value)}
              placeholder="Search provider (Gemini, Groq, OpenRouter...)"
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-1 bg-zinc-950/60 rounded-xl border border-zinc-800/80">
            {filteredProviders.map(p => {
              const isSelected = p.id === selectedProviderId;
              const hasFree = p.freeTier?.type === 'permanent' || p.freeTier?.type === 'renewable';

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleProviderSelect(p)}
                  className={`flex flex-col text-left p-2.5 rounded-lg border text-xs transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600/15 border-blue-500 text-white font-medium'
                      : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:bg-zinc-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="truncate font-semibold">{p.name}</span>
                    {hasFree && (
                      <Sparkles size={11} className="text-emerald-400 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    <BidiToken monospace>{p.protocol.replace('-compatible', '')}</BidiToken>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Provider Info Banner */}
        {selectedProvider && (
          <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-200">{selectedProvider.name}</span>
              {selectedProvider.keyUrl && (
                <a
                  href={selectedProvider.keyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                >
                  <span>{t('providers.getKey')}</span>
                  <ExternalLink size={11} />
                </a>
              )}
            </div>
            {selectedProvider.description && (
              <p className="text-[11px] text-zinc-400">{selectedProvider.description}</p>
            )}
            {selectedProvider.baseUrl && (
              <div className="text-[11px] text-zinc-500 font-mono pt-1">
                Base URL: <BidiToken>{selectedProvider.baseUrl}</BidiToken>
              </div>
            )}
          </div>
        )}

        {/* Label & Secret Key Input */}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              {t('keys.label')}
            </label>
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Personal Gemini, Groq Prod"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              {t('keys.key')} <span className="text-rose-400">*</span>
            </label>
            <input
              type="password"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="Paste secret API key (e.g. AIzaSy... or gsk_...)"
              autoComplete="off"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
            />

            {/* Non-binding Key-Format Provider Suggestion (§13A) */}
            {suggestion.suggestionText && suggestion.candidates.length > 0 && (
              <div
                data-testid="provider-suggestion-banner"
                className="mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300"
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-emerald-400 shrink-0" />
                  <span>{suggestion.suggestionText}</span>
                </div>
                {suggestion.candidates[0].provider.id !== selectedProviderId ? (
                  <button
                    type="button"
                    onClick={() => handleProviderSelect(suggestion.candidates[0].provider)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 font-semibold transition-colors cursor-pointer"
                  >
                    Switch to {suggestion.candidates[0].provider.name}
                  </button>
                ) : (
                  !userManuallySelected && (
                    <span className="text-[11px] text-emerald-400/80 font-mono">Matched</span>
                  )
                )}
              </div>
            )}

            <p className="text-[11px] text-zinc-500 mt-1">
              Keys are stored locally in your browser vault and bound to the provider host.
            </p>
          </div>
        </div>

        {/* Collapsible Advanced Options */}
        <div className="border-t border-zinc-800/80 pt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <span>Advanced Configuration (Custom URL / Model / Expiry)</span>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3 p-3 bg-zinc-950/70 rounded-xl border border-zinc-800/80">
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Custom Base URL
                </label>
                <input
                  type="text"
                  value={customBaseUrl}
                  onChange={e => setCustomBaseUrl(e.target.value)}
                  placeholder={selectedProvider.baseUrl || 'https://...'}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                  Preferred / Custom Model ID
                </label>
                <input
                  type="text"
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  placeholder={selectedProvider.models?.[0]?.id || 'e.g. llama-3.3-70b-versatile'}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1 flex items-center gap-1">
                    <Calendar size={12} />
                    <span>Expiry Date (User-Declared)</span>
                  </label>
                  <input
                    type="date"
                    value={expiresAt}
                    onChange={e => setExpiresAt(e.target.value)}
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-zinc-400 mb-1">
                    Rotation / Expiry Note
                  </label>
                  <input
                    type="text"
                    value={expiryNote}
                    onChange={e => setExpiryNote(e.target.value)}
                    placeholder="e.g. Rotate every 90 days"
                    className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Submit Buttons */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !secret.trim()}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-md shadow-blue-500/20 cursor-pointer"
          >
            {isSubmitting ? t('common.loading') : t('keys.testKey') + ' & ' + t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
};
