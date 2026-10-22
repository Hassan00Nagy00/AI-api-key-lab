import { ProviderAdapter } from './types';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { PreparedRequest } from '../types/test';
import { ParsedGenerateResponse } from '../services/responseValidator';

export class CohereAdapter implements ProviderAdapter {
  protocol = 'cohere' as const;

  buildListModels(config: ProviderConfig): PreparedRequest | null {
    const base = (config.baseUrl || 'https://api.cohere.com/v2').replace(/\/+$/, '');
    const endpoint = config.endpoints?.models || `${base}/models`;

    return {
      url: endpoint,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer {{secret}}',
        ...(config.headers || {}),
      },
    };
  }

  parseModels(bodyText: string, config: ProviderConfig): DiscoveredModel[] {
    try {
      const data = JSON.parse(bodyText);
      const list = Array.isArray(data.models) ? data.models : [];
      const now = new Date().toISOString();

      return list
        .filter((item: any) => {
          const endpoints: string[] = item.endpoints || [];
          return endpoints.includes('chat') || !endpoints.length;
        })
        .map((item: any) => ({
          id: item.name || item.id,
          name: item.display_name || item.name || item.id,
          providerId: config.id,
          tier: 'unknown',
          tierEvidence: 'none',
          availability: 'available',
          contextWindow: item.context_length || 128000,
          supportsStreaming: true,
          supportsChat: true,
          source: 'live',
          discoveredAt: now,
        }));
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
    const base = (config.baseUrl || 'https://api.cohere.com/v2').replace(/\/+$/, '');
    const endpoint = config.endpoints?.chat || `${base}/chat`;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    return {
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer {{secret}}',
        ...(config.headers || {}),
      },
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
      const json = JSON.parse(bodyText);
      if (json.message && !json.message.content) {
        // Error response or status
        if (json.status_code || json.code) {
          return {
            visibleText: '',
            hasErrorObject: true,
            errorMessage: json.message || JSON.stringify(json),
          };
        }
      }

      const content = json.message?.content;
      let visibleText = '';
      if (Array.isArray(content)) {
        for (const item of content) {
          if (item.text) visibleText += item.text;
        }
      } else if (typeof content === 'string') {
        visibleText = content;
      }

      return {
        visibleText,
        finishReason: json.finish_reason,
        usage: {
          promptTokens: json.usage?.tokens?.input_tokens,
          completionTokens: json.usage?.tokens?.output_tokens,
          totalTokens: (json.usage?.tokens?.input_tokens || 0) + (json.usage?.tokens?.output_tokens || 0),
        },
      };
    } catch {
      return {
        visibleText: '',
        hasErrorObject: true,
        errorMessage: 'Failed to parse Cohere response',
      };
    }
  }
}
