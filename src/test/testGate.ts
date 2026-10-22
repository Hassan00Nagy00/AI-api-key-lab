import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeProviderServer } from './fakeProviderServer';
import { classifyError } from '../services/errorClassifier';
import { validateResponse } from '../services/responseValidator';
import { BrowserApiExecutor } from '../services/executor';
import { StorageService } from '../services/storage';
import { OpenAICompatibleAdapter } from '../adapters/openai';
import { GeminiAdapter } from '../adapters/gemini';
import { AnthropicCompatibleAdapter } from '../adapters/anthropic';
import { ModelSelector } from '../services/modelSelector';
import { BUNDLED_PROVIDERS } from '../providers/catalog';

const PORT = 4444;

test('GATE: Real HTTP Fake Provider Integration Test Suite', async (t) => {
  const server = createFakeProviderServer(PORT);

  await new Promise<void>((resolve) => {
    server.listen(PORT, () => resolve());
  });

  // Seed a mock key secret in StorageService for BrowserApiExecutor tests
  await StorageService.saveSecret('gate-test-key', 'sk-gate-test-secret-9999');

  try {
    // 1. Scenario: 200 Valid Response
    await t.test('1. 200 Valid Response -> status working', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/valid`, { method: 'POST' });
      assert.equal(res.status, 200);
      const json = await res.json();
      const text = json.choices[0].message.content;
      const validation = validateResponse({ visibleText: text });
      assert.equal(validation.isValid, true);
    });

    // 2. Scenario: 200 Empty Output -> category empty-response
    await t.test('2. 200 Empty Output -> category empty-response', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/empty`, { method: 'POST' });
      assert.equal(res.status, 200);
      const json = await res.json();
      const validation = validateResponse({ visibleText: json.choices[0].message.content });
      assert.equal(validation.isValid, false);
      if (!validation.isValid) {
        assert.equal(validation.category, 'empty-response');
      }
    });

    // 3. Scenario: 200 Error-in-200 -> error-object / classified by inner error code
    await t.test('3. 200 with embedded error object -> rejected by validator & classified by error code', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/error-object`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.text();
      const openai = new OpenAICompatibleAdapter();
      const parsed = openai.parseGenerate(body);
      assert.equal(parsed.hasErrorObject, true);
      const validation = validateResponse(parsed);
      assert.equal(validation.isValid, false);
      const classified = classifyError(res.status, body);
      assert.equal(classified.status, 'rate-limited');
      assert.equal(classified.category, 'rate-limit');
    });

    // 4. Scenario: 200 Reasoning-only output
    await t.test('4. 200 Reasoning-only output -> working with reasoningOnlyWarning (or retry on length)', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/reasoning-only`, { method: 'POST' });
      assert.equal(res.status, 200);
      const body = await res.text();
      const openai = new OpenAICompatibleAdapter();
      const parsed = openai.parseGenerate(body);
      const validation = validateResponse(parsed);
      assert.equal(validation.isValid, true);
      if (validation.isValid) {
        assert.equal(validation.reasoningOnlyWarning, true);
      }

      // Length-truncated reasoning triggers retry once
      const truncatedValidation = validateResponse({
        visibleText: '',
        reasoningText: 'Thinking step 1...',
        finishReason: 'length',
      });
      assert.equal(truncatedValidation.isValid, false);
      if (!truncatedValidation.isValid) {
        assert.equal(truncatedValidation.category, 'reasoning-retry-needed');
      }
    });

    // 5. Scenario: 401 Unauthorized -> status unauthorized, authVerified=no
    await t.test('5. 401 Unauthorized -> status unauthorized, authVerified=no', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/401`, { method: 'POST' });
      const body = await res.text();
      const classified = classifyError(res.status, body);
      assert.equal(classified.status, 'unauthorized');
      assert.equal(classified.category, 'auth');
      assert.equal(classified.authVerified, 'no');
    });

    // 6. Scenario: 402 Insufficient Credit -> status no-credit, authVerified=yes
    await t.test('6. 402 Payment Required -> status no-credit, authVerified=yes', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/402`, { method: 'POST' });
      const body = await res.text();
      const classified = classifyError(res.status, body);
      assert.equal(classified.status, 'no-credit');
      assert.equal(classified.authVerified, 'yes');
    });

    // 7. Scenario: 403 Forbidden -> status forbidden, authVerified=yes
    await t.test('7. 403 Forbidden -> status forbidden, authVerified=yes', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/403`, { method: 'POST' });
      const body = await res.text();
      const classified = classifyError(res.status, body);
      assert.equal(classified.status, 'forbidden');
      assert.equal(classified.authVerified, 'yes');
    });

    // 8. Scenario: 404 Model Not Found -> status no-usable-model, authVerified=yes
    await t.test('8. 404 Model Not Found -> status no-usable-model, fallback eligible', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/404-model`, { method: 'POST' });
      const body = await res.text();
      const classified = classifyError(res.status, body);
      assert.equal(classified.status, 'no-usable-model');
      assert.equal(classified.authVerified, 'yes');
      assert.equal(classified.isFallbackWorthy, true);
    });

    // 9. Scenario: 429 Rate Limit with Retry-After -> status rate-limited, authVerified=yes
    await t.test('9. 429 Rate Limit with Retry-After -> status rate-limited, authVerified=yes', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/429`, { method: 'POST' });
      const body = await res.text();
      assert.equal(res.headers.get('retry-after'), '15');
      const classified = classifyError(res.status, body);
      assert.equal(classified.status, 'rate-limited');
      assert.equal(classified.authVerified, 'yes');
      assert.notEqual(classified.status, 'unauthorized');
    });

    // 10. Scenario: 500 & 503 Outage -> status provider-unavailable
    await t.test('10. 500 & 503 -> status provider-unavailable', async () => {
      const res500 = await fetch(`http://localhost:${PORT}/v1/chat/completions/500`, { method: 'POST' });
      assert.equal(classifyError(res500.status, await res500.text()).status, 'provider-unavailable');

      const res503 = await fetch(`http://localhost:${PORT}/v1/chat/completions/503`, { method: 'POST' });
      assert.equal(classifyError(res503.status, await res503.text()).status, 'provider-unavailable');
    });

    // 11. Scenario: Timeout via AbortController -> 408 / network-error (timeout)
    await t.test('11. Client Timeout via BrowserApiExecutor -> status 408 & category timeout', async () => {
      const executor = new BrowserApiExecutor();
      const abortCtrl = new AbortController();
      const timer = setTimeout(() => abortCtrl.abort(), 80);

      const apiRes = await executor.execute(
        {
          url: `http://localhost:${PORT}/v1/chat/completions/timeout`,
          method: 'POST',
          headers: { Authorization: 'Bearer {{secret}}' },
        },
        {
          keyId: 'gate-test-key',
          boundHost: 'localhost',
          signal: abortCtrl.signal,
        }
      );
      clearTimeout(timer);

      assert.equal(apiRes.status, 408);
      const classified = classifyError(apiRes.status, apiRes.bodyText);
      assert.equal(classified.category, 'timeout');
      assert.equal(classified.status, 'network-error');
    });

    // 12. Scenario: Malformed HTML/JSON in 200 -> rejected as malformed / error-object
    await t.test('12. Malformed HTML in 200 -> rejected by adapter & validator', async () => {
      const res = await fetch(`http://localhost:${PORT}/v1/chat/completions/malformed`, { method: 'POST' });
      const body = await res.text();
      assert.equal(body.startsWith('<html'), true);
      const openai = new OpenAICompatibleAdapter();
      const parsed = openai.parseGenerate(body);
      assert.equal(parsed.hasErrorObject, true);
      const validation = validateResponse(parsed);
      assert.equal(validation.isValid, false);
    });

    // 13. Scenario: no-CORS variant -> omits CORS headers & opaque failure maps to blocked-or-network
    await t.test('13. no-CORS variant -> omits Access-Control-Allow-Origin & maps opaque error to blocked-or-network', async () => {
      const res = await fetch(`http://localhost:${PORT}/no-cors`, { method: 'GET' });
      assert.equal(res.headers.get('access-control-allow-origin'), null);
      const classifiedOpaque = classifyError(0, 'TypeError: Failed to fetch', true);
      assert.equal(classifiedOpaque.status, 'blocked-or-network');
      assert.equal(classifiedOpaque.category, 'cors-or-network');
      assert.notEqual(classifiedOpaque.status, 'unauthorized');
    });

    // 14. Scenario: Host Binding & Cross-Host Redirect Refusal
    await t.test('14. Host Binding & Redirect Refusal -> refuses mismatched boundHost and HTTP 302 redirects', async () => {
      const executor = new BrowserApiExecutor();

      // (a) Mismatched boundHost is rejected before network call
      await assert.rejects(
        async () => {
          await executor.execute(
            {
              url: `http://localhost:${PORT}/v1/chat/completions/valid`,
              method: 'POST',
              headers: { Authorization: 'Bearer {{secret}}' },
            },
            {
              keyId: 'gate-test-key',
              boundHost: 'api.openai.com',
              signal: new AbortController().signal,
            }
          );
        },
        { message: /Host binding violation/ }
      );

      // (b) HTTP 302 redirect to another host is refused
      await assert.rejects(
        async () => {
          await executor.execute(
            {
              url: `http://localhost:${PORT}/v1/chat/completions/redirect`,
              method: 'POST',
              headers: { Authorization: 'Bearer {{secret}}' },
            },
            {
              keyId: 'gate-test-key',
              boundHost: 'localhost',
              signal: new AbortController().signal,
            }
          );
        },
        { message: /Host binding violation: HTTP redirect/ }
      );
    });

    // 15. Scenario: Modern Unseen Model Detection Regression (§10) & Gemini Header Auth (§11)
    await t.test('15. Modern Unseen Models & Gemini x-goog-api-key Header Validation (§10 & §11)', async () => {
      const executor = new BrowserApiExecutor();
      const geminiProvider = {
        ...BUNDLED_PROVIDERS.find(p => p.id === 'google-gemini')!,
        baseUrl: `http://localhost:${PORT}/v1beta`,
      };
      const geminiAdapter = new GeminiAdapter();

      // (a) Verify buildListModels and buildGenerate use x-goog-api-key header and never ?key= query param
      const listReq = geminiAdapter.buildListModels(geminiProvider)!;
      assert.equal(listReq.url.includes('key='), false);
      assert.equal(listReq.headers['x-goog-api-key'], '{{secret}}');

      const listRes = await executor.execute(listReq, {
        keyId: 'gate-test-key',
        boundHost: 'localhost',
        signal: new AbortController().signal,
      });
      assert.equal(listRes.status, 200);

      // (b) Parse models: unseen 'gemini-9.5-ultra-2029' must be accepted via supportedGenerationMethods=['generateContent'],
      // while 'text-embedding-005', 'gemini-live-2.5-audio', and 'imagen-4.0-generate' are excluded
      const discovered = geminiAdapter.parseModels(listRes.bodyText, geminiProvider);
      const discoveredIds = discovered.map(m => m.id);
      assert.equal(discoveredIds.includes('gemini-9.5-ultra-2029'), true);
      assert.equal(discoveredIds.includes('text-embedding-005'), false);
      assert.equal(discoveredIds.includes('gemini-live-2.5-audio'), false);
      assert.equal(discoveredIds.includes('imagen-4.0-generate'), false);

      // (c) Generate with unseen model 'gemini-9.5-ultra-2029' using maxTokens=256 and 'Hi'
      const genReq = geminiAdapter.buildGenerate(geminiProvider, 'gemini-9.5-ultra-2029', 'Hi', 256);
      assert.equal(genReq.url.includes('key='), false);
      assert.equal(genReq.headers['x-goog-api-key'], '{{secret}}');

      const genRes = await executor.execute(genReq, {
        keyId: 'gate-test-key',
        boundHost: 'localhost',
        signal: new AbortController().signal,
      });
      assert.equal(genRes.status, 200);
      const parsedGen = geminiAdapter.parseGenerate(genRes.bodyText);
      const validatedGen = validateResponse(parsedGen);
      assert.equal(validatedGen.isValid, true);

      // (d) OpenAI-compatible unseen modern models ('gpt-9-omni-preview:free', 'claude-7-sonnet-20280101')
      const openaiAdapter = new OpenAICompatibleAdapter();
      const modernRes = await fetch(`http://localhost:${PORT}/v1/models/modern`);
      const modernBody = await modernRes.text();
      const openRouterProvider = BUNDLED_PROVIDERS.find(p => p.id === 'openrouter')!;
      const modernDiscovered = openaiAdapter.parseModels(modernBody, openRouterProvider);
      const selection = ModelSelector.selectCandidates(openRouterProvider, modernDiscovered);
      assert.equal(selection.selectedModel?.id, 'gpt-9-omni-preview:free');
      assert.equal(selection.candidates.some(c => c.id === 'claude-7-sonnet-20280101'), true);
      assert.equal(selection.candidates.some(c => c.id === 'whisper-large-v9-embedding'), false);

      // (e) Anthropic adapter does NOT unconditionally inject anthropic-dangerous-direct-browser-access
      const anthropicAdapter = new AnthropicCompatibleAdapter();
      const anthReq = anthropicAdapter.buildGenerate(
        { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic-compatible', allowedHosts: ['api.anthropic.com'], source: 'bundled' },
        'claude-7-sonnet-20280101',
        'Hi',
        256
      );
      assert.equal(anthReq.headers['anthropic-dangerous-direct-browser-access'], undefined);
    });

    // 16. Scenario: Canary-Secret Leak Verification (§13A)
    await t.test('16. Canary-Secret Test (§13A) -> zero occurrences of canary or >=6-char substring across all output surfaces', async () => {
      const { ApiTestService } = await import('../services/testService');
      const { ExportService } = await import('../services/exportService');
      const { DiagnosticsBundleService } = await import('../services/diagnosticsBundleService');
      const { RedactorService } = await import('../services/redactor');
      const { maskKey, generateKeyFingerprint } = await import('../services/crypto');

      const canarySecret = 'gsk_9f8e7d6c5b4a3210qW9xZ2mP4kR8vN1jL5tB3yF6hZ987';
      const canaryKeyId = 'canary-gate-key';

      const canaryRecord = {
        id: canaryKeyId,
        providerId: 'groq',
        label: 'Primary Verification Key',
        maskedKey: maskKey(canarySecret),
        keyFingerprint: await generateKeyFingerprint(canarySecret, StorageService.getInstallSalt()),
        boundHost: 'localhost',
        customBaseUrl: `http://localhost:${PORT}/v1`,
        status: 'untested' as const,
        authVerified: 'unknown' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // 1. Add key + secret
      StorageService.saveKeyMetadata(canaryRecord);
      await StorageService.saveSecret(canaryKeyId, canarySecret);

      const groqProvider = {
        ...BUNDLED_PROVIDERS.find(p => p.id === 'groq')!,
        baseUrl: `http://localhost:${PORT}/v1`,
        allowedHosts: ['localhost'],
      };

      // 2. Run working test + failed test + retest against fake server
      await ApiTestService.runVerificationLadder(canaryRecord, groqProvider);
      await ApiTestService.runVerificationLadder(
        { ...canaryRecord, customBaseUrl: `http://localhost:${PORT}/v1/401` },
        { ...groqProvider, baseUrl: `http://localhost:${PORT}/v1/401`, endpoints: { chat: '/chat/completions/401', models: '/models' } }
      );
      await ApiTestService.runVerificationLadder(canaryRecord, groqProvider);

      // 3. Collect all output surfaces:
      // - Key metadata records
      // - Test history records
      // - Masked exports (JSON, CSV, .env)
      // - Diagnostics bundle (JSON + readable text report)
      // - Redacted error/log output
      const keysSurface = JSON.stringify(StorageService.getKeys());
      const historySurface = JSON.stringify(StorageService.getHistory());
      const exportJsonSurface = ExportService.exportJson(false);
      const exportCsvSurface = ExportService.exportCsv();
      const exportEnvSurface = ExportService.exportDotEnv(false);
      const { json: diagJsonSurface, text: diagTextSurface } = DiagnosticsBundleService.generateBundle();
      const logSurface = RedactorService.redactString(
        `Simulated error log with key=${canarySecret} and Authorization: Bearer ${canarySecret}`,
        [canarySecret]
      );

      const allSurfaces = [
        { name: 'keys metadata', content: keysSurface },
        { name: 'test history', content: historySurface },
        { name: 'masked JSON export', content: exportJsonSurface },
        { name: 'masked CSV export', content: exportCsvSurface },
        { name: 'masked .env export', content: exportEnvSurface },
        { name: 'diagnostics bundle JSON', content: diagJsonSurface },
        { name: 'diagnostics bundle text', content: diagTextSurface },
        { name: 'redacted log output', content: logSurface },
      ];

      for (const surface of allSurfaces) {
        const leaked = RedactorService.containsSecretOrSubstring(surface.content, canarySecret, 6);
        assert.equal(
          leaked,
          false,
          `Canary secret or >=6-char substring leaked in surface "${surface.name}": ${surface.content}`
        );
      }
    });
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
});

