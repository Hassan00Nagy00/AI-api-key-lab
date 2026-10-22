import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import {
  canonicalizeJson,
  signCanonicalRegistryPayload,
  SignedRegistryManager,
  verifyDetachedEd25519Signature,
} from '../electron/signedRegistry';
import { LeakHunterService, maskLeakedSecret } from '../electron/leakHunter';
import {
  buildGatewayClientSnippets,
  hasBrowserOriginHeaders,
  isValidLocalGatewayHostHeader,
  LocalGatewayService,
} from '../electron/localGateway';
import { JsonStore, SanitizedLogger } from '../electron/jsonStore';
import { SecretStore, SafeStorageBackend } from '../electron/secretStore';
import { MainProcessExecutor } from '../electron/mainExecutor';
import { BUNDLED_PROVIDERS } from '../providers/catalog';
import { KeyMeta } from '../types/electron';

function createMockKeychainAdapter(): SafeStorageBackend {

  const prefix = Buffer.from('KEYCHAIN_ENC_V1:', 'utf8');
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.concat([prefix, Buffer.from(plain, 'utf8')]),
    decryptString: (cipher: Buffer) => {
      const str = cipher.toString('utf8');
      if (!str.startsWith('KEYCHAIN_ENC_V1:')) {
        throw new Error('Failed to decrypt');
      }
      return str.slice('KEYCHAIN_ENC_V1:'.length);
    },
  };
}

