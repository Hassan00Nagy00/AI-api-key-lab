import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isBlockedIpAddress,
  validateOutboundUrlSync,
  validateAndResolveOutboundUrl,
} from '../electron/ssrfGuard';
import {
  JsonStore,
  SanitizedLogger,
  redactSecretsFromText,
} from '../electron/jsonStore';
import {
  SecretStore,
  KeychainUnavailableError,
  SafeStorageBackend,
} from '../electron/secretStore';
import { MainProcessExecutor } from '../electron/mainExecutor';
import { IpcController, NativePlatformHooks } from '../electron/ipcHandlers';
import {
  validateExternalOpenUrl,
  verifyIpcSenderOrigin,
} from '../electron/ipcSchemas';
import {
  resolveAppProtocolRequest,
  PACKAGED_CSP,
} from '../electron/protocolHandler';
import { buildMacApplicationMenuTemplate } from '../electron/menu';
import http from 'node:http';
import { createFakeProviderServer } from './fakeProviderServer';
import { classifyError } from '../services/errorClassifier';
import { validateResponse } from '../services/responseValidator';
import { OpenAICompatibleAdapter } from '../adapters/openai';
import { MainNotificationService } from '../electron/notificationService';
import { SchedulerService } from '../services/schedulerService';
import { BudgetService } from '../services/budgetService';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ai-key-lab-${prefix}-`));
}

function createMockKeychainBackend(available = true): SafeStorageBackend {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => {
      // Simulated Keychain encryption (XOR with key + header so ciphertext != plaintext)
      const src = Buffer.from(plainText, 'utf8');
      const out = Buffer.alloc(src.length + 4);
      out.write('KC01', 0, 4, 'ascii');
      for (let i = 0; i < src.length; i++) {
        out[i + 4] = src[i] ^ 0x5a;
      }
      return out;
    },
    decryptString: (encrypted: Buffer) => {
      const header = encrypted.subarray(0, 4).toString('ascii');
      if (header !== 'KC01') {
        throw new Error('Invalid Keychain ciphertext header');
      }
      const payload = encrypted.subarray(4);
      const out = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        out[i] = payload[i] ^ 0x5a;
      }
      return out.toString('utf8');
    },
  };
}

test('P3-1: SSRF Guard — Private IPs, Metadata 169.254.169.254, Loopback, IPv4-mapped IPv6, and DNS Rebinding', async () => {
  // 1. Private RFC1918 ranges
  assert.equal(isBlockedIpAddress('10.0.0.1').blocked, true);
  assert.equal(isBlockedIpAddress('172.16.0.1').blocked, true);
  assert.equal(isBlockedIpAddress('172.31.255.255').blocked, true);
  assert.equal(isBlockedIpAddress('192.168.1.50').blocked, true);

  // 2. Cloud Metadata & Link-local (169.254.0.0/16) — blocked even if allowLoopback=true
  assert.equal(isBlockedIpAddress('169.254.169.254', { allowLoopback: true }).blocked, true);
  assert.equal(isBlockedIpAddress('169.254.0.1', { allowLoopback: true }).blocked, true);

  // 3. CGNAT, 0.0.0.0/8, Multicast
  assert.equal(isBlockedIpAddress('100.64.1.1').blocked, true);
  assert.equal(isBlockedIpAddress('0.0.0.0').blocked, true);
  assert.equal(isBlockedIpAddress('224.0.0.1').blocked, true);

  // 4. Loopback (blocked by default, allowed ONLY with allowLoopback=true)
  assert.equal(isBlockedIpAddress('127.0.0.1').blocked, true);
  assert.equal(isBlockedIpAddress('::1').blocked, true);
  assert.equal(isBlockedIpAddress('127.0.0.1', { allowLoopback: true }).blocked, false);
  assert.equal(isBlockedIpAddress('::1', { allowLoopback: true }).blocked, false);

  // 5. IPv6 Unique-Local (fc00::/7) and Link-Local (fe80::/10)
  assert.equal(isBlockedIpAddress('fc00::1').blocked, true);
  assert.equal(isBlockedIpAddress('fd12:3456:789a::1').blocked, true);
  assert.equal(isBlockedIpAddress('fe80::1').blocked, true);

  // 6. IPv4-mapped IPv6 addresses (dotted & hex-word notations)
  assert.equal(isBlockedIpAddress('::ffff:127.0.0.1').blocked, true);
  assert.equal(isBlockedIpAddress('::ffff:169.254.169.254', { allowLoopback: true }).blocked, true);
  assert.equal(isBlockedIpAddress('::ffff:10.0.0.1').blocked, true);
  assert.equal(isBlockedIpAddress('::ffff:7f00:1').blocked, true); // 127.0.0.1 in hex words
  assert.equal(isBlockedIpAddress('::ffff:a9fe:a9fe').blocked, true); // 169.254.169.254 in hex words

  // 7. Public IPv4 and IPv6 allowed
  assert.equal(isBlockedIpAddress('104.18.7.192').blocked, false);
  assert.equal(isBlockedIpAddress('2606:4700::6812:7c0').blocked, false);

  // 8. Local HTTP provider consent enforcement
  const noConsentLocal = validateOutboundUrlSync('http://localhost:11434/v1/models', {
    boundHost: 'localhost',
    providerId: 'ollama',
    allowLocalProviderHttp: false,
  });
  assert.equal(noConsentLocal.valid, false);

  const withConsentLocal = validateOutboundUrlSync('http://localhost:11434/v1/models', {
    boundHost: 'localhost',
    providerId: 'ollama',
    allowLocalProviderHttp: true,
  });
  assert.equal(withConsentLocal.valid, true);

  // Non-local provider trying to use http://localhost even with flag is rejected
  const remoteProviderOnLocalhost = validateOutboundUrlSync('http://localhost:11434/v1/models', {
    boundHost: 'localhost',
    providerId: 'openai',
    allowLocalProviderHttp: true,
  });
  assert.equal(remoteProviderOnLocalhost.valid, false);

  // 9. Connect-time DNS Rebinding Protection
  const rebindToLoopback = await validateAndResolveOutboundUrl(
    'https://rebind.attacker.example/v1/chat/completions',
    {
      boundHost: 'rebind.attacker.example',
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    }
  );
  assert.equal(rebindToLoopback.valid, false);
  if (!rebindToLoopback.valid) {
    assert.match(rebindToLoopback.error, /DNS rebinding \/ SSRF blocked/);
  }

  const rebindToMetadata = await validateAndResolveOutboundUrl(
    'https://metadata-rebind.example/v1/models',
    {
      boundHost: 'metadata-rebind.example',
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
    }
  );
  assert.equal(rebindToMetadata.valid, false);
});

test('P3-2: Keychain SecretStore — Encryption, Fail-Closed on Unavailable Keychain, and Startup Reconciliation', () => {
  const tempDir = createTempDir('secretstore');
  try {
    // 1. Encrypt & Decrypt with available Keychain
    const store = new SecretStore(tempDir, createMockKeychainBackend(true));
    store.saveSecret('key-1', 'sk-super-secret-apple-silicon-999');

    const vaultPath = path.join(tempDir, 'secrets.vault.json');
    const rawVaultText = fs.readFileSync(vaultPath, 'utf8');
    assert.equal(rawVaultText.includes('sk-super-secret-apple-silicon-999'), false);
    assert.equal(store.getSecret('key-1'), 'sk-super-secret-apple-silicon-999');

    // 2. Fail-Closed when safeStorage.isEncryptionAvailable() is false
    const unavailableStore = new SecretStore(tempDir, createMockKeychainBackend(false));
    assert.throws(
      () => unavailableStore.saveSecret('key-2', 'sk-should-never-persist'),
      (err: unknown) => err instanceof KeychainUnavailableError && err.code === 'ERR_KEYCHAIN_UNAVAILABLE'
    );
    assert.throws(
      () => unavailableStore.getSecret('key-1'),
      (err: unknown) => err instanceof KeychainUnavailableError && err.code === 'ERR_KEYCHAIN_UNAVAILABLE'
    );

    // 3. Startup Reconciliation: removes orphan secrets & marks missing secrets
    store.saveSecret('orphan-secret-id', 'sk-orphan-value');
    const reconciled = store.reconcileWithMetadata([
      {
        id: 'key-1',
        label: 'Valid Key',
        providerId: 'openai',
        boundHost: 'api.openai.com',
        keyFingerprint: 'fp1',
        maskedKey: 'sk-••••999',
        status: 'working',
        authVerified: 'yes',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'key-missing-secret',
        label: 'Missing Secret Key',
        providerId: 'groq',
        boundHost: 'api.groq.com',
        keyFingerprint: 'fp2',
        maskedKey: 'gsk_••••123',
        status: 'working',
        authVerified: 'yes',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    assert.equal(reconciled.orphanSecretsRemoved, 1);
    assert.equal(store.hasSecret('orphan-secret-id'), false);
    assert.equal(reconciled.missingSecretsCount, 1);

    const missingMeta = reconciled.reconciledMeta.find((k) => k.id === 'key-missing-secret')!;
    assert.equal(missingMeta.secretMissing, true);
    assert.equal(missingMeta.status, 'untested');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('P3-3: JsonStore Atomic Persistence, Corrupted File Recovery, and SanitizedLogger Redaction', () => {
  const tempDir = createTempDir('jsonstore');
  try {
    const logger = new SanitizedLogger(path.join(tempDir, 'logs'));
    const jsonStore = new JsonStore(tempDir, logger);

    // 1. Atomic write and read
    const settings = jsonStore.read('settings');
    assert.equal(settings.language, 'en');
    jsonStore.write('settings', { ...settings, language: 'ar' });
    assert.equal(jsonStore.read('settings').language, 'ar');

    // 2. Corrupted JSON file recovery
    const keysMetaPath = jsonStore.getFilePath('keys_meta');
    fs.writeFileSync(keysMetaPath, '{corrupted json file!!!', 'utf8');

    const recoveredKeys = jsonStore.read('keys_meta');
    assert.deepEqual(recoveredKeys, []);
    assert.ok(jsonStore.getCorruptionNotice()?.includes('keys_meta.corrupt.'));

    // Verify backup .corrupt.<ts>.json exists on disk
    const filesInDir = fs.readdirSync(tempDir);
    assert.equal(filesInDir.some((f) => f.startsWith('keys_meta.corrupt.')), true);

    // 3. SanitizedLogger redacts raw secrets and API key patterns
    logger.log(
      'ERROR',
      'Request failed with Authorization: Bearer sk-proj-1234567890abcdef and key AIzaSyD9876543210abcdef',
      { customSecret: 'my-raw-custom-secret-token' },
      ['my-raw-custom-secret-token']
    );

    const logContent = fs.readFileSync(logger.getLogPath(), 'utf8');
    assert.equal(logContent.includes('sk-proj-1234567890abcdef'), false);
    assert.equal(logContent.includes('AIzaSyD9876543210abcdef'), false);
    assert.equal(logContent.includes('my-raw-custom-secret-token'), false);
    assert.equal(logContent.includes('[REDACTED]'), true);
    assert.equal(logContent.includes('[REDACTED_SECRET]'), true);

    logger.clearLogs();
    assert.equal(fs.readFileSync(logger.getLogPath(), 'utf8'), '');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('P3-4: IPC Controller, Preload Contract Invariants, Clipboard Auto-Clear, Protocol Containment, and Menu', async () => {
  const tempDir = createTempDir('ipc');
  try {
    const logger = new SanitizedLogger(path.join(tempDir, 'logs'));
    const jsonStore = new JsonStore(tempDir, logger);
    const secretStore = new SecretStore(tempDir, createMockKeychainBackend(true), logger);
    const executor = new MainProcessExecutor({ secretStore, jsonStore, logger });

    let clipboardValue = '';
    let confirmResponse = true;

    const platform: NativePlatformHooks = {
      getAppVersion: () => '1.0.0',
      isPackaged: () => true,
      confirmSensitiveAction: async () => confirmResponse,
      writeClipboardText: (txt) => {
        clipboardValue = txt;
      },
      readClipboardText: () => clipboardValue,
      showSaveDialog: async () => ({ canceled: false, filePath: path.join(tempDir, 'export.json') }),
      showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(tempDir, 'export.json')] }),
      openExternalUrl: async () => {},
    };

    const controller = new IpcController({
      jsonStore,
      secretStore,
      executor,
      logger,
      platform,
    });

    // 1. keysSave stores secret in Keychain and returns KeyMeta WITHOUT secret
    const savedMeta = await controller.keysSave({
      providerId: 'groq',
      label: 'Prod Groq Key',
      secret: 'gsk_live_secret_never_echoed_12345',
    });
    assert.equal('secret' in savedMeta, false);
    assert.equal(savedMeta.boundHost, 'api.groq.com');
    assert.equal(savedMeta.status, 'untested');

    // 2. keysList returns metadata only (no secret property)
    const listed = await controller.keysList();
    assert.equal(listed.length, 1);
    assert.equal('secret' in listed[0], false);

    // 3. keysCopySecret writes to clipboard in Main and clears after timeout if unchanged
    const copyRes = await controller.keysCopySecret(savedMeta.id, 40);
    assert.equal(copyRes.copied, true);
    assert.equal(clipboardValue, 'gsk_live_secret_never_echoed_12345');
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(clipboardValue, '');

    // If user copies something else before timeout, clipboard is NOT overwritten
    await controller.keysCopySecret(savedMeta.id, 50);
    clipboardValue = 'user-copied-other-text';
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(clipboardValue, 'user-copied-other-text');

    // 4. keysRevealSecret is gated on confirmation
    confirmResponse = false;
    await assert.rejects(() => controller.keysRevealSecret(savedMeta.id), /User canceled secret reveal/);
    confirmResponse = true;
    const revealed = await controller.keysRevealSecret(savedMeta.id);
    assert.equal(revealed.secret, 'gsk_live_secret_never_echoed_12345');
    assert.equal(revealed.expiresAfterMs, 15000);

    // 5. External URL validation
    assert.equal(validateExternalOpenUrl('https://platform.openai.com/docs').valid, true);
    assert.equal(validateExternalOpenUrl('http://platform.openai.com/docs').valid, false);
    assert.equal(validateExternalOpenUrl('file:///etc/passwd').valid, false);
    assert.equal(validateExternalOpenUrl('javascript:alert(1)').valid, false);
    assert.equal(validateExternalOpenUrl('https://169.254.169.254/latest').valid, false);

    // 6. Sender Frame Origin Verification
    assert.equal(verifyIpcSenderOrigin('app://-/dashboard', { isPackaged: true }).valid, true);
    assert.equal(verifyIpcSenderOrigin('https://evil.example.com', { isPackaged: true }).valid, false);

    // 7. Custom app:// Protocol Handler path-traversal containment and SPA fallback
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><title>App</title>', 'utf8');

    const spaRoute = resolveAppProtocolRequest('app://-/keys/working', distDir);
    assert.equal(spaRoute.status, 200);
    assert.equal(spaRoute.filePath, path.join(distDir, 'index.html'));
    assert.equal(spaRoute.headers['Content-Security-Policy'], PACKAGED_CSP);

    const traversal = resolveAppProtocolRequest('app://-/..%2F..%2Fetc%2Fpasswd', distDir);
    assert.equal(traversal.status, 403);

    // 8. Bilingual Menu Template contains full Edit roles
    const enMenu = buildMacApplicationMenuTemplate('en', { onNavigate: () => {}, onMenuAction: () => {} });
    const arMenu = buildMacApplicationMenuTemplate('ar', { onNavigate: () => {}, onMenuAction: () => {} });
    assert.equal(enMenu.length, 7);
    assert.equal(arMenu.length, 7);
    const editSubmenu = (enMenu[2] as any).submenu as any[];
    const roles = editSubmenu.filter((i) => i.role).map((i) => i.role);
    assert.deepEqual(roles, ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('P3-5: MainProcessExecutor Working-State Regressions & Native No-CORS Execution (§18, §20)', async (t) => {
  const PORT = 4555;
  const server = createFakeProviderServer(PORT);
  await new Promise<void>((resolve) => server.listen(PORT, () => resolve()));

  const tempDir = createTempDir('main-executor');
  try {
    const logger = new SanitizedLogger(path.join(tempDir, 'logs'));
    const jsonStore = new JsonStore(tempDir, logger);
    const secretStore = new SecretStore(tempDir, createMockKeychainBackend(true), logger);

    // Save key metadata and secret in Keychain
    const keyId = 'desktop-test-key-1';
    const rawSecret = 'sk-desktop-secret-value-7777';
    secretStore.saveSecret(keyId, rawSecret);
    jsonStore.write('keys_meta', [
      {
        id: keyId,
        label: 'Local Fake Provider Key',
        providerId: 'ollama',
        boundHost: 'localhost',
        keyFingerprint: 'fp-local',
        maskedKey: 'sk-••••7777',
        status: 'untested',
        authVerified: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    // Grant local consent for ollama:localhost
    jsonStore.write('local_consents', { 'ollama:localhost': true });

    const mainExecutor = new MainProcessExecutor({
      secretStore,
      jsonStore,
      logger,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });

    // 1. Valid 200 generation -> working
    await t.test('1. MainProcessExecutor 200 valid generation -> working & late secret bound', async () => {
      const res = await mainExecutor.executeRequest({
        requestId: 'req-valid',
        keyId,
        url: `http://localhost:${PORT}/v1/chat/completions/valid`,
        method: 'POST',
        headers: { Authorization: 'Bearer {{secret}}' },
        timeoutMs: 5000,
      });
      assert.equal(res.status, 200);
      const openai = new OpenAICompatibleAdapter();
      const parsed = openai.parseGenerate(res.bodyText);
      const val = validateResponse(parsed);
      assert.equal(val.isValid, true);
    });

    // 2. 200 Empty response -> empty-response (NOT working)
    await t.test('2. MainProcessExecutor 200 empty output -> empty-response (never working)', async () => {
      const res = await mainExecutor.executeRequest({
        requestId: 'req-empty',
        keyId,
        url: `http://localhost:${PORT}/v1/chat/completions/empty`,
        method: 'POST',
        headers: { Authorization: 'Bearer {{secret}}' },
        timeoutMs: 5000,
      });
      assert.equal(res.status, 200);
      const openai = new OpenAICompatibleAdapter();
      const val = validateResponse(openai.parseGenerate(res.bodyText));
      assert.equal(val.isValid, false);
      if (!val.isValid) assert.equal(val.category, 'empty-response');
    });

    // 3. 200 with embedded error object -> rejected & classified as rate-limited
    await t.test('3. MainProcessExecutor 200 with embedded error object -> classified by error code', async () => {
      const res = await mainExecutor.executeRequest({
        requestId: 'req-err-in-200',
        keyId,
        url: `http://localhost:${PORT}/v1/chat/completions/error-object`,
        method: 'POST',
        headers: { Authorization: 'Bearer {{secret}}' },
        timeoutMs: 5000,
      });
      assert.equal(res.status, 200);
      const openai = new OpenAICompatibleAdapter();
      const val = validateResponse(openai.parseGenerate(res.bodyText));
      assert.equal(val.isValid, false);
      const classified = classifyError(res.status, res.bodyText);
      assert.equal(classified.status, 'rate-limited');
    });

    // 4. 401 Invalid key -> unauthorized
    await t.test('4. MainProcessExecutor 401 -> unauthorized (authVerified=no)', async () => {
      const res = await mainExecutor.executeRequest({
        requestId: 'req-401',
        keyId,
        url: `http://localhost:${PORT}/v1/chat/completions/401`,
        method: 'POST',
        headers: { Authorization: 'Bearer {{secret}}' },
        timeoutMs: 5000,
      });
      const classified = classifyError(res.status, res.bodyText);
      assert.equal(classified.status, 'unauthorized');
      assert.equal(classified.authVerified, 'no');
    });

    // 5. 429 Rate limited -> rate-limited (authVerified=yes)
    await t.test('5. MainProcessExecutor 429 -> rate-limited (authVerified=yes)', async () => {
      const res = await mainExecutor.executeRequest({
        requestId: 'req-429',
        keyId,
        url: `http://localhost:${PORT}/v1/chat/completions/429`,
        method: 'POST',
        headers: { Authorization: 'Bearer {{secret}}' },
        timeoutMs: 5000,
      });
      const classified = classifyError(res.status, res.bodyText);
      assert.equal(classified.status, 'rate-limited');
      assert.equal(classified.authVerified, 'yes');
    });

    // 6. Host mismatch refused BEFORE sending secret
    await t.test('6. MainProcessExecutor refuses mismatched boundHost before sending secret', async () => {
      await assert.rejects(
        () =>
          mainExecutor.executeRequest({
            requestId: 'req-mismatch',
            keyId,
            boundHost: 'api.openai.com',
            url: `http://localhost:${PORT}/v1/chat/completions/valid`,
            method: 'POST',
            headers: { Authorization: 'Bearer {{secret}}' },
            timeoutMs: 5000,
          }),
        /Host binding violation/
      );
    });

    // 7. 302 Redirect to another host refused
    await t.test('7. MainProcessExecutor refuses HTTP 302 redirect to prevent secret exfiltration', async () => {
      await assert.rejects(
        () =>
          mainExecutor.executeRequest({
            requestId: 'req-redirect',
            keyId,
            url: `http://localhost:${PORT}/v1/chat/completions/redirect`,
            method: 'POST',
            headers: { Authorization: 'Bearer {{secret}}' },
            timeoutMs: 5000,
          }),
        /Host binding violation: HTTP redirect/
      );
    });

    // 8. Browser-CORS-blocked endpoint (/no-cors) succeeds natively in MainProcessExecutor!
    await t.test('8. Provider without CORS headers (/no-cors) succeeds natively via MainProcessExecutor', async () => {
      const res = await mainExecutor.executeRequest({
        requestId: 'req-no-cors',
        keyId,
        url: `http://localhost:${PORT}/no-cors`,
        method: 'GET',
        headers: { Authorization: 'Bearer {{secret}}' },
        timeoutMs: 5000,
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers['access-control-allow-origin'], undefined);
      const openai = new OpenAICompatibleAdapter();
      const parsed = openai.parseGenerate(res.bodyText);
      const val = validateResponse(parsed);
      assert.equal(val.isValid, true);
    });

    // 9. Streaming execution and cancellation
    await t.test('9. MainProcessExecutor streaming emits chunks and done event', async () => {
      const events: string[] = [];
      await mainExecutor.startStream(
        {
          requestId: 'stream-1',
          keyId,
          url: `http://localhost:${PORT}/v1/chat/completions/valid`,
          method: 'POST',
          headers: { Authorization: 'Bearer {{secret}}' },
          timeoutMs: 5000,
        },
        (ev) => {
          events.push(ev.type);
        }
      );
      assert.equal(events.includes('chunk'), true);
      assert.equal(events[events.length - 1], 'done');
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('P3-6: Proxy / VPN Detection, Connect-Time Guarded Lookup, and Local Proxy Fixture (§0A.2 & §5)', async () => {
  const TARGET_PORT = 4561;
  const PROXY_PORT = 4562;
  const targetServer = createFakeProviderServer(TARGET_PORT);
  await new Promise<void>((resolve) => targetServer.listen(TARGET_PORT, () => resolve()));

  let proxyHitCount = 0;
  const proxyServer = http.createServer((req, res) => {
    proxyHitCount++;
    // Forward HTTP request through local proxy fixture to targetServer
    const targetUrl = new URL(req.url || '/', `http://127.0.0.1:${TARGET_PORT}`);
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port: TARGET_PORT,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: req.headers,
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    req.pipe(proxyReq);
  });
  await new Promise<void>((resolve) => proxyServer.listen(PROXY_PORT, '127.0.0.1', () => resolve()));

  const tempDir = createTempDir('proxy-vpn');
  try {
    const logger = new SanitizedLogger(path.join(tempDir, 'logs'));
    const jsonStore = new JsonStore(tempDir, logger);
    const secretStore = new SecretStore(tempDir, createMockKeychainBackend(true), logger);

    const keyId = 'proxy-test-key';
    secretStore.saveSecret(keyId, 'sk-proxy-secret-8888');
    jsonStore.write('keys_meta', [
      {
        id: keyId,
        label: 'Proxy Test Key',
        providerId: 'ollama',
        boundHost: 'localhost',
        keyFingerprint: 'fp-proxy',
        maskedKey: 'sk-••••8888',
        status: 'untested',
        authVerified: 'unknown',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    jsonStore.write('local_consents', { 'ollama:localhost': true });

    // 1. DIRECT mode: resolveProxy returns DIRECT -> no proxy diagnostic
    const directExecutor = new MainProcessExecutor({
      secretStore,
      jsonStore,
      logger,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
      resolveProxy: async () => 'DIRECT',
    });
    const directCheck = await directExecutor.checkSystemProxy(`http://localhost:${TARGET_PORT}`);
    assert.equal(directCheck.isProxied, false);
    assert.equal(directCheck.diagnostic, null);

    // 2. Connect-time DNS rebinding block inside undici Agent lookup
    const rebindingExecutor = new MainProcessExecutor({
      secretStore,
      jsonStore,
      logger,
      // Pre-resolution and connect-time lookup return cloud metadata IP 169.254.169.254
      dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
      resolveProxy: async () => 'DIRECT',
    });
    await assert.rejects(
      () =>
        rebindingExecutor.executeRequest({
          requestId: 'req-rebind-block',
          keyId,
          url: `http://localhost:${TARGET_PORT}/v1/chat/completions/valid`,
          method: 'POST',
          headers: { Authorization: 'Bearer {{secret}}' },
          timeoutMs: 4000,
        }),
      /DNS rebinding \/ SSRF blocked/
    );

    // 3. System proxy detected when useSystemProxy is OFF -> emits diagnostic warning
    const proxyDetectedExecutor = new MainProcessExecutor({
      secretStore,
      jsonStore,
      logger,
      dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
      resolveProxy: async () => `PROXY 127.0.0.1:${PROXY_PORT}`,
    });
    const proxyCheck = await proxyDetectedExecutor.checkSystemProxy(`http://localhost:${TARGET_PORT}`);
    assert.equal(proxyCheck.isProxied, true);
    assert.equal(proxyCheck.diagnostic, 'A system proxy is configured; direct connections may fail');
    assert.equal(proxyCheck.proxyUri, `http://127.0.0.1:${PROXY_PORT}`);

    const directWithWarningRes = await proxyDetectedExecutor.executeRequest({
      requestId: 'req-direct-with-proxy-warn',
      keyId,
      url: `http://localhost:${TARGET_PORT}/v1/chat/completions/valid`,
      method: 'POST',
      headers: { Authorization: 'Bearer {{secret}}' },
      timeoutMs: 5000,
    });
    assert.equal(directWithWarningRes.status, 200);
    assert.equal(
      directWithWarningRes.headers['x-keylab-proxy-diagnostic'],
      'A system proxy is configured; direct connections may fail'
    );
    assert.equal(proxyHitCount, 0);

    // 4. Optional setting "Use system proxy" ON -> routes through undici ProxyAgent & marks weaker connect-time IP guarantee
    const currentSettings = jsonStore.read('settings');
    jsonStore.write('settings', { ...currentSettings, useSystemProxy: true });

    const viaProxyRes = await proxyDetectedExecutor.executeRequest({
      requestId: 'req-via-system-proxy',
      keyId,
      url: `http://localhost:${TARGET_PORT}/v1/chat/completions/valid`,
      method: 'POST',
      headers: { Authorization: 'Bearer {{secret}}' },
      timeoutMs: 5000,
    });
    assert.equal(viaProxyRes.status, 200);
    assert.equal(proxyHitCount > 0, true);
    assert.equal(
      viaProxyRes.headers['x-keylab-proxy-mode'],
      'system-proxy-weaker-connect-ip-guarantee'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    await new Promise<void>((resolve) => targetServer.close(() => resolve()));
  }
});

test('P3-7: Main-Process Notifications with Ad-Hoc Signature In-App Banner Fallback & Secret Redaction (§0A.3)', () => {
  const tempDir = createTempDir('notifications');
  try {
    const logger = new SanitizedLogger(path.join(tempDir, 'logs'));
    const shownNative: { title: string; body: string }[] = [];
    const fallbackBanners: { title: string; body: string; reason: string }[] = [];

    // 1. Native main-process Notification supported
    const nativeSvc = new MainNotificationService({
      backend: {
        isSupported: () => true,
        show: (opts) => shownNative.push(opts),
      },
      logger,
      onInAppBanner: (b) => fallbackBanners.push(b),
    });

    const res1 = nativeSvc.dispatchAlert(
      'expiry-alert',
      'API Key Expiring in 3 Days',
      'Key Groq Prod (gsk_secret_token_1234567890abcdef) expires soon.',
      ['gsk_secret_token_1234567890abcdef']
    );
    assert.equal(res1.deliveredVia, 'native-main-notification');
    assert.equal(res1.body.includes('gsk_secret_token_1234567890abcdef'), false);
    assert.equal(shownNative.length, 1);
    assert.equal(fallbackBanners.length, 0);

    // 2. Ad-hoc signature / unsupported Notification -> falls back to in-app banner
    const fallbackSvc = new MainNotificationService({
      backend: {
        isSupported: () => false,
        show: () => {
          throw new Error('Should not be called when unsupported');
        },
      },
      logger,
      onInAppBanner: (b) => fallbackBanners.push(b),
    });

    const res2 = fallbackSvc.dispatchAlert(
      'model-watch-alert',
      'Model Watch Daily Digest',
      'Groq: +1 new model (llama-4-scout)'
    );
    assert.equal(res2.deliveredVia, 'in-app-banner-fallback');
    assert.ok(res2.fallbackReason?.includes('ad-hoc signature'));
    assert.equal(fallbackBanners.length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('P3-8: Unified Scheduler (Off by Default, Tier-0 Model Watch, Skips Expired & Unauthorized) and Main-Process Budget Guard (§0A.1 & §0A.4)', async () => {
  BudgetService.resetCounters();

  // 1. Interval normalization: default 24 h, minimum 6 h
  assert.equal(SchedulerService.normalizeModelWatchIntervalHours(undefined), 24);
  assert.equal(SchedulerService.normalizeModelWatchIntervalHours(2), 6);
  assert.equal(SchedulerService.normalizeModelWatchIntervalHours(12), 12);

  // 2. Scheduler is off by default
  SchedulerService.stop();
  assert.deepEqual(SchedulerService.isRunning(), { healthRunning: false, modelWatchRunning: false });

  const now = new Date('2026-10-22T12:00:00.000Z');
  const keys = [
    {
      id: 'k-unauth',
      providerId: 'groq',
      label: 'Unauthorized Groq Key',
      maskedKey: 'gsk_••••0001',
      keyFingerprint: 'fp-1',
      boundHost: 'api.groq.com',
      status: 'unauthorized' as const,
      authVerified: 'no' as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'k-expired',
      providerId: 'groq',
      label: 'Expired Groq Key',
      maskedKey: 'gsk_••••0002',
      keyFingerprint: 'fp-2',
      boundHost: 'api.groq.com',
      status: 'working' as const,
      authVerified: 'yes' as const,
      expiresAt: '2026-10-01T00:00:00.000Z',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'k-valid-1',
      providerId: 'groq',
      label: 'Valid Groq Key 1',
      maskedKey: 'gsk_••••0003',
      keyFingerprint: 'fp-3',
      boundHost: 'api.groq.com',
      status: 'working' as const,
      authVerified: 'yes' as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'k-valid-2',
      providerId: 'groq',
      label: 'Valid Groq Key 2 (same provider)',
      maskedKey: 'gsk_••••0004',
      keyFingerprint: 'fp-4',
      boundHost: 'api.groq.com',
      status: 'working' as const,
      authVerified: 'yes' as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ];

  // 3. Health check skips unauthorized and expired keys
  const healthReport = await SchedulerService.runHealthCheckPass({
    keys,
    now,
    forceRun: true,
    runTestFn: async () => ({ status: 'working' }),
  });
  assert.deepEqual(healthReport.skippedUnauthorizedKeyIds, ['k-unauth']);
  assert.deepEqual(healthReport.skippedExpiredKeyIds, ['k-expired']);
  assert.deepEqual(healthReport.checkedKeyIds, ['k-valid-1', 'k-valid-2']);

  // 4. Model Watch (Tier 0 only) skips unauthorized & expired, and selects ONE key per provider
  const watchReport = await SchedulerService.runModelWatchPass({
    keys,
    now,
    forceRun: true,
    fetchTier0ModelsFn: async () => [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B',
        providerId: 'groq',
        tier: 'free',
        tierEvidence: 'registry',
        availability: 'available',
        source: 'live',
        discoveredAt: now.toISOString(),
      },
    ],
  });
  assert.deepEqual(watchReport.skippedUnauthorizedKeyIds, ['k-unauth']);
  assert.deepEqual(watchReport.skippedExpiredKeyIds, ['k-expired']);
  assert.deepEqual(watchReport.checkedProviders, ['groq']);
  assert.equal(watchReport.selectedKeysByProvider['groq'], 'k-valid-1');

  // 5. Main-process executor enforces Budget Guard when enforceBudgetGuard is set (§0A.1)
  const tempDir = createTempDir('budget-main');
  try {
    const logger = new SanitizedLogger(path.join(tempDir, 'logs'));
    const jsonStore = new JsonStore(tempDir, logger);
    const secretStore = new SecretStore(tempDir, createMockKeychainBackend(true), logger);
    const executor = new MainProcessExecutor({ secretStore, jsonStore, logger });

    const curSettings = jsonStore.read('settings');
    jsonStore.write('settings', { ...curSettings, dailyGenerationCapPerKey: 1 });
    BudgetService.resetCounters();

    // Consume the 1 allowed generation for 'k-budget-cap'
    assert.equal(BudgetService.checkAndConsumeGeneration('k-budget-cap').allowed, true);

    await assert.rejects(
      () =>
        executor.executeRequest(
          {
            requestId: 'req-over-budget',
            keyId: 'k-budget-cap',
            url: 'https://api.groq.com/openai/v1/chat/completions',
            method: 'POST',
            headers: { Authorization: 'Bearer {{secret}}' },
            timeoutMs: 3000,
          },
          { enforceBudgetGuard: 'generation' }
        ),
      /Budget Guard hard-stop/
    );
  } finally {
    BudgetService.resetCounters();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

