import { ProviderAdapter } from './types';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { PreparedRequest } from '../types/test';
import { ParsedGenerateResponse } from '../services/responseValidator';

export class GeminiAdapter implements ProviderAdapter {
  protocol = 'google-gemini' as const;

  buildListModels(config: ProviderConfig): PreparedRequest | null {
    const base = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const endpoint = `${base}/models`;

    return {
      url: endpoint,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-goog-api-key': '{{secret}}',
        ...(config.headers || {}),
      },
    };
  }

  parseModels(bodyText: string, config: ProviderConfig): DiscoveredModel[] {
    try {
      const data = JSON.parse(bodyText);
      const list = Array.isArray(data.models) ? data.models : [];
      const now = new Date().toISOString();

      const excludePatterns = config.excludeModelPatterns || [];

      return list
        .filter((item: any) => {
          // Model must support generateContent method
          const methods: string[] = item.supportedGenerationMethods || [];
          if (!methods.includes('generateContent')) return false;

          const rawName: string = item.name || '';
          const cleanId = (rawName.startsWith('models/') ? rawName.slice(7) : rawName).toLowerCase();
          for (const pat of excludePatterns) {
            if (cleanId.includes(pat.toLowerCase())) {
              return false;
            }
          }
          return true;
        })
        .map((item: any) => {
          const rawName: string = item.name || '';
          // Normalize "models/gemini-1.5-flash" -> "gemini-1.5-flash"
          const cleanId = rawName.startsWith('models/') ? rawName.slice(7) : rawName;

          return {
            id: cleanId,
            name: item.displayName || cleanId,
            providerId: config.id,
            tier: 'unknown',
            tierEvidence: 'none',
            availability: 'available',
            contextWindow: item.inputTokenLimit || 1048576,
            maxOutputTokens: item.outputTokenLimit || 8192,
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
    const base = (config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    const cleanModel = modelId.startsWith('models/') ? modelId.slice(7) : modelId;
    const action = stream ? 'streamGenerateContent' : 'generateContent';
    const endpoint = `${base}/models/${cleanModel}:${action}`;

    const contents: any[] = [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ];

    const body: any = {
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
      },
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    return {
      url: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-goog-api-key': '{{secret}}',
        ...(config.headers || {}),
      },
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

      // In streaming array or single object
      const candidate = Array.isArray(json)
        ? json[0]?.candidates?.[0]
        : json.candidates?.[0];

      if (!candidate) {
        return {
          visibleText: '',
          hasErrorObject: true,
          errorMessage: 'No candidate generated in Gemini response',
        };
      }

      let visibleText = '';
      let reasoningText: string | undefined = undefined;

      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.thought) {
          reasoningText = (reasoningText || '') + part.thought;
        } else if (part.text) {
          visibleText += part.text;
        }
      }

      return {
        visibleText,
        reasoningText,
        finishReason: candidate.finishReason,
        usage: {
          promptTokens: json.usageMetadata?.promptTokenCount,
          completionTokens: json.usageMetadata?.candidatesTokenCount,
          totalTokens: json.usageMetadata?.totalTokenCount,
        },
      };
    } catch {
      return {
        visibleText: '',
        hasErrorObject: true,
        errorMessage: 'Failed to parse Gemini response',
      };
    }
  }
}
