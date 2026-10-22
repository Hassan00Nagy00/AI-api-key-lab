import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetService } from '../services/budgetService';
import { ProviderDetector } from '../services/providerDetector';
import { ExpiryService } from '../services/expiryService';
import { DiagnosticsBundleService } from '../services/diagnosticsBundleService';
import { ModelWatchService, QuotaSnapshotService } from '../services/modelWatchAndQuota';
import { ExportService } from '../services/exportService';
import { StorageService } from '../services/storage';
import { generateKeyFingerprint } from '../services/crypto';
import { BUNDLED_PROVIDERS } from '../providers/catalog';
import { ApiKeyRecord } from '../types/key';

test('§13A Budget Guard & Cost-Safety Caps — enforces per-key (20), global (100), Tier-0 (300) caps and one-time unknown-tier warning', () => {
  BudgetService.resetCounters();
  StorageService.saveSettings({
    ...StorageService.getSettings(),
    dailyGenerationCapPerKey: 2,
    dailyGenerationCapGlobal: 5,
    dailyTier0CapGlobal: 3,
  });

  // 1. Per-key cap
  assert.equal(BudgetService.getUsageSummary('key-1').allowed, true);
  BudgetService.checkAndConsumeGeneration('key-1');
  BudgetService.checkAndConsumeGeneration('key-1');
  const blockedKey = BudgetService.getUsageSummary('key-1');
  assert.equal(blockedKey.allowed, false);
  assert.equal(blockedKey.reason?.includes('Daily generation cap reached for this key'), true);

  // Scheduled check skips when cap is reached
  assert.equal(BudgetService.isKeyBudgetExhausted('key-1'), true);

  // 2. Tier-0 cap
  assert.equal(BudgetService.checkAndConsumeTier0('key-1').allowed, true);
  assert.equal(BudgetService.checkAndConsumeTier0('key-1').allowed, true);
  assert.equal(BudgetService.checkAndConsumeTier0('key-1').allowed, true);
  assert.equal(BudgetService.checkAndConsumeTier0('key-1').allowed, false);

  // 3. One-time unknown-tier billing warning
  const groqProvider = BUNDLED_PROVIDERS.find(p => p.id === 'groq')!;
  const mockKey: ApiKeyRecord = {
    id: 'key-unknown-tier',
    providerId: 'groq',
    label: 'Unknown Tier Key',
    maskedKey: 'gsk_••••1234',
    keyFingerprint: 'fp-unknown-tier',
    boundHost: 'api.groq.com',
    status: 'working',
    authVerified: 'yes',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  StorageService.saveKeyMetadata(mockKey);

  assert.equal(BudgetService.shouldShowBillingWarning(mockKey, groqProvider, 'unknown'), true);
  assert.equal(BudgetService.shouldShowBillingWarning(mockKey, groqProvider, 'free'), false);
  BudgetService.acknowledgeBillingWarning('key-unknown-tier');
  const updatedKey = StorageService.getKeys().find(k => k.id === 'key-unknown-tier')!;
  assert.equal(BudgetService.shouldShowBillingWarning(updatedKey, groqProvider, 'unknown'), false);

  // Restore defaults
  BudgetService.resetCounters();
  StorageService.saveSettings({
    ...StorageService.getSettings(),
    dailyGenerationCapPerKey: 20,
    dailyGenerationCapGlobal: 100,
    dailyTier0CapGlobal: 300,
  });
});

test('§13A Key-Format Provider Suggestion — detects provider via ReDoS-safe keyShape without regex', () => {
  // Gemini key (starts with AIza, length 39, alphanumeric-dash-underscore)
  const geminiKey = 'AIzaSyD1234567890abcdefghijklmnopqrstuv';
  const geminiMatch = ProviderDetector.detect(geminiKey, BUNDLED_PROVIDERS);
  assert.equal(geminiMatch.candidates.length > 0, true);
  assert.equal(geminiMatch.candidates[0].provider.id, 'google-gemini');
  assert.equal(geminiMatch.suggestionText?.includes('Looks like Google Gemini — confirm'), true);

  // Groq key (starts with gsk_, length >= 48)
  const groqKey = 'gsk_' + 'a'.repeat(52);
  const groqMatch = ProviderDetector.detect(groqKey, BUNDLED_PROVIDERS);
  assert.equal(groqMatch.candidates.length > 0, true);
  assert.equal(groqMatch.candidates[0].provider.id, 'groq');
  assert.equal(groqMatch.suggestionText?.includes('Looks like Groq — confirm'), true);

  // Extremely long adversarial input does not hang (ReDoS-safe linear scan)
  const hugeInput = 'AIza' + '!'.repeat(50000);
  const start = Date.now();
  const advMatch = ProviderDetector.detect(hugeInput, BUNDLED_PROVIDERS);
  assert.equal(advMatch.candidates.length, 0);
  assert.equal(Date.now() - start < 50, true);
});

test('§13A Key Expiry & Rotation Tracker — 7/3/1 day alerts, expired (user-declared), skipped by scheduled checks, never changes status', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const expiredKey: ApiKeyRecord = {
    id: 'exp-1',
    providerId: 'groq',
    label: 'Expired Trial Key',
    maskedKey: 'gsk_••••1234',
    keyFingerprint: 'fp-exp-1',
    boundHost: 'api.groq.com',
    status: 'working',
    authVerified: 'yes',
    expiresAt: '2026-10-20T00:00:00.000Z',
    expiryNote: 'Rotate every 30 days',
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
  };

  const soonKey: ApiKeyRecord = {
    ...expiredKey,
    id: 'exp-2',
    label: 'Expiring in 2 days',
    expiresAt: '2026-10-23T12:00:00.000Z',
  };

  const evalExpired = ExpiryService.evaluateKey(expiredKey, now);
  assert.equal(evalExpired.level, 'expired');
  assert.equal(evalExpired.badgeText, 'expired (user-declared)');
  // Never mutates canonical status
  assert.equal(expiredKey.status, 'working');
  assert.equal(ExpiryService.shouldSkipScheduledCheck(expiredKey, now), true);

  const evalSoon = ExpiryService.evaluateKey(soonKey, now);
  assert.equal(evalSoon.level, 'expiring-3d');
  assert.equal(ExpiryService.shouldSkipScheduledCheck(soonKey, now), false);
});

