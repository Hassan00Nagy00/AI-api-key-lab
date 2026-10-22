import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';
import { ObservedService } from './observedService';

export interface ModelSelectionResult {
  selectedModel: DiscoveredModel | null;
  candidates: DiscoveredModel[];
  reason: string;
}

export class ModelSelector {
  /**
   * Filter and rank model candidates per §2 Model Selection algorithm
   */
  static selectCandidates(
    provider: ProviderConfig,
    availableModels: DiscoveredModel[],
    userSelectedModelId?: string,
    lastKnownGoodModelId?: string,
    allowPaidWithConfirmation: boolean = false
  ): ModelSelectionResult {
    const excludePatterns = provider.excludeModelPatterns || [];

    // 1. Candidate filter:
    // - availability not unavailable / deprecated
    // - tier not paid (unless explicitly confirmed)
    // - id not matching provider's data-driven excludeModelPatterns
    const eligible = availableModels.filter(m => {
      if (m.availability === 'unavailable' || m.availability === 'deprecated') {
        return false;
      }

      if (m.tier === 'paid' && !allowPaidWithConfirmation && m.id !== userSelectedModelId) {
        return false;
      }

      const lowerId = m.id.toLowerCase();
      for (const pat of excludePatterns) {
        if (lowerId.includes(pat.toLowerCase())) {
          return false;
        }
      }

      return true;
    });

    if (eligible.length === 0) {
      return {
        selectedModel: null,
        candidates: [],
        reason: 'No verified generation-capable, non-paid model could be selected.',
      };
    }

    const observations = ObservedService.getObservations();
    const testPrefs = provider.testModelPreference || [];
    const cheapPatterns = provider.cheapPatterns || [];
    const avoidPatterns = provider.avoidPatterns || [];

    const matchesAvoid = (modelId: string): boolean => {
      const lower = modelId.toLowerCase();
      return avoidPatterns.some(pat => lower.includes(pat.toLowerCase()));
    };

    const getCheapPatternRank = (modelId: string): number => {
      const lower = modelId.toLowerCase();
      for (let i = 0; i < cheapPatterns.length; i++) {
        if (lower.includes(cheapPatterns[i].toLowerCase())) {
          return i;
        }
      }
      return Number.MAX_SAFE_INTEGER;
    };

    const getTestPreferenceRank = (modelId: string): number => {
      const idx = testPrefs.findIndex(p => p.modelId.toLowerCase() === modelId.toLowerCase());
      return idx >= 0 ? idx : Number.MAX_SAFE_INTEGER;
    };

    // 2. Ranking per §2:
    // (1) user-selected model (if paid -> require confirmation)
    // (2) this key's lastKnownGood if still listed
    // (*) A model matching avoidPatterns is never auto-selected while any other candidate exists.
    // (3) live-reported free (evidence provider-api)
    // (4) registry-recommended present in live list
    // (5) remaining candidates:
    //     - if tier is known free/trial: higher observed reliability then lower historical latency
    //     - if tier is UNKNOWN: cheapest-first — never largest-first:
    //       (5a) registry testModelPreference entries (ordered, data, with verifiedAt) present in live list
    //       (5b) registry cheapPatterns matches (data in registry, never hard-coded in logic)
    //       (5c) registry avoidPatterns last
    //       (5d) smaller context window before larger (heuristic)
    const ranked = [...eligible].sort((a, b) => {
      // (1) User selected
      if (userSelectedModelId) {
        if (a.id === userSelectedModelId) return -1;
        if (b.id === userSelectedModelId) return 1;
      }

      // (2) lastKnownGood
      if (lastKnownGoodModelId) {
        if (a.id === lastKnownGoodModelId) return -1;
        if (b.id === lastKnownGoodModelId) return 1;
      }

      // Enforce §2 rule: "A model matching avoidPatterns is never auto-selected while any other candidate exists."
      const aAvoid = matchesAvoid(a.id);
      const bAvoid = matchesAvoid(b.id);
      if (!aAvoid && bAvoid) return -1;
      if (aAvoid && !bAvoid) return 1;

      // (3) live-reported free with provider-api evidence
      const aIsApiFree = a.tier === 'free' && a.tierEvidence === 'provider-api';
      const bIsApiFree = b.tier === 'free' && b.tierEvidence === 'provider-api';
      if (aIsApiFree && !bIsApiFree) return -1;
      if (!aIsApiFree && bIsApiFree) return 1;

      // (4) Registry recommended
      const aRegistry = provider.models?.find(m => m.id === a.id);
      const bRegistry = provider.models?.find(m => m.id === b.id);
      if (aRegistry?.recommended && !bRegistry?.recommended) return -1;
      if (!aRegistry?.recommended && bRegistry?.recommended) return 1;

      // Known free/trial tier preference over unknown tier
      const aKnownFreeOrTrial = a.tier === 'free' || a.tier === 'trial';
      const bKnownFreeOrTrial = b.tier === 'free' || b.tier === 'trial';
      if (aKnownFreeOrTrial && !bKnownFreeOrTrial) return -1;
      if (!aKnownFreeOrTrial && bKnownFreeOrTrial) return 1;

      // (5) Remaining candidates:
      if (aKnownFreeOrTrial && bKnownFreeOrTrial) {
        // Known free/trial: higher observed reliability, then lower historical latency
        if (a.tier === 'free' && b.tier !== 'free') return -1;
        if (a.tier !== 'free' && b.tier === 'free') return 1;

        const aObs = observations.get(`${provider.id}:::${a.id}`);
        const bObs = observations.get(`${provider.id}:::${b.id}`);
        if (aObs && bObs) {
          if (aObs.successRate !== bObs.successRate) {
            return bObs.successRate - aObs.successRate;
          }
          if (aObs.medianLatencyMs !== bObs.medianLatencyMs) {
            return aObs.medianLatencyMs - bObs.medianLatencyMs;
          }
        }
      }

      // If tier is UNKNOWN (or tie-breaker): cheapest-first — never largest-first:
      // (5a) registry testModelPreference entries (ordered, data, with verifiedAt)
      const aPrefRank = getTestPreferenceRank(a.id);
      const bPrefRank = getTestPreferenceRank(b.id);
      if (aPrefRank !== bPrefRank) {
        return aPrefRank - bPrefRank;
      }

      // (5b) registry cheapPatterns matches (data in registry, never hard-coded in logic)
      const aCheapRank = getCheapPatternRank(a.id);
      const bCheapRank = getCheapPatternRank(b.id);
      if (aCheapRank !== bCheapRank) {
        return aCheapRank - bCheapRank;
      }

      // (5c) registry avoidPatterns last (already separated above, kept here for completeness)
      if (!aAvoid && bAvoid) return -1;
      if (aAvoid && !bAvoid) return 1;

      // (5d) smaller context window before larger (heuristic, labelled as such)
      const aContext = a.contextWindow || 4096;
      const bContext = b.contextWindow || 4096;
      if (aContext !== bContext) {
        return aContext - bContext;
      }

      // Observed reliability / latency tie-breaker
      const aObs = observations.get(`${provider.id}:::${a.id}`);
      const bObs = observations.get(`${provider.id}:::${b.id}`);
      if (aObs && bObs) {
        if (aObs.successRate !== bObs.successRate) {
          return bObs.successRate - aObs.successRate;
        }
        if (aObs.medianLatencyMs !== bObs.medianLatencyMs) {
          return aObs.medianLatencyMs - bObs.medianLatencyMs;
        }
      }

      return a.id.localeCompare(b.id);
    });

    // Enforce §2 (5c): "A model matching avoidPatterns is never auto-selected while any other candidate exists."
    const nonAvoidExists = ranked.some(m => !matchesAvoid(m.id));
    const finalCandidates = nonAvoidExists
      ? ranked.filter(m => !matchesAvoid(m.id) || m.id === userSelectedModelId)
      : ranked;

    return {
      selectedModel: finalCandidates[0] || null,
      candidates: finalCandidates,
      reason: finalCandidates[0]
        ? `Selected candidate model: ${finalCandidates[0].id} (cheapest-first / smaller-context heuristic when tier is unknown)`
        : 'No candidate found',
    };
  }


