import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { ApiKeyRecord } from '../../types/key';
import { ProviderRegistry } from '../../services/providerRegistry';
import { t } from '../../locales/i18n';
import { AlertTriangle, Key, Calendar } from 'lucide-react';
import { BidiToken } from '../common/BidiToken';

interface EditKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKeyRecord | null;
  onSave: (key: ApiKeyRecord, newSecret?: string) => Promise<void>;
}

export const EditKeyModal: React.FC<EditKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onSave,
}) => {
  const [label, setLabel] = useState(apiKey?.label || '');
  const [customBaseUrl, setCustomBaseUrl] = useState(apiKey?.customBaseUrl || '');
  const [selectedModel, setSelectedModel] = useState(apiKey?.selectedModel || '');
  const [expiresAt, setExpiresAt] = useState(apiKey?.expiresAt ? apiKey.expiresAt.slice(0, 10) : '');
  const [expiryNote, setExpiryNote] = useState(apiKey?.expiryNote || '');
  const [newSecret, setNewSecret] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (apiKey) {
      setLabel(apiKey.label);
      setCustomBaseUrl(apiKey.customBaseUrl || '');
      setSelectedModel(apiKey.selectedModel || '');
      setExpiresAt(apiKey.expiresAt ? apiKey.expiresAt.slice(0, 10) : '');
      setExpiryNote(apiKey.expiryNote || '');
      setNewSecret('');
    }
  }, [apiKey]);

  if (!apiKey) return null;

  const provider = ProviderRegistry.get(apiKey.providerId);

  // Check if base URL host changed
  let hasHostChanged = false;
  if (customBaseUrl) {
    try {
      const parsed = new URL(customBaseUrl);
      if (parsed.hostname.toLowerCase() !== apiKey.boundHost.toLowerCase()) {
        hasHostChanged = true;
      }
    } catch {
      // ignore
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      let boundHost = apiKey.boundHost;
      if (customBaseUrl) {
        try {
          boundHost = new URL(customBaseUrl).hostname;
        } catch {
          // ignore
        }
      }

      const updatedKey: ApiKeyRecord = {
        ...apiKey,
        label: label.trim() || apiKey.label,
        customBaseUrl: customBaseUrl.trim() || undefined,
        selectedModel: selectedModel.trim() || undefined,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.000Z`).toISOString() : undefined,
        expiryNote: expiryNote.trim() || undefined,
        boundHost,
        // Host change resets to untested per §6
        status: hasHostChanged ? 'untested' : apiKey.status,
        authVerified: hasHostChanged ? 'unknown' : apiKey.authVerified,
      };

      await onSave(updatedKey, newSecret.trim() || undefined);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('keys.editKey')} maxWidth="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Host Change Warning per §6 */}
        {hasHostChanged && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">{t('keys.hostChangeWarning')}</p>
              <p className="text-[11px] text-zinc-400 mt-1">
                Old host: <BidiToken>{apiKey.boundHost}</BidiToken> → New host:{' '}
                <BidiToken>{new URL(customBaseUrl).hostname}</BidiToken>
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">
            {t('keys.label')}
          </label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">
            Custom Base URL
          </label>
          <input
            type="text"
            value={customBaseUrl}
            onChange={e => setCustomBaseUrl(e.target.value)}
            placeholder={provider?.baseUrl || 'https://...'}
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1">
            Preferred Model
          </label>
          <input
            type="text"
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
            placeholder="e.g. gemini-2.5-flash or llama-3.3-70b"
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Expiry & Rotation Metadata (§13A) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1">
              <Calendar size={13} className="text-zinc-500" />
              <span>Expiry Date (User-Declared)</span>
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1">
              Expiry / Rotation Note
            </label>
            <input
              type="text"
              value={expiryNote}
              onChange={e => setExpiryNote(e.target.value)}
              placeholder="e.g. Rotate every 90 days"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-300 mb-1 flex items-center gap-1.5">
            <Key size={13} className="text-zinc-500" />
            <span>Replace Secret Key (Leave blank to keep existing key)</span>
          </label>
          <input
            type="password"
            value={newSecret}
            onChange={e => setNewSecret(e.target.value)}
            placeholder="Paste replacement API key..."
            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            Current key: <BidiToken>{apiKey.maskedKey}</BidiToken>
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 rounded-xl transition-colors cursor-pointer"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors cursor-pointer shadow-sm shadow-blue-500/20"
          >
            {isSubmitting ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
};
