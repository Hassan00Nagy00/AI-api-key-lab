import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { ApiKeyRecord } from '../../types/key';
import { ProviderRegistry } from '../../services/providerRegistry';
import { StorageService } from '../../services/storage';
import { ConfigGenerator, GeneratedConfig } from '../../services/configGenerator';
import { CodeBlock } from '../common/CodeBlock';
import { t } from '../../locales/i18n';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';

interface ConfigurationGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: ApiKeyRecord | null;
}

export const ConfigurationGeneratorModal: React.FC<ConfigurationGeneratorModalProps> = ({
  isOpen,
  onClose,
  apiKey,
}) => {
  const [includeSecret, setIncludeSecret] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('python-openai');

  if (!apiKey) return null;

  const provider = ProviderRegistry.get(apiKey.providerId);
  if (!provider) return null;

  const modelId = apiKey.lastKnownGood?.model || apiKey.selectedModel || provider.models?.[0]?.id || 'gpt-4o-mini';

  const rawSecret = includeSecret ? StorageService.getSecret(apiKey.id) || undefined : undefined;
  const configs: GeneratedConfig[] = ConfigGenerator.generateAll(apiKey, provider, modelId, rawSecret);
  const currentConfig = configs.find(c => c.id === activeTab) || configs[0];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('keys.copyConfig')} — ${apiKey.label}`}
      description="Ready-to-use SDK snippets and integration configuration for your code."
      maxWidth="xl"
    >
      <div className="space-y-4">
        {/* Key visibility toggle */}
        <div className="flex items-center justify-between p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl text-xs">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="text-zinc-400">Secret key in snippet:</span>
            <span className="font-semibold">{includeSecret ? 'Included' : 'Placeholder (YOUR_API_KEY_HERE)'}</span>
          </div>

          <button
            type="button"
            onClick={() => setIncludeSecret(!includeSecret)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              includeSecret
                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {includeSecret ? <EyeOff size={13} /> : <Eye size={13} />}
            <span>{includeSecret ? 'Use Placeholder' : 'Reveal Secret in Snippet'}</span>
          </button>
        </div>

        {includeSecret && (
          <div className="flex items-center gap-2 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-300">
            <ShieldAlert size={14} className="shrink-0" />
            <span>Warning: Do not commit generated snippets containing raw secrets to git repositories.</span>
          </div>
        )}

        {/* Tab selection */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-zinc-800">
          {configs.map(cfg => (
            <button
              key={cfg.id}
              type="button"
              onClick={() => setActiveTab(cfg.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === cfg.id
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {cfg.title}
            </button>
          ))}
        </div>

        {/* Code Block */}
        {currentConfig && (
          <CodeBlock
            code={currentConfig.code}
            language={currentConfig.language}
            title={currentConfig.title}
          />
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800 rounded-xl cursor-pointer"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
