import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelSelector } from '../services/modelSelector';
import { ProviderConfig } from '../types/provider';
import { DiscoveredModel } from '../types/model';

const mockProvider: ProviderConfig = {
  id: 'test-provider',
  name: 'Test Provider',
  protocol: 'openai-compatible',
  allowedHosts: ['api.test.com'],
  excludeModelPatterns: ['embedding', 'tts', 'image'],
  testModelPreference: [
    { modelId: 'flash-lite', verifiedAt: '2026-10-15T00:00:00.000Z' },
    { modelId: '8b', verifiedAt: '2026-10-15T00:00:00.000Z' },
  ],
  cheapPatterns: ['flash-lite', 'flash', 'mini', '8b', 'instant'],
  avoidPatterns: ['pro', 'ultra', 'opus', 'o1', 'o3', 'reasoner', 'thinking', '405b', 'large'],
  models: [
    { id: 'llama-3.3-70b', tier: 'free', recommended: true },
    { id: 'llama-3.1-8b', tier: 'free' },
  ],
  source: 'bundled',
};

const candidateModels: DiscoveredModel[] = [
  {
    id: 'text-embedding-ada-002',
    name: 'Ada Embedding',
    providerId: 'test-provider',
    tier: 'paid',
    tierEvidence: 'none',
    availability: 'available',
    source: 'live',
    discoveredAt: '',
  },
  {
    id: 'tts-1-hd',
    name: 'TTS 1 HD',
    providerId: 'test-provider',
    tier: 'paid',
    tierEvidence: 'none',
    availability: 'available',
    source: 'live',
    discoveredAt: '',
  },
  {
    id: 'llama-3.1-8b',
    name: 'Llama 3.1 8B',
    providerId: 'test-provider',
    tier: 'free',
    tierEvidence: 'registry',
    availability: 'available',
    contextWindow: 128000,
    source: 'live',
    discoveredAt: '',
  },
  {
    id: 'llama-3.3-70b',
    name: 'Llama 3.3 70B',
    providerId: 'test-provider',
    tier: 'free',
    tierEvidence: 'registry',
    availability: 'available',
    contextWindow: 128000,
    source: 'live',
    discoveredAt: '',
  },
];

test('Model Selection — filters out excluded model patterns (embeddings, tts)', () => {
  const result = ModelSelector.selectCandidates(mockProvider, candidateModels);
  const selectedIds = result.candidates.map(c => c.id);
  assert.equal(selectedIds.includes('text-embedding-ada-002'), false);
  assert.equal(selectedIds.includes('tts-1-hd'), false);
  assert.equal(selectedIds.includes('llama-3.3-70b'), true);
});

test('Model Selection — ranks registry-recommended model highest', () => {
  const result = ModelSelector.selectCandidates(mockProvider, candidateModels);
  assert.equal(result.selectedModel?.id, 'llama-3.3-70b');
});

test('Model Selection — user selected model overrides ranking', () => {
  const result = ModelSelector.selectCandidates(
    mockProvider,
    candidateModels,
    'llama-3.1-8b'
  );
  assert.equal(result.selectedModel?.id, 'llama-3.1-8b');
});

test('Model Selection (§2 5a-5d) — when tier is unknown, prefers cheapest-first (testModelPreference/cheapPatterns & smaller context window) and avoids avoidPatterns', () => {
  const unknownTierModels: DiscoveredModel[] = [
    {
      id: 'acme-model-pro-ultra',
      name: 'Acme Pro Ultra',
      providerId: 'test-provider',
      tier: 'unknown',
      tierEvidence: 'none',
      availability: 'available',
      contextWindow: 2000000,
      source: 'live',
      discoveredAt: '',
    },
    {
      id: 'acme-model-standard-128k',
      name: 'Acme Standard 128k',
      providerId: 'test-provider',
      tier: 'unknown',
      tierEvidence: 'none',
      availability: 'available',
      contextWindow: 128000,
      source: 'live',
      discoveredAt: '',
    },
    {
      id: 'acme-model-standard-32k',
      name: 'Acme Standard 32k',
      providerId: 'test-provider',
      tier: 'unknown',
      tierEvidence: 'none',
      availability: 'available',
      contextWindow: 32000,
      source: 'live',
      discoveredAt: '',
    },
    {
      id: 'acme-model-flash-lite',
      name: 'Acme Flash Lite',
      providerId: 'test-provider',
      tier: 'unknown',
      tierEvidence: 'none',
      availability: 'available',
      contextWindow: 64000,
      source: 'live',
      discoveredAt: '',
    },
  ];

  const result = ModelSelector.selectCandidates(mockProvider, unknownTierModels);
  // (5a) flash-lite matches testModelPreference & cheapPatterns -> ranked #1
  assert.equal(result.selectedModel?.id, 'acme-model-flash-lite');
  // (5c) among the two standard models of unknown tier, smaller context window (32k) ranks before larger (128k)
  assert.equal(result.candidates[1]?.id, 'acme-model-standard-32k');
  assert.equal(result.candidates[2]?.id, 'acme-model-standard-128k');
  // (5b) avoidPatterns ('pro', 'ultra') is never auto-selected while non-avoided candidates exist
  assert.equal(result.candidates.some(c => c.id === 'acme-model-pro-ultra'), false);
});

test('Dynamic Model Discovery Merge — marks missing registry models unavailable and new live models isNew', () => {
  const registryList: DiscoveredModel[] = [
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      providerId: 'test-provider',
      tier: 'free',
      tierEvidence: 'registry',
      availability: 'available',
      source: 'registry',
      discoveredAt: '',
    },
    {
      id: 'legacy-decommissioned-model',
      name: 'Legacy Model',
      providerId: 'test-provider',
      tier: 'free',
      tierEvidence: 'registry',
      availability: 'available',
      source: 'registry',
      discoveredAt: '',
    },
  ];

  const liveList: DiscoveredModel[] = [
    {
      id: 'llama-3.3-70b',
      name: 'Llama 3.3 70B',
      providerId: 'test-provider',
      tier: 'unknown',
      tierEvidence: 'none',
      availability: 'available',
      source: 'live',
      discoveredAt: '',
    },
    {
      id: 'brand-new-2029-model',
      name: 'Brand New 2029 Model',
      providerId: 'test-provider',
      tier: 'free',
      tierEvidence: 'provider-api',
      availability: 'available',
      source: 'live',
      discoveredAt: '',
    },
  ];

  const merged = ModelSelector.mergeLiveWithRegistryModels(registryList, liveList, 'test-provider');
  const existing = merged.find(m => m.id === 'llama-3.3-70b')!;
  const missing = merged.find(m => m.id === 'legacy-decommissioned-model')!;
  const brandNew = merged.find(m => m.id === 'brand-new-2029-model')!;

  assert.equal(existing.availability, 'available');
  assert.equal(existing.tier, 'free'); // preserved from registry
  assert.equal(missing.availability, 'unavailable'); // marked unavailable, not deleted
  assert.equal(brandNew.isNew, true); // highlighted as new
});