  /**
   * Merge live-discovered models with static registry models per §9:
   * - Registry models absent from live response are marked `unavailable` (not deleted).
   * - Newly discovered models not in the static registry are marked `isNew: true`.
   */
  static mergeLiveWithRegistryModels(
    registryModels: DiscoveredModel[],
    liveModels: DiscoveredModel[],
    providerId: string
  ): DiscoveredModel[] {
    const providerRegModels = registryModels.filter(m => m.providerId === providerId);
    const otherProviderModels = registryModels.filter(m => m.providerId !== providerId);
    const regIds = new Set(providerRegModels.map(m => m.id));
    const liveIds = new Set(liveModels.map(m => m.id));

    const updatedProviderModels: DiscoveredModel[] = [];

    // 1. Process live models: preserve registry tier/evidence if live model has 'unknown', or mark isNew if not in registry
    for (const lm of liveModels) {
      const existingReg = providerRegModels.find(rm => rm.id === lm.id);
      if (existingReg) {
        updatedProviderModels.push({
          ...existingReg,
          ...lm,
          tier: lm.tier !== 'unknown' ? lm.tier : existingReg.tier,
          tierEvidence: lm.tierEvidence !== 'none' ? lm.tierEvidence : existingReg.tierEvidence,
          availability: 'available',
          source: 'live',
          isNew: false,
        });
      } else {
        updatedProviderModels.push({
          ...lm,
          availability: 'available',
          source: 'live',
          isNew: true,
        });
      }
    }

    // 2. Keep registry models absent from live list, marked as 'unavailable'
    for (const rm of providerRegModels) {
      if (!liveIds.has(rm.id)) {
        updatedProviderModels.push({
          ...rm,
          availability: 'unavailable',
          isNew: false,
        });
      }
    }

    return [...otherProviderModels, ...updatedProviderModels];
  }
}
