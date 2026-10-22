import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { PreparedRequest } from '../types/test';
import { ParsedGenerateResponse } from '../services/responseValidator';

export interface ProviderAdapter {
  protocol: ProviderConfig['protocol'];

  buildListModels(config: ProviderConfig): PreparedRequest | null;
  parseModels(bodyText: string, config: ProviderConfig): DiscoveredModel[];

  buildGenerate(
    config: ProviderConfig,
    modelId: string,
    prompt: string,
    maxTokens?: number,
    systemPrompt?: string,
    stream?: boolean
  ): PreparedRequest;

  parseGenerate(bodyText: string): ParsedGenerateResponse;
}