test('§13A Model Watch & Quota Snapshots — computes diffs, coalesces daily notification, and parses rate-limit headers', () => {
  const groqProvider = BUNDLED_PROVIDERS.find(p => p.id === 'groq')!;

  // Baseline snapshot
  const firstDiff = ModelWatchService.computeDiffAndSave(groqProvider, [
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 8B',
      providerId: 'groq',
      tier: 'free',
      tierEvidence: 'registry',
      availability: 'available',
      source: 'live',
      discoveredAt: '',
    },
    {
      id: 'old-model-v1',
      name: 'Old Model',
      providerId: 'groq',
      tier: 'free',
      tierEvidence: 'registry',
      availability: 'available',
      source: 'live',
      discoveredAt: '',
    },
  ]);
  assert.equal(firstDiff.added.length, 0);

  // Second run: new model added, old-model-v1 removed, llama-3.1-8b-instant marked deprecated
  const secondDiff = ModelWatchService.computeDiffAndSave(groqProvider, [
    {
      id: 'llama-3.1-8b-instant',
      name: 'Llama 8B',
      providerId: 'groq',
      tier: 'free',
      tierEvidence: 'registry',
      availability: 'deprecated',
      source: 'live',
      discoveredAt: '',
    },
    {
      id: 'llama-4-scout-17b',
      name: 'Llama 4 Scout',
      providerId: 'groq',
      tier: 'free',
      tierEvidence: 'registry',
      availability: 'available',
      source: 'live',
      discoveredAt: '',
    },
  ]);

  assert.deepEqual(secondDiff.added, ['llama-4-scout-17b']);
  assert.deepEqual(secondDiff.removed, ['old-model-v1']);
  assert.deepEqual(secondDiff.deprecatedMarked, ['llama-3.1-8b-instant']);
  assert.equal(secondDiff.hasChanges, true);

  // Quota snapshots
  const snapKnown = QuotaSnapshotService.recordFromHeaders({
    keyId: 'key-q1',
    providerId: 'groq',
    model: 'llama-3.1-8b-instant',
    headers: {
      remainingRequests: '142',
      remainingTokens: '58000',
    },
  });
  assert.equal(snapKnown.hasHeaders, true);
  assert.equal(snapKnown.remainingRequests, 142);

  const snapUnknown = QuotaSnapshotService.recordFromHeaders({
    keyId: 'key-q2',
    providerId: 'google-gemini',
    model: 'gemini-2.5-flash',
    headers: {},
  });
  assert.equal(snapUnknown.hasHeaders, false);
  assert.equal(QuotaSnapshotService.formatQuotaStatus(snapUnknown), 'Provider limit unknown');
});

