import { ChatMessage, ChatSession } from '../types/chat';
import { ApiKeyRecord } from '../types/key';
import { ProviderConfig } from '../types/provider';
import { ProviderRegistry } from './providerRegistry';
import { defaultExecutor } from './executor';
import { StorageService } from './storage';
import { BudgetService } from './budgetService';
import { RedactorService } from './redactor';

export class ChatService {
  private static executor = defaultExecutor;

  /**
   * Send a chat message within a session using a verified working key.
   * Enforces Budget Guard (§13A) with soft warning + confirmation override in Playground.
   */
  static async sendMessage(
    session: ChatSession,
    key: ApiKeyRecord,
    provider: ProviderConfig,
    userPrompt: string,
    onChunk?: (token: string) => void,
    signal?: AbortSignal,
    allowPlaygroundOverride: boolean = false
  ): Promise<ChatMessage> {
    const budgetCheck = BudgetService.checkAndConsumeGeneration(key.id, {
      source: 'playground',
      allowPlaygroundOverride,
    });
    if (!budgetCheck.allowed) {
      throw new Error(
        budgetCheck.reason ||
          'Budget Guard: Daily generation cap reached. Confirm override in Playground to continue.'
      );
    }

    const effectiveProvider: ProviderConfig = key.customBaseUrl
      ? { ...provider, baseUrl: key.customBaseUrl }
      : provider;
    const adapter = ProviderRegistry.getAdapter(effectiveProvider);
    const boundHost = key.boundHost || effectiveProvider.allowedHosts[0] || 'localhost';

    const startTime = performance.now();
    const isStream = Boolean(onChunk && effectiveProvider.supportsStreaming !== false);

    // Build generate request
    const req = adapter.buildGenerate(
      effectiveProvider,
      session.model,
      userPrompt,
      session.maxTokens || 1024,
      session.systemPrompt,
      isStream
    );

    let accumulatedChunkText = '';
    const chunkCallback = (chunk: string) => {
      const safeChunk = RedactorService.redactString(chunk);
      accumulatedChunkText += safeChunk;
      onChunk?.(safeChunk);
    };

    const res = await this.executor.execute(req, {
      keyId: key.id,
      boundHost,
      signal: signal || new AbortController().signal,
      onChunk: isStream ? chunkCallback : undefined,
    });

    const latencyMs = Math.round(performance.now() - startTime);

    if (res.status < 200 || res.status >= 300) {
      throw new Error(
        RedactorService.redactString(`API error (${res.status}): ${res.bodyText.slice(0, 300)}`)
      );
    }

    const parsed = adapter.parseGenerate(res.bodyText);
    const finalText = RedactorService.redactString(parsed.visibleText || accumulatedChunkText);

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: finalText || '(Empty response)',
      reasoningContent: parsed.reasoningText
        ? RedactorService.redactString(parsed.reasoningText)
        : undefined,
      timestamp: new Date().toISOString(),
      model: session.model,
      latencyMs,
      tokensUsed: parsed.usage?.totalTokens,
    };

    return assistantMsg;
  }

  /**
   * Create or update chat session
   */
  static createSession(keyId: string, providerId: string, model: string, title?: string): ChatSession {
    const session: ChatSession = {
      id: crypto.randomUUID(),
      title: title || `Chat with ${model}`,
      keyId,
      providerId,
      model,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    StorageService.saveChatSession(session);
    return session;
  }
}

