import { TestResult } from '../types/test';
import { StorageService } from './storage';

export interface ModelObservation {
  providerId: string;
  modelId: string;
  testCount: number;
  successCount: number;
  successRate: number;
  lastWorkingAt?: string;
  lastFailureCategory?: string;
  medianLatencyMs: number;
}

export class ObservedService {
  /**
   * Aggregate observations from sanitized test history
   */
  static getObservations(): Map<string, ModelObservation> {
    const history = StorageService.getHistory();
    const map = new Map<string, ModelObservation>();

    const latenciesByModel: Record<string, number[]> = {};

    for (const item of history) {
      const key = `${item.providerId}:::${item.model}`;
      let obs = map.get(key);
      if (!obs) {
        obs = {
          providerId: item.providerId,
          modelId: item.model,
          testCount: 0,
          successCount: 0,
          successRate: 0,
          medianLatencyMs: 0,
        };
        map.set(key, obs);
        latenciesByModel[key] = [];
      }

      obs.testCount += 1;
      latenciesByModel[key].push(item.latencyMs);

      if (item.status === 'working') {
        obs.successCount += 1;
        if (!obs.lastWorkingAt || new Date(item.testedAt) > new Date(obs.lastWorkingAt)) {
          obs.lastWorkingAt = item.testedAt;
        }
      } else {
        obs.lastFailureCategory = item.errorCategory;
      }
    }

    // Compute success rate and median latency
    for (const [key, obs] of map.entries()) {
      obs.successRate = obs.testCount > 0 ? Math.round((obs.successCount / obs.testCount) * 100) : 0;
      const lats = latenciesByModel[key].sort((a, b) => a - b);
      if (lats.length > 0) {
        const mid = Math.floor(lats.length / 2);
        obs.medianLatencyMs = lats.length % 2 !== 0 ? lats[mid] : Math.round((lats[mid - 1] + lats[mid]) / 2);
      }
    }

    return map;
  }

  static getModelObservation(providerId: string, modelId: string): ModelObservation | undefined {
    const key = `${providerId}:::${modelId}`;
    return this.getObservations().get(key);
  }
}
