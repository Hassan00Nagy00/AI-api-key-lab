import { ProviderAdapter } from './types';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { PreparedRequest } from '../types/test';
import { ParsedGenerateResponse } from '../services/responseValidator';

export class AnthropicCompatibleAdapter implements ProviderAdapter {
  protocol = 'anthropic-compatible' as const;

  buildListModels(config: ProviderConfig): PreparedRequest | null {
    if (!config.baseUrl) return null;
    const base = config.baseUrl.replace(/\/+$/, '');
    const endpoint = config.endpoints?.models || `${base}/models`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'x-api-key': '{{secret}}',
      'anthropic-version': '2023-06-01',
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
        .map((item: any) => ({
          id: item.id,
          name: item.display_name || item.id,
          providerId: config.id,
          tier: 'unknown',
          tierEvidence: 'none',
          availability: 'available',
          contextWindow: 200000,
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
    const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const endpoint = config.endpoints?.chat || `${base}/v1/messages`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'x-api-key': '{{secret}}',
      'anthropic-version': '2023-06-01',
      ...(config.headers || {}),
    };

    const body: Record<string, any> = {
      model: modelId,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
      stream,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    return {
      url: endpoint,
      method: 'POST',
      headers,
      body,
    };
  }

  parseGenerate(bodyText: string): ParsedGenerateResponse {
    try {
      const json = JSON.parse(bodyText);
      if (json.type === 'error' || json.error) {
        return {
          visibleText: '',
          hasErrorObject: true,
          errorMessage: json.error?.message || JSON.stringify(json.error || json),
        };
      }

      let visibleText = '';
      let reasoningText: string | undefined = undefined;

      if (Array.isArray(json.content)) {
        for (const block of json.content) {
          if (block.type === 'text') {
            visibleText += block.text;
          } else if (block.type === 'thinking') {
            reasoningText = block.thinking;
          }
        }
      }

      return {
        visibleText,
        reasoningText,
        finishReason: json.stop_reason,
        usage: {
          promptTokens: json.usage?.input_tokens,
          completionTokens: json.usage?.output_tokens,
          totalTokens: (json.usage?.input_tokens || 0) + (json.usage?.output_tokens || 0),
        },
      };
    } catch {
      return {
        visibleText: '',
        hasErrorObject: true,
        errorMessage: 'Failed to parse Anthropic JSON response',
      };
    }
  }
}
