import { ModelTier, TierEvidence, ProviderConfig, ModelConfig } from '../types/provider';

export interface ResolvedModelTier {
  tier: ModelTier;
  evidence: TierEvidence;
  isStale?: boolean;
}

export class FreeModelResolver {
  /**
   * Resolve model tier with strict evidence hierarchy per §4:
   * provider-api -> user -> registry -> naming-rule -> none
   */
  static resolve(
    modelId: string,
    provider: ProviderConfig,
    liveModelData?: any
  ): ResolvedModelTier {
    // 1. provider-api evidence (from live API metadata)
    if (liveModelData?.pricing) {
      const prompt = liveModelData.pricing.prompt;
      if (prompt === 0 || prompt === '0' || prompt === 0.0) {
        return { tier: 'free', evidence: 'provider-api' };
      } else if (prompt > 0) {
        return { tier: 'paid', evidence: 'provider-api' };
      }
    }

    // 2. Registry match
    const registryModel = provider.models?.find(
      (m: ModelConfig) => m.id.toLowerCase() === modelId.toLowerCase()
    );

    if (registryModel && registryModel.tier) {
      let isStale = false;
      if (provider.verifiedAt) {
        const verifiedTime = new Date(provider.verifiedAt).getTime();
        const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
        if (Date.now() - verifiedTime > ninetyDaysMs) {
          isStale = true;
        }
      }

      return {
        tier: registryModel.tier,
        evidence: 'registry',
        isStale,
      };
    }

    // 3. Naming-rule (e.g. OpenRouter :free suffix or -free naming)
    const lowerId = modelId.toLowerCase();
    if (lowerId.endsWith(':free') || lowerId.includes('/free') || lowerId.endsWith('-free')) {
      return {
        tier: 'free',
        evidence: 'naming-rule',
      };
    }

    // 4. Fallback: unknown tier with no evidence
    return {
      tier: 'unknown',
      evidence: 'none',
    };
  }
}
