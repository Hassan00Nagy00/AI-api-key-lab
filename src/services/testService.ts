import { ApiKeyRecord, KeyStatus, AuthVerified } from '../types/key';
import { ProviderConfig } from '../types/provider';
import { TestResult, TestLadderStage, ApiResponse } from '../types/test';
import { DiscoveredModel } from '../types/model';
import { ProviderRegistry } from './providerRegistry';
import { ApiExecutor, defaultExecutor } from './executor';
import { classifyError } from './errorClassifier';
import { validateResponse } from './responseValidator';
import { ModelSelector } from './modelSelector';
import { FreeModelResolver } from './freeModelResolver';
import { StorageService } from './storage';
import { BudgetService } from './budgetService';
import { ExpiryService } from './expiryService';
import { QuotaSnapshotService } from './modelWatchAndQuota';
import { RedactorService } from './redactor';

export interface TestExecutionProgress {
  stage: TestLadderStage;
  message: string;
  activeModel?: string;
  isFallback?: boolean;
}

export class ApiTestService {
  private static executor: ApiExecutor = defaultExecutor;

  static setExecutor(customExecutor: ApiExecutor): void {
    this.executor = customExecutor;
  }

  /**
   * Check if a key is eligible for a scheduled background health check (§13A & 07_P3 §0A.4):
   * - Never run for a key whose daily generation budget is exhausted.
   * - Never run for a key that is user-declared expired.
   * - Never run for a key whose status is 'unauthorized'.
   */
  static canRunScheduledHealthCheck(key: ApiKeyRecord, now: Date = new Date()): boolean {
    if (key.status === 'unauthorized') {
      return false;
    }
    if (ExpiryService.shouldSkipScheduledCheck(key, now)) {
      return false;
    }
    if (BudgetService.isKeyBudgetExhausted(key.id)) {
      return false;
    }
    return true;
  }

