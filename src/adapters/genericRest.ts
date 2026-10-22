import { ProviderAdapter } from './types';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { PreparedRequest } from '../types/test';
import { ParsedGenerateResponse } from '../services/responseValidator';

/**
 * Safe JSONPath evaluator without eval or new Function
 * Supports dot notation: "data.choices.0.message.content" or "response.text"
 */
function safeExtractPath(obj: any, path: string): any {
  if (!obj || !path) return undefined;
  const segments = path.replace(/\[(\w+)\]/g, '.$1').split('.');
  let current = obj;
  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    current = current[seg];
  }
  return current;
}

export class GenericRestAdapter implements ProviderAdapter {
  protocol = 'generic-rest' as const;

  buildListModels(config: ProviderConfig): PreparedRequest | null {
    if (!config.baseUrl) return null;
    const base = config.baseUrl.replace(/\/+$/, '');
    const endpoint = config.endpoints?.models || config.customConfig?.modelsEndpoint || `${base}/models`;

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(config.headers || {}),
      ...(config.customConfig?.customHeaders || {}),
    };

    if (config.authentication) {
      if (config.authentication.type === 'bearer') {
        headers['Authorization'] = 'Bearer {{secret}}';
      } else if (config.authentication.type === 'api-key-header') {
        const headerName = config.authentication.headerName || 'x-api-key';
        headers[headerName] = '{{secret}}';
      }
    }

    return {
      url: endpoint,
      method: 'GET',
      headers,
    };
  }

  parseModels(bodyText: string, config: ProviderConfig): DiscoveredModel[] {
    try {
      const data = JSON.parse(bodyText);
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : Array.isArray(data) ? data : [];
      const now = new Date().toISOString();

      return list
        .filter((item: any) => item && (typeof item === 'string' || typeof item.id === 'string'))
        .map((item: any) => {
          const id = typeof item === 'string' ? item : item.id;
          const name = typeof item === 'string' ? item : item.name || item.id;
          return {
            id,
            name,
            providerId: config.id,
            tier: 'unknown',
            tierEvidence: 'none',
            availability: 'available',
            contextWindow: item.context_length || 4096,
            supportsStreaming: false,
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
    const endpoint = config.endpoints?.chat || config.customConfig?.chatEndpoint || `${base}/chat/completions`;
    const custom = config.customConfig;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...(config.headers || {}),
      ...(custom?.customHeaders || {}),
    };

    if (config.authentication) {
      if (config.authentication.type === 'bearer') {
        headers['Authorization'] = 'Bearer {{secret}}';
      } else if (config.authentication.type === 'api-key-header') {
        const headerName = config.authentication.headerName || 'x-api-key';
        headers[headerName] = '{{secret}}';
      }
    }

    // If custom request template is specified, substitute safe variables: {{model}}, {{prompt}}, {{max_tokens}}
    if (custom?.requestTemplate) {
      const templatedBody = custom.requestTemplate
        .replace(/\{\{model\}\}/g, modelId)
        .replace(/\{\{prompt\}\}/g, prompt)
        .replace(/\{\{max_tokens\}\}/g, String(maxTokens));

      return {
        url: endpoint,
        method: custom.httpMethod || 'POST',
        headers,
        body: templatedBody,
      };
    }

    // Default JSON structure based on message format
    const modelField = custom?.modelField || 'model';
    const body: Record<string, any> = {
      [modelField]: modelId,
      max_tokens: maxTokens,
      stream,
    };

    if (custom?.messageFormat === 'simple-text') {
      body.prompt = prompt;
    } else {
      // standard messages array
      body.messages = [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ];
    }

    return {
      url: endpoint,
      method: custom?.httpMethod || 'POST',
      headers,
      body,
    };
  }

  parseGenerate(bodyText: string): ParsedGenerateResponse {
    try {
      const json = JSON.parse(bodyText);
      if (json.error) {
        return {
          visibleText: '',
          hasErrorObject: true,
          errorMessage: json.error.message || JSON.stringify(json.error),
        };
      }

      // Try OpenAI-like extraction first
      const openAiText = json.choices?.[0]?.message?.content || json.choices?.[0]?.text;
      if (openAiText) {
        return {
          visibleText: typeof openAiText === 'string' ? openAiText : JSON.stringify(openAiText),
          finishReason: json.choices?.[0]?.finish_reason,
        };
      }

      // Try top-level response or text fields
      const candidateText = json.text || json.response || json.output || json.result;
      if (candidateText) {
        return {
          visibleText: typeof candidateText === 'string' ? candidateText : JSON.stringify(candidateText),
        };
      }

      return {
        visibleText: '',
        hasErrorObject: true,
        errorMessage: 'Unable to extract text from custom provider response structure',
      };
    } catch {
      return {
        visibleText: '',
        hasErrorObject: true,
        errorMessage: 'Failed to parse JSON response from custom provider',
      };
    }
  }
}
