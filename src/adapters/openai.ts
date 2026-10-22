import { ProviderAdapter } from './types';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { PreparedRequest } from '../types/test';
import { ParsedGenerateResponse } from '../services/responseValidator';

export class OpenAICompatibleAdapter implements ProviderAdapter {
  protocol = 'openai-compatible' as const;

  buildListModels(config: ProviderConfig): PreparedRequest | null {
    if (!config.baseUrl) return null;
    const base = config.baseUrl.replace(/\/+$/, '');
    const endpoint = config.endpoints?.models || `${base}/models`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Authorization': 'Bearer {{secret}}',
      ...(config.headers || {}),
    };

    return {
      url: endpoint,
      method: 'GET',
      headers,
    };
  }

  parseModels(bodyText: string, config: ProviderConfig): DiscoveredModel[] {
    try {
      const data = JSON.parse(bodyText);
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
      const now = new Date().toISOString();

      return list
        .filter((item: any) => item && typeof item.id === 'string')
        .map((item: any) => {
          // Check if pricing or free flag is exposed by provider-api (e.g. OpenRouter)
          let tier: 'free' | 'trial' | 'paid' | 'unknown' = 'unknown';
          let tierEvidence: 'provider-api' | 'user' | 'registry' | 'naming-rule' | 'none' = 'none';

          if (item.pricing && (item.pricing.prompt === '0' || item.pricing.prompt === 0)) {
            tier = 'free';
            tierEvidence = 'provider-api';
          } else if (item.id.toLowerCase().includes(':free') || item.id.toLowerCase().endsWith('-free')) {
            tier = 'free';
            tierEvidence = 'naming-rule';
          }

          return {
            id: item.id,
            name: item.name || item.id,
            providerId: config.id,
            tier,
            tierEvidence,
            availability: 'available',
            contextWindow: item.context_length || item.max_context_length || 4096,
            supportsStreaming: true,
            supportsChat: true,
            source: 'live',
            discoveredAt: now,
          };
        });
    } catch {
      return [];
    }
  }

  buildGenerate(
    config: ProviderConfig,
    modelId: string,
    prompt: string,
    maxTokens: number = 256,
    systemPrompt?: string,
    stream: boolean = false
  ): PreparedRequest {
    const base = (config.baseUrl || '').replace(/\/+$/, '');
    const endpoint = config.endpoints?.chat || `${base}/chat/completions`;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer {{secret}}',
      ...(config.headers || {}),
    };

    return {
      url: endpoint,
      method: 'POST',
      headers,
      body: {
        model: modelId,
        messages,
        max_tokens: maxTokens,
        stream,
      },
    };
  }

  parseGenerate(bodyText: string): ParsedGenerateResponse {
    try {
      // Check for SSE streaming format if chunked
      if (bodyText.includes('data:')) {
        let fullText = '';
        let reasoningText = '';
        const lines = bodyText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:') && !trimmed.includes('[DONE]')) {
            try {
              const chunk = JSON.parse(trimmed.slice(5).trim());
              const delta = chunk.choices?.[0]?.delta;
              if (delta?.content) fullText += delta.content;
              if (delta?.reasoning_content) reasoningText += delta.reasoning_content;
            } catch {
              // ignore partial chunk parse
            }
          }
        }
        return {
          visibleText: fullText,
          reasoningText: reasoningText || undefined,
        };
      }

      const json = JSON.parse(bodyText);
      if (json.error) {
        return {
          visibleText: '',
          hasErrorObject: true,
          errorMessage: json.error.message || JSON.stringify(json.error),
        };
      }

      const choice = json.choices?.[0];
      const message = choice?.message;
      const visibleText = message?.content || '';
      const reasoningText = message?.reasoning_content || message?.reasoning || undefined;

      return {
        visibleText: typeof visibleText === 'string' ? visibleText : JSON.stringify(visibleText),
        reasoningText,
        finishReason: choice?.finish_reason,
        usage: {
          promptTokens: json.usage?.prompt_tokens,
          completionTokens: json.usage?.completion_tokens,
          totalTokens: json.usage?.total_tokens,
        },
      };
    } catch {
      return {
        visibleText: '',
        hasErrorObject: true,
        errorMessage: 'Failed to parse JSON response from provider',
      };
    }
  }
}