  /**
   * Run the full verification ladder on an API key
   */
  static async runVerificationLadder(
    key: ApiKeyRecord,
    provider: ProviderConfig,
    options?: {
      targetModelId?: string;
      onProgress?: (progress: TestExecutionProgress) => void;
      abortSignal?: AbortSignal;
      isHealthCheck?: boolean;
    }
  ): Promise<TestResult> {
    const notify = (stage: TestLadderStage, message: string, activeModel?: string, isFallback?: boolean) => {
      options?.onProgress?.({ stage, message, activeModel, isFallback });
    };

    const startTime = performance.now();
    let authVerified: AuthVerified = key.authVerified || 'unknown';
    const settings = StorageService.getSettings();
    const maxFallbackAttempts = settings.fallbackAttemptsCount || 2;

    // Pre-check budget before starting ladder
    const preBudget = BudgetService.getUsageSummary(key.id);
    if (!preBudget.allowed) {
      const budgetResult: TestResult = {
        id: crypto.randomUUID(),
        keyId: key.id,
        providerId: provider.id,
        status: key.status,
        authVerified,
        model: key.selectedModel || 'none',
        latencyMs: 0,
        errorCategory: 'rate-limit',
        errorMessage: preBudget.reason || 'Daily generation budget cap reached.',
        testedAt: new Date().toISOString(),
      };
      notify('failed', budgetResult.errorMessage!);
      return budgetResult;
    }

    // Stage 1: Detecting provider
    notify('detecting-provider', 'Detecting provider endpoints and configuration...');

    // Host check & custom base URL override
    const effectiveProvider: ProviderConfig = key.customBaseUrl
      ? { ...provider, baseUrl: key.customBaseUrl }
      : provider;
    const boundHost = key.boundHost || effectiveProvider.allowedHosts[0] || 'localhost';
    const adapter = ProviderRegistry.getAdapter(effectiveProvider);

    // Stage 2: Tier 0 List Models
    notify('listing-models', 'Tier 0: Querying available models from provider...');
    const now = new Date().toISOString();
    const registryModels: DiscoveredModel[] = (effectiveProvider.models || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      providerId: effectiveProvider.id,
      tier: m.tier || 'unknown',
      tierEvidence: m.tierEvidence || 'registry',
      availability: m.availability || 'available',
      contextWindow: m.contextWindow || 4096,
      supportsStreaming: m.supportsStreaming ?? true,
      supportsChat: m.supportsChat ?? true,
      source: 'registry',
      discoveredAt: now,
    }));

    let availableModels: DiscoveredModel[] = [];

    const listRequest = adapter.buildListModels(effectiveProvider);
    if (listRequest && effectiveProvider.supportsModelListing !== false) {
      const tier0Budget = BudgetService.checkAndConsumeTier0(key.id);
      if (tier0Budget.allowed) {
        try {
          const timeoutController = new AbortController();
          const timeoutId = setTimeout(() => timeoutController.abort(), 15000);

          const listRes = await this.executor.execute(listRequest, {
            keyId: key.id,
            boundHost,
            signal: options?.abortSignal || timeoutController.signal,
          });

          clearTimeout(timeoutId);

          if (listRes.status >= 200 && listRes.status < 300) {
            if (effectiveProvider.modelsRequiresAuth) {
              authVerified = 'yes';
            }
            const parsed = adapter.parseModels(listRes.bodyText, effectiveProvider);
            if (parsed && parsed.length > 0) {
              availableModels = ModelSelector.mergeLiveWithRegistryModels(
                registryModels,
                parsed,
                effectiveProvider.id
              );
            }
          } else if (listRes.status === 401 || listRes.status === 400) {
            const classified = classifyError(
              listRes.status,
              listRes.bodyText,
              listRes.isOpaqueError,
              'models',
              authVerified,
              effectiveProvider
            );
            if (classified.category === 'auth') {
              authVerified = 'no';
              const result: TestResult = {
                id: crypto.randomUUID(),
                keyId: key.id,
                providerId: effectiveProvider.id,
                status: classified.status,
                authVerified: 'no',
                model: 'none',
                httpStatus: listRes.status,
                latencyMs: Math.round(performance.now() - startTime),
                errorCategory: classified.category,
                errorMessage: classified.message,
                testedAt: new Date().toISOString(),
              };
              this.updateKeyAfterTest(key, result);
              return result;
            }
          }
        } catch (err: unknown) {
          if (err instanceof Error && err.message.startsWith('Host binding violation:')) {
            const result: TestResult = {
              id: crypto.randomUUID(),
              keyId: key.id,
              providerId: effectiveProvider.id,
              status: 'config-error',
              authVerified: 'unknown',
              model: 'none',
              latencyMs: Math.round(performance.now() - startTime),
              errorCategory: 'bad-request',
              errorMessage: RedactorService.redactString(err.message),
              testedAt: new Date().toISOString(),
            };
            this.updateKeyAfterTest(key, result);
            return result;
          }
          // Otherwise fall back to registry models
        }
      }
    }

    // If live model listing yielded no models, use provider's bundled registry models
    if (availableModels.length === 0) {
      availableModels = registryModels;
    }

    // Stage 3: Select Candidate Model
    notify('selecting-model', 'Selecting best candidate model...');
    const userSelected = options?.targetModelId || key.selectedModel;
    const lastGood = key.lastKnownGood?.model;

    const selection = ModelSelector.selectCandidates(
      effectiveProvider,
      availableModels,
      userSelected,
      lastGood,
      false // never auto-select paid
    );

    if (!selection.selectedModel || selection.candidates.length === 0) {
      const result: TestResult = {
        id: crypto.randomUUID(),
        keyId: key.id,
        providerId: provider.id,
        status: 'no-usable-model',
        authVerified,
        model: 'none',
        latencyMs: Math.round(performance.now() - startTime),
        errorCategory: 'model-not-found',
        errorMessage: 'No verified generation-capable, non-paid model could be selected.',
        testedAt: new Date().toISOString(),
      };
      this.updateKeyAfterTest(key, result);
      return result;
    }

    // Stage 4: Run Tier 2 Real Generation with Fallback candidates
    let attemptIndex = 0;
    const candidatesToTry = selection.candidates.slice(0, 1 + maxFallbackAttempts);

    let lastFailureResult: TestResult | null = null;

    for (const candidate of candidatesToTry) {
      attemptIndex++;
      const isFallback = attemptIndex > 1;

      // Enforce Budget Guard before every generation attempt (including fallbacks)
      const budgetConsume = BudgetService.checkAndConsumeGeneration(key.id, {
        source: options?.isHealthCheck ? 'health-check' : isFallback ? 'fallback' : 'test',
      });
      if (!budgetConsume.allowed) {
        if (lastFailureResult) {
          lastFailureResult.errorMessage = `${lastFailureResult.errorMessage} (${budgetConsume.reason})`;
        } else {
          lastFailureResult = {
            id: crypto.randomUUID(),
            keyId: key.id,
            providerId: provider.id,
            status: key.status,
            authVerified,
            model: candidate.id,
            latencyMs: Math.round(performance.now() - startTime),
            errorCategory: 'rate-limit',
            errorMessage: budgetConsume.reason || 'Daily generation budget cap reached.',
            testedAt: new Date().toISOString(),
          };
        }
        break;
      }

      notify(
        'sending-prompt',
        isFallback
          ? `Primary model failed. Trying fallback… (${candidate.id})`
          : `Tier 2: Sending real generation prompt ('Hi') to "${candidate.id}"...`,
        candidate.id,
        isFallback
      );

      // Execute generation
      const genResult = await this.executeSingleGenerationTest(
        key,
        effectiveProvider,
        candidate,
        boundHost,
        adapter,
        authVerified,
        isFallback,
        attemptIndex,
        options?.abortSignal
      );

      // If successful, return immediately
      if (genResult.status === 'working') {
        this.updateKeyAfterTest(key, genResult);
        notify('completed', 'Test passed! Generation validated.', candidate.id);
        return genResult;
      }

      lastFailureResult = genResult;

      // Check if error is worth trying next fallback model
      const shouldFallback =
        genResult.errorCategory === 'model-not-found' ||
        genResult.errorCategory === 'empty-response' ||
        genResult.errorCategory === 'rate-limit';

      if (!shouldFallback) {
        // Stop ladder immediately on auth failure, forbidden, bad-request, or network failure
        break;
      }
    }

    // If all candidates failed, persist and return last failure
    const finalResult = lastFailureResult || {
      id: crypto.randomUUID(),
      keyId: key.id,
      providerId: provider.id,
      status: 'unknown-error',
      authVerified,
      model: selection.selectedModel.id,
      latencyMs: Math.round(performance.now() - startTime),
      testedAt: new Date().toISOString(),
    };

    this.updateKeyAfterTest(key, finalResult);
    notify('failed', finalResult.errorMessage || 'Test failed', finalResult.model);
    return finalResult;
  }

  /**
   * Run single generation test on specific model candidate
   */
  private static async executeSingleGenerationTest(
    key: ApiKeyRecord,
    provider: ProviderConfig,
    candidate: DiscoveredModel,
    boundHost: string,
    adapter: any,
    currentAuthVerified: AuthVerified,
    isFallback: boolean,
    attemptCount: number,
    parentSignal?: AbortSignal
  ): Promise<TestResult> {
    const startTime = performance.now();
    let maxTokens = 256;

    const timeoutCtrl = new AbortController();
    const timeoutId = setTimeout(() => timeoutCtrl.abort(), 30000); // 30s timeout per §2
    const signal = parentSignal || timeoutCtrl.signal;

    try {
      const genRequest = adapter.buildGenerate(provider, candidate.id, 'Hi', maxTokens, undefined, false);
      const apiRes: ApiResponse = await this.executor.execute(genRequest, {
        keyId: key.id,
        boundHost,
        signal,
      });

      clearTimeout(timeoutId);

      const latencyMs = Math.round(performance.now() - startTime);

      // Extract rate limit headers if present
      const rateLimitHeaders = {
        limitRequests: apiRes.headers['x-ratelimit-limit-requests'],
        remainingRequests: apiRes.headers['x-ratelimit-remaining-requests'],
        resetRequests: apiRes.headers['x-ratelimit-reset-requests'],
        limitTokens: apiRes.headers['x-ratelimit-limit-tokens'],
        remainingTokens: apiRes.headers['x-ratelimit-remaining-tokens'],
        resetTokens: apiRes.headers['x-ratelimit-reset-tokens'],
      };

      // Record quota snapshot from real request headers (§13A COULD)
      QuotaSnapshotService.recordFromHeaders({
        keyId: key.id,
        providerId: provider.id,
        model: candidate.id,
        headers: rateLimitHeaders,
      });

      // 1. Non-200 responses
      if (apiRes.status < 200 || apiRes.status >= 300) {
        const classified = classifyError(
          apiRes.status,
          apiRes.bodyText,
          apiRes.isOpaqueError,
          'generate',
          currentAuthVerified,
          provider
        );
        return {
          id: crypto.randomUUID(),
          keyId: key.id,
          providerId: provider.id,
          status: classified.status,
          authVerified: classified.authVerified,
          model: candidate.id,
          httpStatus: apiRes.status,
          latencyMs,
          errorCategory: classified.category,
          errorMessage: RedactorService.redactString(classified.message),
          errorDetails: RedactorService.redactString(apiRes.bodyText.slice(0, 500)),
          testedAt: new Date().toISOString(),
          isFallbackModel: isFallback,
          attemptCount,
          rateLimitHeaders,
        };
      }

      // 2. Parse 200 response
      let parsed = adapter.parseGenerate(apiRes.bodyText);
      let validation = validateResponse(parsed);

      // Special case per §2: reasoning-only output with length-limit finish -> retry ONCE with double tokens
      if (!validation.isValid && validation.category === 'reasoning-retry-needed') {
        const retryBudget = BudgetService.checkAndConsumeGeneration(key.id, { source: 'test' });
        if (retryBudget.allowed) {
          maxTokens = 512;
          const retryReq = adapter.buildGenerate(provider, candidate.id, 'Hi', maxTokens, undefined, false);
          const retryRes = await this.executor.execute(retryReq, {
            keyId: key.id,
            boundHost,
            signal,
          });

          if (retryRes.status >= 200 && retryRes.status < 300) {
            parsed = adapter.parseGenerate(retryRes.bodyText);
            validation = validateResponse(parsed);
          }
        }
      }

      // 3. Evaluate Validation Outcome
      if (!validation.isValid) {
        let status: KeyStatus = 'unknown-error';
        const errorCat: any = validation.category;

        if (validation.category === 'malformed-response') {
          status = 'config-error';
        } else if (validation.category === 'empty-response') {
          status = 'unknown-error';
        }

        return {
          id: crypto.randomUUID(),
          keyId: key.id,
          providerId: provider.id,
          status,
          authVerified: 'yes', // HTTP 200 confirms auth was accepted
          model: candidate.id,
          httpStatus: apiRes.status,
          latencyMs,
          errorCategory: errorCat,
          errorMessage: RedactorService.redactString(validation.errorMessage || 'Validation failed'),
          errorDetails: RedactorService.redactString(apiRes.bodyText.slice(0, 500)),
          testedAt: new Date().toISOString(),
          isFallbackModel: isFallback,
          attemptCount,
        };
      }

      // 4. Success! Resolve tier
      const resolvedTier = FreeModelResolver.resolve(candidate.id, provider, parsed);

      return {
        id: crypto.randomUUID(),
        keyId: key.id,
        providerId: provider.id,
        status: 'working',
        authVerified: 'yes',
        model: candidate.id,
        modelTier: resolvedTier.tier,
        tierEvidence: resolvedTier.evidence,
        httpStatus: 200,
        latencyMs,
        responseSnippet: RedactorService.redactString(validation.visibleText.slice(0, 150)),
        reasoningSnippet: validation.reasoningText
          ? RedactorService.redactString(validation.reasoningText.slice(0, 150))
          : undefined,
        reasoningOnlyWarning: validation.reasoningOnlyWarning,
        testedAt: new Date().toISOString(),
        isFallbackModel: isFallback,
        attemptCount,
        rateLimitHeaders,
      };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - startTime);
      const isHostViolation =
        err instanceof Error && err.message.startsWith('Host binding violation:');
      return {
        id: crypto.randomUUID(),
        keyId: key.id,
        providerId: provider.id,
        status: isHostViolation ? 'config-error' : 'network-error',
        authVerified: currentAuthVerified,
        model: candidate.id,
        latencyMs,
        errorCategory: isHostViolation ? 'bad-request' : 'network',
        errorMessage: RedactorService.redactString(
          err instanceof Error ? err.message : 'Execution error during test'
        ),
        testedAt: new Date().toISOString(),
        isFallbackModel: isFallback,
        attemptCount,
      };
    }
  }

  /**
   * Update key metadata and record in storage
   */
  private static updateKeyAfterTest(key: ApiKeyRecord, result: TestResult) {
    const updatedKey: ApiKeyRecord = {
      ...key,
      status: result.status,
      authVerified: result.authVerified,
      lastTestedAt: result.testedAt,
      updatedAt: new Date().toISOString(),
    };

    if (result.status === 'working') {
      updatedKey.lastKnownGood = {
        at: result.testedAt,
        model: result.model,
        latencyMs: result.latencyMs,
        modelTier: result.modelTier,
      };
      updatedKey.selectedModel = result.model;
    }

    StorageService.saveKeyMetadata(updatedKey);
    StorageService.addHistoryResult(result);
  }
}

