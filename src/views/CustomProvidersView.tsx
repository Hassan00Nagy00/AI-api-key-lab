import React, { useState } from 'react';
import { ProviderConfig, GenericRestCustomConfig } from '../types/provider';
import { ProviderRegistry } from '../services/providerRegistry';
import { StorageService } from '../services/storage';
import { t } from '../locales/i18n';
import { SlidersHorizontal, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { BidiToken } from '../components/common/BidiToken';

export const CustomProvidersView: React.FC = () => {
  const [customList, setCustomList] = useState<ProviderConfig[]>(() =>
    StorageService.getCustomProviders()
  );

  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState<'bearer' | 'api-key-header'>('bearer');
  const [headerName, setHeaderName] = useState('x-api-key');
  const [chatEndpoint, setChatEndpoint] = useState('/chat/completions');
  const [modelsEndpoint, setModelsEndpoint] = useState('/models');
  const [httpMethod, setHttpMethod] = useState<'POST' | 'GET'>('POST');
  const [modelField, setModelField] = useState('model');
  const [messageFormat, setMessageFormat] = useState<'openai' | 'simple-text'>('openai');
  const [requestTemplate, setRequestTemplate] = useState('');

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !baseUrl.trim()) {
      setError('Provider name and Base URL are required');
      return;
    }

    let parsedHost = '';
    try {
      const url = new URL(baseUrl.trim());
      parsedHost = url.hostname;
    } catch {
      setError('Base URL must be a valid http or https URL');
      return;
    }

    const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const customConfig: GenericRestCustomConfig = {
      modelsEndpoint: modelsEndpoint.trim() || undefined,
      chatEndpoint: chatEndpoint.trim() || undefined,
      httpMethod,
      modelField: modelField.trim() || 'model',
      messageFormat,
      requestTemplate: requestTemplate.trim() || undefined,
    };

    const newProvider: ProviderConfig = {
      id,
      name: name.trim(),
      description: 'Custom user-defined REST provider endpoint',
      protocol: 'generic-rest',
      baseUrl: baseUrl.trim(),
      allowedHosts: [parsedHost],
      supportsModelListing: Boolean(modelsEndpoint.trim()),
      supportsChat: true,
      supportsStreaming: false,
      authentication: {
        type: authType,
        headerName: authType === 'api-key-header' ? headerName.trim() : undefined,
      },
      source: 'user',
      customConfig,
    };

    ProviderRegistry.registerProvider(newProvider);
    setCustomList(StorageService.getCustomProviders());

    setSavedSuccess(true);
    setError(null);
    setTimeout(() => setSavedSuccess(false), 3000);

    // Reset inputs
    setName('');
    setBaseUrl('');
    setRequestTemplate('');
  };

  const handleDelete = (id: string) => {
    StorageService.deleteCustomProvider(id);
    setCustomList(StorageService.getCustomProviders());
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <SlidersHorizontal size={20} className="text-amber-400" />
          <span>{t('nav.customProviders')}</span>
        </h2>
        <p className="text-xs text-zinc-400 mt-0.5">
          Configure custom or private AI inference endpoints using Generic REST protocol.
        </p>
      </div>

      {/* Builder Form */}
      <div className="p-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-5">
        <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
          <Plus size={16} className="text-blue-400" />
          <span>Define New Custom Provider</span>
        </h3>

        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        {savedSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 size={15} />
            <span>Custom provider saved successfully!</span>
          </div>
        )}

        <form onSubmit={handleSaveCustom} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Provider Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. My Private vLLM Cluster"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Base URL <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://my-vllm.internal.net/v1"
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Authentication Scheme
              </label>
              <select
                value={authType}
                onChange={e => setAuthType(e.target.value as any)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="bearer">Authorization: Bearer {'{{secret}}'}</option>
                <option value="api-key-header">Custom Header Name</option>
              </select>
            </div>

            {authType === 'api-key-header' && (
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Header Name
                </label>
                <input
                  type="text"
                  value={headerName}
                  onChange={e => setHeaderName(e.target.value)}
                  placeholder="x-api-key or api-key"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-300 mb-1">
                Message Format
              </label>
              <select
                value={messageFormat}
                onChange={e => setMessageFormat(e.target.value as any)}
                className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="openai">OpenAI (messages array)</option>
                <option value="simple-text">Simple Text (prompt field)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-md shadow-blue-500/20 cursor-pointer"
            >
              Save Custom Provider
            </button>
          </div>
        </form>
      </div>

      {/* Saved Custom Providers List */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Saved Custom Providers ({customList.length})
        </h3>

        {customList.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 border border-dashed border-zinc-800 rounded-2xl">
            No custom providers created yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {customList.map(item => (
              <div
                key={item.id}
                className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 flex items-center justify-between"
              >
                <div>
                  <h4 className="font-semibold text-zinc-100 text-xs">{item.name}</h4>
                  <p className="text-[11px] font-mono text-zinc-500 truncate max-w-xs mt-0.5">
                    <BidiToken>{item.baseUrl}</BidiToken>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  title="Delete custom provider"
                  className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
