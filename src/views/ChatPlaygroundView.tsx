import React, { useState, useEffect, useRef } from 'react';
import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';
import { ChatSession, ChatMessage } from '../types/chat';
import { ProviderRegistry } from '../services/providerRegistry';
import { ChatService } from '../services/chatService';
import { BudgetService } from '../services/budgetService';
import { t } from '../locales/i18n';
import {
  MessageSquare,
  Send,
  Square,
  Trash2,
  Download,
  AlertTriangle,
  Sparkles,
  Bot,
  User,
  Sliders,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from 'lucide-react';

interface ChatPlaygroundViewProps {
  keys: ApiKeyRecord[];
  providers: ProviderConfig[];
  initialKeyId?: string;
}

export const ChatPlaygroundView: React.FC<ChatPlaygroundViewProps> = ({
  keys,
  initialKeyId,
}) => {
  // Selectable keys: working or rate-limited with authVerified='yes'
  const eligibleKeys = keys.filter(
    k => k.status === 'working' || (k.status === 'rate-limited' && k.authVerified === 'yes')
  );

  const [selectedKeyId, setSelectedKeyId] = useState<string>(
    initialKeyId || eligibleKeys[0]?.id || keys[0]?.id || ''
  );
  const selectedKey = keys.find(k => k.id === selectedKeyId);
  const isSelectedKeyEligible = Boolean(
    selectedKey &&
      (selectedKey.status === 'working' ||
        (selectedKey.status === 'rate-limited' && selectedKey.authVerified === 'yes'))
  );
  const selectedProvider = selectedKey ? ProviderRegistry.get(selectedKey.providerId) : null;

  const [selectedModel, setSelectedModel] = useState<string>(
    selectedKey?.lastKnownGood?.model || selectedKey?.selectedModel || selectedProvider?.models?.[0]?.id || ''
  );

  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [streamingText, setStreamingText] = useState<string>('');
  const [budgetConfirmed, setBudgetConfirmed] = useState<boolean>(false);
  const [warningDismissedVersion, setWarningDismissedVersion] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Determine current model tier from provider registry or lastKnownGood
  const currentModelTier = React.useMemo(() => {
    const regModel = selectedProvider?.models?.find(m => m.id === selectedModel);
    if (regModel?.tier) return regModel.tier;
    if (selectedKey?.lastKnownGood?.model === selectedModel && selectedKey?.lastKnownGood?.modelTier) {
      return selectedKey.lastKnownGood.modelTier;
    }
    return 'unknown';
  }, [selectedProvider, selectedModel, selectedKey]);

  const showUnknownTierWarning = Boolean(
    selectedKey &&
      selectedProvider &&
      warningDismissedVersion >= 0 &&
      BudgetService.shouldShowBillingWarning(selectedKey, selectedProvider, currentModelTier)
  );

  const budgetCheck = selectedKey
    ? BudgetService.getUsageSummary(selectedKey.id)
    : { allowed: true, reason: undefined };

  // Update selected model when selected key changes
  useEffect(() => {
    if (selectedKey) {
      const bestModel =
        selectedKey.lastKnownGood?.model ||
        selectedKey.selectedModel ||
        selectedProvider?.models?.[0]?.id ||
        '';
      setSelectedModel(bestModel);
      setBudgetConfirmed(false);
    }
  }, [selectedKey, selectedProvider]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || !selectedKey || !selectedProvider || !isSelectedKeyEligible || isGenerating) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: textToSend.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInputPrompt('');
    setIsGenerating(true);
    setStreamingText('');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const session: ChatSession = {
      id: crypto.randomUUID(),
      title: `Chat with ${selectedModel}`,
      keyId: selectedKey.id,
      providerId: selectedProvider.id,
      model: selectedModel,
      messages: [...messages, userMsg],
      systemPrompt: systemPrompt.trim() || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const assistantMsg = await ChatService.sendMessage(
        session,
        selectedKey,
        selectedProvider,
        textToSend.trim(),
        chunk => {
          setStreamingText(prev => prev + chunk);
        },
        controller.signal,
        budgetConfirmed
      );

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: unknown) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        const errorMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `⚠️ Error: ${err instanceof Error ? err.message : 'Chat request failed'}`,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      setIsGenerating(false);
      setStreamingText('');
      abortControllerRef.current = null;
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      if (streamingText) {
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: streamingText + ' (Generation stopped)',
            timestamp: new Date().toISOString(),
          },
        ]);
      }
      setIsGenerating(false);
      setStreamingText('');
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    setStreamingText('');
  };

  const handleExportSession = (format: 'md' | 'json') => {
    if (messages.length === 0) return;
    let content = '';
    const filename = `ai-chat-${selectedModel}-${Date.now()}.${format === 'md' ? 'md' : 'json'}`;

    if (format === 'md') {
      content = `# Chat Session with ${selectedModel}\n\nProvider: ${selectedProvider?.name}\nDate: ${new Date().toISOString()}\n\n---\n\n`;
      for (const m of messages) {
        content += `### ${m.role === 'user' ? 'User' : 'Assistant'}\n\n${m.content}\n\n`;
      }
    } else {
      content = JSON.stringify(
        {
          provider: selectedProvider?.name,
          model: selectedModel,
          exportedAt: new Date().toISOString(),
          messages,
        },
        null,
        2
      );
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] max-w-5xl mx-auto space-y-4">
      {/* Header controls: key selector, model selector, clear */}
      <div className="p-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Key Selector */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                {t('chat.selectKey')}
              </label>
              <select
                value={selectedKeyId}
                onChange={e => setSelectedKeyId(e.target.value)}
                className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 font-medium focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                {keys.length === 0 ? (
                  <option value="">No verified working keys available</option>
                ) : (
                  keys.map(k => {
                    const isVerified =
                      k.status === 'working' ||
                      (k.status === 'rate-limited' && k.authVerified === 'yes');
                    return (
                      <option key={k.id} value={k.id}>
                        {k.label} ({k.providerId.toUpperCase()}){!isVerified ? ' [Unverified]' : ''}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            {/* Model Selector */}
            {selectedProvider && (
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
                  {t('chat.selectModel')}
                </label>
                <input
                  type="text"
                  value={selectedModel}
                  onChange={e => setSelectedModel(e.target.value)}
                  placeholder="e.g. gemini-2.5-flash"
                  className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-blue-500 w-56"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowConfig(!showConfig)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-300 hover:text-white bg-zinc-800 rounded-xl transition-colors cursor-pointer"
            >
              <Sliders size={13} />
              <span>Instructions</span>
              {showConfig ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {messages.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => handleExportSession('md')}
                  title="Export Markdown"
                  className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  onClick={handleClearChat}
                  title="Clear conversation"
                  className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-xl transition-colors cursor-pointer"
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Collapsible System Instruction */}
        {showConfig && (
          <div className="pt-2 border-t border-zinc-800/80">
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">
              {t('chat.systemPrompt')}
            </label>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="e.g. You are a helpful software engineering assistant..."
              rows={2}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>

      {/* Unverified Warning if no working keys or selected key is unverified */}
      {!isSelectedKeyEligible && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2.5">
          <AlertTriangle size={18} className="shrink-0" />
          <p>{t('chat.unverifiedKeyWarning')}</p>
        </div>
      )}

      {/* One-time Unknown-Tier Billing Warning (§13A) */}
      {showUnknownTierWarning && selectedKey && (
        <div
          data-testid="unknown-tier-billing-warning"
          className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert size={16} className="shrink-0 text-amber-400" />
            <span>
              This account may have billing enabled; a model of unknown tier can be billed.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              BudgetService.acknowledgeBillingWarning(selectedKey.id);
              setWarningDismissedVersion(v => v + 1);
            }}
            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-semibold transition-colors cursor-pointer shrink-0"
          >
            Acknowledge
          </button>
        </div>
      )}

      {/* Daily Budget Guard Soft Warning + Confirmation (§13A) */}
      {!budgetCheck.allowed && !budgetConfirmed && (
        <div
          data-testid="budget-guard-warning"
          className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0 text-rose-400" />
            <span>{budgetCheck.reason}</span>
          </div>
          <button
            type="button"
            onClick={() => setBudgetConfirmed(true)}
            className="px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-semibold transition-colors cursor-pointer shrink-0"
          >
            Confirm & Continue
          </button>
        </div>
      )}

      {/* Rate-limited Warning if selected key is rate-limited with authVerified='yes' */}
      {selectedKey?.status === 'rate-limited' && selectedKey?.authVerified === 'yes' && (
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2.5">
          <AlertTriangle size={16} className="shrink-0" />
          <p>This API key is authenticated (authVerified=yes) but recently hit a rate limit. Requests may be throttled.</p>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto p-4 rounded-2xl border border-zinc-800 bg-zinc-950/40 space-y-4">
        {messages.length === 0 && !streamingText && (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center text-zinc-400">
              <MessageSquare size={20} />
            </div>
            <p className="text-xs text-zinc-400 max-w-sm">
              {t('chat.emptyConversation')}
            </p>
            {isSelectedKeyEligible && (
              <button
                type="button"
                onClick={() => handleSendMessage('Hi')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
              >
                <Sparkles size={13} />
                <span>{t('chat.sendTest')}</span>
              </button>
            )}
          </div>
        )}

        {messages.map(msg => {
          const isUser = msg.role === 'user';
          return (
            <div
              key={msg.id}
              className={`flex items-start gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shrink-0 mt-0.5">
                  <Bot size={14} />
                </div>
              )}

              <div
                className={`max-w-2xl rounded-2xl p-4 text-xs leading-relaxed space-y-2 ${
                  isUser
                    ? 'bg-blue-600 text-white rounded-tr-sm'
                    : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-sm'
                }`}
              >
                {/* Reasoning thought if present */}
                {msg.reasoningContent && (
                  <div className="p-2.5 rounded-lg bg-black/40 border border-zinc-800 text-[11px] font-mono text-zinc-400 whitespace-pre-wrap" dir="ltr">
                    <span className="text-zinc-500 font-semibold block mb-1">Thinking Process:</span>
                    {msg.reasoningContent}
                  </div>
                )}

                <div className="whitespace-pre-wrap">{msg.content}</div>

                {!isUser && msg.latencyMs && (
                  <div className="text-[10px] text-zinc-500 pt-1 font-mono flex items-center gap-3">
                    <span>Latency: {msg.latencyMs}ms</span>
                    {msg.tokensUsed && <span>Tokens: {msg.tokensUsed}</span>}
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-300 shrink-0 mt-0.5">
                  <User size={14} />
                </div>
              )}
            </div>
          );
        })}

        {/* Live Streaming Chunk */}
        {streamingText && (
          <div className="flex items-start gap-3 justify-start">
            <div className="w-7 h-7 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0 mt-0.5">
              <Bot size={14} />
            </div>
            <div className="max-w-2xl rounded-2xl rounded-tl-sm p-4 text-xs leading-relaxed bg-zinc-900 border border-zinc-800 text-zinc-200">
              <div className="whitespace-pre-wrap">{streamingText}</div>
              <span className="inline-block w-2 h-3 ml-1 bg-blue-400 animate-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <form
        onSubmit={e => {
          e.preventDefault();
          handleSendMessage(inputPrompt);
        }}
        className="shrink-0 space-y-2"
      >
        <div className="relative flex items-center">
          <input
            type="text"
            disabled={!isSelectedKeyEligible || isGenerating}
            value={inputPrompt}
            onChange={e => setInputPrompt(e.target.value)}
            placeholder={
              !isSelectedKeyEligible
                ? 'Please select a verified working API key first'
                : t('chat.inputPlaceholder')
            }
            className="w-full pl-4 pr-24 py-3 bg-zinc-900 border border-zinc-800 rounded-2xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />

          <div className="absolute right-2 flex items-center gap-1.5">
            {isGenerating ? (
              <button
                type="button"
                onClick={handleStopGeneration}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-xl transition-colors cursor-pointer"
              >
                <Square size={12} className="fill-current" />
                <span>{t('chat.stop')}</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!isSelectedKeyEligible}
                  onClick={() => handleSendMessage('Hi')}
                  title="Send standard 'Hi' test prompt"
                  className="px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded-xl transition-colors cursor-pointer"
                >
                  {t('chat.sendTest')}
                </button>
                <button
                  type="submit"
                  disabled={!inputPrompt.trim() || !isSelectedKeyEligible}
                  className="p-2 text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-xl transition-all shadow-sm shadow-blue-500/20 cursor-pointer"
                >
                  <Send size={13} />
                </button>
              </>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
