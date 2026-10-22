import { ProviderConfig } from '../types/provider';
import { BUNDLED_PROVIDERS } from '../providers/catalog';
import { StorageService } from './storage';
import { ProviderAdapter } from '../adapters/types';
import { OpenAICompatibleAdapter } from '../adapters/openai';
import { AnthropicCompatibleAdapter } from '../adapters/anthropic';
import { GeminiAdapter } from '../adapters/gemini';
import { CohereAdapter } from '../adapters/cohere';
import { GenericRestAdapter } from '../adapters/genericRest';

const adapters: Record<string, ProviderAdapter> = {
  'openai-compatible': new OpenAICompatibleAdapter(),
  'anthropic-compatible': new AnthropicCompatibleAdapter(),
  'google-gemini': new GeminiAdapter(),
  'cohere': new CohereAdapter(),
  'generic-rest': new GenericRestAdapter(),
};

export class ProviderRegistry {
  private static dynamicProviders: Map<string, ProviderConfig> = new Map();

  /**
   * Initialize or get all providers (bundled + custom)
   */
  static getAll(): ProviderConfig[] {
    const list: ProviderConfig[] = [...BUNDLED_PROVIDERS];

    // Merge custom stored providers
    const custom = StorageService.getCustomProviders();
    for (const c of custom) {
      const idx = list.findIndex(p => p.id === c.id);
      if (idx >= 0) {
        list[idx] = c;
      } else {
        list.push(c);
      }
    }

    // Merge in-memory registered providers
    for (const d of this.dynamicProviders.values()) {
      const idx = list.findIndex(p => p.id === d.id);
      if (idx >= 0) {
        list[idx] = d;
      } else {
        list.push(d);
      }
    }

    return list;
  }

  /**
   * Find provider by ID
   */
  static get(id: string): ProviderConfig | undefined {
    return this.getAll().find(p => p.id === id);
  }

  /**
   * One-line provider registration per §3
   */
  static registerProvider(config: ProviderConfig): void {
    this.dynamicProviders.set(config.id, config);
    if (config.source === 'user') {
      StorageService.saveCustomProvider(config);
    }
  }

  /**
   * Retrieve adapter for provider
   */
  static getAdapter(provider: ProviderConfig): ProviderAdapter {
    const adapter = adapters[provider.protocol];
    if (!adapter) {
      // Fallback to OpenAI compatible
      return adapters['openai-compatible'];
    }
    return adapter;
  }
}