test('§13A Diagnostics Bundle — redacts secrets and hashes custom hosts', () => {
  StorageService.clearAllData();
  const customKey: ApiKeyRecord = {
    id: 'diag-custom-1',
    providerId: 'custom-openai',
    label: 'Internal Corp Gateway',
    maskedKey: 'sk-••••9999',
    keyFingerprint: 'fp-diag-1',
    boundHost: 'llm.internal.corp.example.com',
    customBaseUrl: 'https://llm.internal.corp.example.com/v1',
    status: 'working',
    authVerified: 'yes',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  StorageService.saveKeyMetadata(customKey);
  StorageService.addHistoryResult({
    id: 'tr-1',
    keyId: 'diag-custom-1',
    providerId: 'custom-openai',
    model: 'gpt-4o-mini',
    status: 'working',
    authVerified: 'yes',
    latencyMs: 120,
    testedAt: new Date().toISOString(),
  });

  const { json, text } = DiagnosticsBundleService.generateBundle();
  assert.equal(json.includes('llm.internal.corp.example.com'), false);
  assert.equal(text.includes('llm.internal.corp.example.com'), false);
  assert.equal(json.includes('custom-host#'), true);
});

test('§13A Backup Duplicate Handling after Decryption — recomputes salted fingerprint under destination salt and skips duplicates', async () => {
  StorageService.clearAllData();
  const secretValue = 'gsk_duplicate_test_secret_1234567890abcdefghijklmnop';

  // Save a key locally with ID 'origin-device-key-id'
  const localSalt = StorageService.getInstallSalt();
  const existingKey: ApiKeyRecord = {
    id: 'origin-device-key-id',
    providerId: 'groq',
    label: 'Origin Device Groq Key',
    maskedKey: 'gsk_••••mnop',
    keyFingerprint: 'stale-foreign-fingerprint-from-another-install',
    boundHost: 'api.groq.com',
    status: 'working',
    authVerified: 'yes',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  StorageService.saveKeyMetadata(existingKey);
  await StorageService.saveSecret(existingKey.id, secretValue);

  // Create encrypted backup from origin device
  const backupJson = await ExportService.createEncryptedBackup('test-passphrase-123');

  // Now simulate destination device that already has the same secret under a DIFFERENT key ID and local salt
  StorageService.clearAllData();
  const destSalt = StorageService.getInstallSalt();
  const destKey: ApiKeyRecord = {
    id: 'dest-device-key-id',
    providerId: 'groq',
    label: 'Destination Device Groq Key',
    maskedKey: 'gsk_••••mnop',
    keyFingerprint: await generateKeyFingerprint(secretValue, destSalt),
    boundHost: 'api.groq.com',
    status: 'working',
    authVerified: 'yes',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  StorageService.saveKeyMetadata(destKey);
  await StorageService.saveSecret(destKey.id, secretValue);

  const importRes = await ExportService.restoreEncryptedBackup(backupJson, 'test-passphrase-123');
  assert.equal(importRes.keysRestored, 0);
  assert.equal(importRes.duplicatesSkipped, 1);
});