describe('Phase 4 Add-ons — Signed Registry, Leak Hunter, and Local Gateway', () => {
  let tempDir: string;
  let logsDir: string;
  let logger: SanitizedLogger;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aikl-phase4-test-'));
    logsDir = path.join(tempDir, 'logs');
    logger = new SanitizedLogger(logsDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // =========================================================================
  // ADD-ON A: SIGNED REGISTRY UPDATES
  // =========================================================================
  describe('ADD-ON A — Signed Registry Updates (Ed25519)', () => {
    const keyPair = crypto.generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    it('1. Canonicalizes JSON deterministically and verifies valid detached Ed25519 signature', () => {
      const docA = {
        releasedAt: '2026-05-01T00:00:00.000Z',
        registryVersion: 2,
        providers: [
          {
            id: 'groq',
            name: 'Groq Cloud Updated',
            protocol: 'openai-compatible' as const,
            baseUrl: 'https://api.groq.com/openai/v1',
            allowedHosts: ['api.groq.com'],
            source: 'remote' as const,
          },
        ],
      };
      // Same object with keys in different order
      const docB = {
        providers: docA.providers,
        registryVersion: 2,
        releasedAt: '2026-05-01T00:00:00.000Z',
      };

      const canonA = canonicalizeJson(docA);
      const canonB = canonicalizeJson(docB);
      assert.equal(canonA, canonB, 'Canonical JSON must be identical regardless of property order');

      const sig = signCanonicalRegistryPayload(canonA, keyPair.privateKey);
      assert.equal(verifyDetachedEd25519Signature(canonA, sig, keyPair.publicKey), true);

      const manager = new SignedRegistryManager({
        userDataDir: tempDir,
        publicKeyPem: keyPair.publicKey,
        logger,
      });

      const res = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: canonA,
        signatureBase64: sig,
        storedKeys: [],
      });

      assert.equal(res.applied, true);
      assert.equal(res.status, 'applied');
      assert.equal(res.activeVersion, 2);
      assert.equal(res.activeSource, 'verified-remote');
      assert.ok(fs.existsSync(path.join(tempDir, 'verified_registry.json')));
    });

    it('2. Rejects unsigned, badly signed, or non-https registries before parsing/merging', () => {
      const manager = new SignedRegistryManager({
        userDataDir: tempDir,
        publicKeyPem: keyPair.publicKey,
        logger,
      });

      const validPayload = canonicalizeJson({
        registryVersion: 2,
        releasedAt: '2026-05-01T00:00:00.000Z',
        providers: BUNDLED_PROVIDERS.slice(0, 2),
      });
      const validSig = signCanonicalRegistryPayload(validPayload, keyPair.privateKey);

      // Non-HTTPS URL rejected
      const nonHttpsRes = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'http://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: validPayload,
        signatureBase64: validSig,
        storedKeys: [],
      });
      assert.equal(nonHttpsRes.applied, false);
      assert.equal(nonHttpsRes.errorCode, 'NON_HTTPS_URL');
      assert.equal(nonHttpsRes.activeVersion, 1);

      // Unsigned rejected
      const unsignedRes = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: validPayload,
        signatureBase64: '',
        storedKeys: [],
      });
      assert.equal(unsignedRes.applied, false);
      assert.equal(unsignedRes.errorCode, 'MISSING_SIGNATURE');

      // Bad signature / tampered payload rejected BEFORE JSON.parse
      const tamperedJson = validPayload.replace('"registryVersion":2', '"registryVersion":99');
      const badSigRes = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: tamperedJson,
        signatureBase64: validSig,
        storedKeys: [],
      });
      assert.equal(badSigRes.applied, false);
      assert.equal(badSigRes.errorCode, 'INVALID_SIGNATURE');
      assert.equal(badSigRes.activeVersion, 1);
    });

    it('3. Enforces strictly increasing registryVersion (blocks downgrade / replay attacks)', () => {
      const manager = new SignedRegistryManager({
        userDataDir: tempDir,
        publicKeyPem: keyPair.publicKey,
        logger,
      });

      const v3Payload = canonicalizeJson({
        registryVersion: 3,
        releasedAt: '2026-05-03T00:00:00.000Z',
        providers: BUNDLED_PROVIDERS.slice(0, 2),
      });
      const v3Sig = signCanonicalRegistryPayload(v3Payload, keyPair.privateKey);

      const applyV3 = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v3/registry.json',
        rawCanonicalJson: v3Payload,
        signatureBase64: v3Sig,
        storedKeys: [],
      });
      assert.equal(applyV3.applied, true);
      assert.equal(applyV3.activeVersion, 3);

      // Attempt downgrade to v2 with a valid signature
      const v2Payload = canonicalizeJson({
        registryVersion: 2,
        releasedAt: '2026-05-02T00:00:00.000Z',
        providers: BUNDLED_PROVIDERS.slice(0, 2),
      });
      const v2Sig = signCanonicalRegistryPayload(v2Payload, keyPair.privateKey);

      const downgradeRes = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: v2Payload,
        signatureBase64: v2Sig,
        storedKeys: [],
      });

      assert.equal(downgradeRes.applied, false);
      assert.equal(downgradeRes.errorCode, 'REGISTRY_ROLLBACK_DETECTED');
      assert.equal(downgradeRes.activeVersion, 3, 'Active version must remain at v3');
    });

    it('4. Blocks remote registry from changing allowedHosts of a provider with stored keys without user approval', () => {
      const manager = new SignedRegistryManager({
        userDataDir: tempDir,
        publicKeyPem: keyPair.publicKey,
        logger,
      });

      // User has a stored key for groq bound to api.groq.com
      const storedKeys: KeyMeta[] = [
        {
          id: 'key-groq-1',
          label: 'My Groq Key',
          providerId: 'groq',
          boundHost: 'api.groq.com',
          keyFingerprint: 'fp-123',
          maskedKey: 'gsk_••••1234',
          status: 'working',
          authVerified: 'yes',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      // Signed remote registry v2 attempts to change groq allowedHosts to evil-redirect.groq.example.com
      const tamperedHostDoc = {
        registryVersion: 2,
        releasedAt: '2026-05-05T00:00:00.000Z',
        providers: [
          {
            id: 'groq',
            name: 'Groq',
            protocol: 'openai-compatible' as const,
            baseUrl: 'https://evil-redirect.groq.example.com/v1',
            allowedHosts: ['evil-redirect.groq.example.com'],
            source: 'remote' as const,
          },
        ],
      };
      const canon = canonicalizeJson(tamperedHostDoc);
      const sig = signCanonicalRegistryPayload(canon, keyPair.privateKey);

      const res = manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: canon,
        signatureBase64: sig,
        storedKeys,
      });

      assert.equal(res.status, 'pending_host_approval');
      assert.equal(res.pendingHostChanges.length, 1);
      assert.equal(res.pendingHostChanges[0].providerId, 'groq');
      assert.deepEqual(res.pendingHostChanges[0].currentHosts, ['api.groq.com']);
      assert.deepEqual(res.pendingHostChanges[0].proposedHosts, ['evil-redirect.groq.example.com']);

      // Verify active groq provider STILL has original ['api.groq.com']
      const activeGroqBefore = res.providers.find((p) => p.id === 'groq')!;
      assert.deepEqual(activeGroqBefore.allowedHosts, ['api.groq.com']);

      // Now explicitly approve the host change
      const approvedRes = manager.approvePendingHostChange('groq');
      assert.equal(approvedRes.status, 'applied');
      assert.equal(approvedRes.pendingHostChanges.length, 0);
      const activeGroqAfter = approvedRes.providers.find((p) => p.id === 'groq')!;
      assert.deepEqual(activeGroqAfter.allowedHosts, ['evil-redirect.groq.example.com']);
    });

    it('5. Falls back cleanly to last verified registry on disk when offline', async () => {
      const manager = new SignedRegistryManager({
        userDataDir: tempDir,
        publicKeyPem: keyPair.publicKey,
        logger,
      });

      // Apply v2 first so it persists to verified_registry.json
      const v2Canon = canonicalizeJson({
        registryVersion: 2,
        releasedAt: '2026-05-02T00:00:00.000Z',
        providers: BUNDLED_PROVIDERS.slice(0, 3),
      });
      const v2Sig = signCanonicalRegistryPayload(v2Canon, keyPair.privateKey);
      manager.verifyAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v2/registry.json',
        rawCanonicalJson: v2Canon,
        signatureBase64: v2Sig,
        storedKeys: [],
      });

      // Create a fresh manager instance and simulate offline network failure
      const offlineManager = new SignedRegistryManager({
        userDataDir: tempDir,
        publicKeyPem: keyPair.publicKey,
        logger,
      });

      const fallbackRes = await offlineManager.fetchAndApplyRemoteRegistry({
        sourceUrl: 'https://registry.aiapikeylab.com/v3/registry.json',
        storedKeys: [],
        fetchFn: async () => {
          throw new Error('ENOTFOUND registry.aiapikeylab.com');
        },
      });

      assert.equal(fallbackRes.status, 'offline_fallback');
      assert.equal(fallbackRes.usedOfflineFallback, true);
      assert.equal(fallbackRes.activeVersion, 2);
      assert.equal(fallbackRes.activeSource, 'verified-disk');
    });
  });

  // =========================================================================
  // ADD-ON B: LEAK HUNTER
  // =========================================================================
  describe('ADD-ON B — Leak Hunter (Opt-In Folder Scanner, Zero-Secret Retention)', () => {
    it('6. Detects fake keys matching patterns, skips node_modules/.git/binary/>1MB, warns on .git, and never logs or returns raw secrets', () => {
      const projectDir = path.join(tempDir, 'sample-repo');
      fs.mkdirSync(projectDir, { recursive: true });
      // Create .git folder to trigger Git history warning
      fs.mkdirSync(path.join(projectDir, '.git'), { recursive: true });

      const fakeGroqKey = 'gsk_1234567890abcdef1234567890abcdef1234567890abcdef7F3A';
      const fakeGeminiKey = 'AIzaSyD1234567890abcdef1234567890abc9B2C';
      const fakeOpenAiKey = 'sk-proj-1234567890abcdef1234567890abcdef1234567890abcdef4D1E';
      const ignoredNodeModulesKey = 'gsk_999999999999999999999999999999999999999999999999AAAA';

      // 1. Source file with two leaked keys
      const envFile = path.join(projectDir, 'config.ts');
      fs.writeFileSync(
        envFile,
        `// Developer config\nconst GROQ = "${fakeGroqKey}";\nconst GEMINI = "${fakeGeminiKey}";\n`,
        'utf8'
      );

      // 2. Ignored node_modules file (must be skipped)
      const nmDir = path.join(projectDir, 'node_modules', 'some-pkg');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, 'index.js'), `const k = "${ignoredNodeModulesKey}";\n`, 'utf8');

      // 3. Binary file containing a key (must be skipped due to NUL byte)
      const binFile = path.join(projectDir, 'bundle.dat');
      const binBuf = Buffer.concat([
        Buffer.from([0x00, 0x01, 0x02, 0x00]),
        Buffer.from(`const k = "${fakeOpenAiKey}";`, 'utf8'),
      ]);
      fs.writeFileSync(binFile, binBuf);

      // 4. Oversized > 1MB file containing a key (must be skipped)
      const bigFile = path.join(projectDir, 'large.txt');
      fs.writeFileSync(bigFile, 'A'.repeat(1024 * 1024 + 100) + ` ${fakeOpenAiKey}\n`, 'utf8');

      const scanner = new LeakHunterService({ userDataDir: tempDir, logger });
      const report = scanner.scanExplicitFolders([projectDir]);

      assert.equal(report.containsGitRepo, true);
      assert.ok(report.gitWarning && report.gitWarning.includes('Git repository detected'));
      assert.equal(report.filesScanned, 1, 'Only config.ts should be scanned; node_modules, binary, and >1MB skipped');
      assert.equal(report.findings.length, 2, 'Must detect Groq and Gemini keys in config.ts');

      const groqFinding = report.findings.find((f) => f.providerId === 'groq')!;
      assert.ok(groqFinding);
      assert.equal(groqFinding.lineNumber, 2);
      assert.equal(groqFinding.maskedFingerprint, 'gsk_••••7F3A');

      const geminiFinding = report.findings.find((f) => f.providerId === 'google-gemini')!;
      assert.ok(geminiFinding);
      assert.equal(geminiFinding.lineNumber, 3);
      assert.equal(geminiFinding.maskedFingerprint, 'AIza••••9B2C');

      // Mark finding as rotated
      const rotRes = scanner.markFindingRotated(groqFinding.id, true);
      assert.equal(rotRes.rotated, true);

      // Verify zero raw secrets in report JSON, rotated_leaks.json, or app.log
      const reportSerialized = JSON.stringify(report);
      const logContent = fs.existsSync(logger.getLogPath())
        ? fs.readFileSync(logger.getLogPath(), 'utf8')
        : '';
      const rotatedDisk = fs.readFileSync(path.join(tempDir, 'rotated_leaks.json'), 'utf8');

      for (const rawSecret of [fakeGroqKey, fakeGeminiKey, fakeOpenAiKey, ignoredNodeModulesKey]) {
        assert.equal(
          reportSerialized.includes(rawSecret),
          false,
          `Scan report must NEVER contain raw secret ${maskLeakedSecret(rawSecret)}`
        );
        assert.equal(
          logContent.includes(rawSecret),
          false,
          `Application logs must NEVER contain raw secret ${maskLeakedSecret(rawSecret)}`
        );
        assert.equal(
          rotatedDisk.includes(rawSecret),
          false,
          `rotated_leaks.json must NEVER contain raw secret ${maskLeakedSecret(rawSecret)}`
        );
      }
    });
  });

  // =========================================================================
  // ADD-ON C: LOCAL GATEWAY
  // =========================================================================
  describe('ADD-ON C — Local Gateway (127.0.0.1 OpenAI-Compatible Endpoint)', () => {
    it('7. Enforces Bearer token auth, Host header validation, Browser Origin rejection, 429 key failover, request budget cap, and zero secret leakage', async () => {
      const jsonStore = new JsonStore(tempDir, logger);
      const secretStore = new SecretStore(tempDir, createMockKeychainAdapter(), logger);

      // Create two fake upstream provider HTTP servers on 127.0.0.1:
      // Upstream 1 returns 429 Rate Limit; Upstream 2 returns 200 OK completion.
      let upstream1Calls = 0;
      let upstream2Calls = 0;

      const upstream1 = http.createServer((_req, res) => {
        upstream1Calls++;
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Rate limit reached on key 1' } }));
      });

      const upstream2 = http.createServer((req, res) => {
        upstream2Calls++;
        const auth = req.headers['authorization'] || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'chatcmpl-upstream2',
            object: 'chat.completion',
            created: 1710000000,
            model: 'llama-3.3-70b-versatile',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: `Failover succeeded via upstream 2 (auth=${auth ? 'present' : 'missing'})`,
                },
                finish_reason: 'stop',
              },
            ],
          })
        );
      });

      await new Promise<void>((r) => upstream1.listen(0, '127.0.0.1', () => r()));
      await new Promise<void>((r) => upstream2.listen(0, '127.0.0.1', () => r()));

      const port1 = (upstream1.address() as any).port;
      const port2 = (upstream2.address() as any).port;

      const rawProviderSecret1 = 'sk-local-upstream-secret-key-NUMBER-ONE-9999';
      const rawProviderSecret2 = 'sk-local-upstream-secret-key-NUMBER-TWO-8888';

      secretStore.saveSecret('key-1', rawProviderSecret1);
      secretStore.saveSecret('key-2', rawProviderSecret2);

      // Store two working keys for local provider ('ollama' allows http://127.0.0.1 with local_consents)
      jsonStore.write('local_consents', { 'ollama:127.0.0.1': true });
      jsonStore.write('keys_meta', [
        {
          id: 'key-1',
          label: 'Primary Rate-Limited Key',
          providerId: 'ollama',
          boundHost: '127.0.0.1',
          customBaseUrl: `http://127.0.0.1:${port1}/v1`,
          keyFingerprint: 'fp-1',
          maskedKey: 'sk-••••9999',
          status: 'working',
          authVerified: 'yes',
          selectedModel: 'llama-3.3-70b-versatile',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'key-2',
          label: 'Secondary Healthy Key',
          providerId: 'ollama',
          boundHost: '127.0.0.1',
          customBaseUrl: `http://127.0.0.1:${port2}/v1`,
          keyFingerprint: 'fp-2',
          maskedKey: 'sk-••••8888',
          status: 'working',
          authVerified: 'yes',
          selectedModel: 'llama-3.3-70b-versatile',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const executor = new MainProcessExecutor({
        secretStore,
        jsonStore,
        logger,
      });

      const gateway = new LocalGatewayService({
        userDataDir: tempDir,
        jsonStore,
        secretStore,
        executor,
        logger,
      });

      // Configure priority order ['key-1', 'key-2'] and budget = 2 requests
      gateway.updateConfig({
        priorityKeyIds: ['key-1', 'key-2'],
        enableAutomaticFailover: true,
        maxRequestsBudget: 2,
        resetBudgetUsage: true,
      });

      // Disabled by default
      assert.equal(gateway.getStatus().running, false);

      // Start on ephemeral loopback port
      const startedStatus = await gateway.start(0);
      assert.equal(startedStatus.running, true);
      assert.equal(startedStatus.bindAddress, '127.0.0.1');
      const gwPort = startedStatus.port;
      const gwToken = gateway.getRawGatewayToken();
      assert.ok(gwToken.startsWith('aklg_'));

      // Helper for raw HTTP calls to Local Gateway
      const sendGatewayRequest = (opts: {
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        body?: string;
      }): Promise<{ status: number; bodyText: string; headers: http.IncomingHttpHeaders }> => {
        return new Promise((resolve, reject) => {
          const req = http.request(
            {
              hostname: '127.0.0.1',
              port: gwPort,
              method: opts.method || 'POST',
              path: opts.path || '/v1/chat/completions',
              headers: opts.headers || {},
            },
            (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () =>
                resolve({
                  status: res.statusCode || 0,
                  bodyText: Buffer.concat(chunks).toString('utf8'),
                  headers: res.headers,
                })
              );
            }
          );
          req.on('error', reject);
          if (opts.body) req.write(opts.body);
          req.end();
        });
      };

      try {
        // A. Wrong / missing Bearer token -> 401
        const badTokenRes = await sendGatewayRequest({
          headers: {
            Host: `127.0.0.1:${gwPort}`,
            Authorization: 'Bearer wrong_token_value',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }),
        });
        assert.equal(badTokenRes.status, 401);
        assert.ok(badTokenRes.bodyText.includes('INVALID_GATEWAY_TOKEN'));

        // B. Wrong Host header (DNS rebinding attempt) -> 403
        assert.equal(isValidLocalGatewayHostHeader('attacker-rebind.com', gwPort), false);
        const badHostRes = await sendGatewayRequest({
          headers: {
            Host: 'attacker-rebind.com',
            Authorization: `Bearer ${gwToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }),
        });
        assert.equal(badHostRes.status, 403);
        assert.ok(badHostRes.bodyText.includes('INVALID_HOST_HEADER'));

        // C. Browser Origin header -> 403
        assert.equal(hasBrowserOriginHeaders({ origin: 'https://malicious.example.com' }), true);
        const browserOriginRes = await sendGatewayRequest({
          headers: {
            Host: `127.0.0.1:${gwPort}`,
            Origin: 'https://malicious.example.com',
            Authorization: `Bearer ${gwToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'auto', messages: [{ role: 'user', content: 'Hi' }] }),
        });
        assert.equal(browserOriginRes.status, 403);
        assert.ok(browserOriginRes.bodyText.includes('BROWSER_ORIGIN_REJECTED'));

        // D. Valid request -> key-1 returns 429 -> automatic failover to key-2 -> returns 200 OK!
        const secretPrompt = 'SENSITIVE_USER_PROMPT_DO_NOT_LOG_987654';
        const failoverRes = await sendGatewayRequest({
          headers: {
            Host: `127.0.0.1:${gwPort}`,
            Authorization: `Bearer ${gwToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: secretPrompt }],
          }),
        });
        assert.equal(failoverRes.status, 200);
        assert.equal(upstream1Calls, 1, 'Primary key-1 should have been tried first');
        assert.equal(upstream2Calls, 1, 'Secondary key-2 should have been used via automatic 429 failover');
        const parsedCompletion = JSON.parse(failoverRes.bodyText);
        assert.ok(
          parsedCompletion.choices[0].message.content.includes('Failover succeeded via upstream 2')
        );

        // E. Second valid request consumes remaining budget (2/2)
        const secondRes = await sendGatewayRequest({
          headers: {
            Host: `127.0.0.1:${gwPort}`,
            Authorization: `Bearer ${gwToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: 'Second request' }],
          }),
        });
        assert.equal(secondRes.status, 200);

        // F. Third request exceeds maxRequestsBudget (2) -> 429 GATEWAY_BUDGET_EXCEEDED
        const budgetExceededRes = await sendGatewayRequest({
          headers: {
            Host: `127.0.0.1:${gwPort}`,
            Authorization: `Bearer ${gwToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: 'Third request over budget' }],
          }),
        });
        assert.equal(budgetExceededRes.status, 429);
        assert.ok(budgetExceededRes.bodyText.includes('GATEWAY_BUDGET_EXCEEDED'));

        // G. Verify client snippets and zero secret / prompt leakage in responses and logs
        const snippets = buildGatewayClientSnippets(gwPort);
        assert.equal(snippets.curl.includes(rawProviderSecret1), false);
        assert.equal(snippets.curl.includes(rawProviderSecret2), false);

        const statusSnapshot = gateway.getStatus();
        const snapshotStr = JSON.stringify(statusSnapshot);
        const appLogStr = fs.existsSync(logger.getLogPath())
          ? fs.readFileSync(logger.getLogPath(), 'utf8')
          : '';

        for (const forbidden of [
          rawProviderSecret1,
          rawProviderSecret2,
          gwToken,
          secretPrompt,
          'Failover succeeded via upstream 2',
        ]) {
          assert.equal(
            snapshotStr.includes(forbidden),
            false,
            `Gateway status/activity log must NEVER contain "${forbidden}"`
          );
          assert.equal(
            appLogStr.includes(forbidden),
            false,
            `Sanitized app.log must NEVER contain "${forbidden}"`
          );
        }
        assert.equal(failoverRes.bodyText.includes(rawProviderSecret1), false);
        assert.equal(failoverRes.bodyText.includes(rawProviderSecret2), false);
      } finally {
        await gateway.stop();
        await new Promise<void>((r) => upstream1.close(() => r()));
        await new Promise<void>((r) => upstream2.close(() => r()));
      }
    });
  });
});
