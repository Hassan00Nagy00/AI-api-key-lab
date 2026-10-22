import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../services/errorClassifier';
import { BUNDLED_PROVIDERS } from '../providers/catalog';

test('Error Classifier — 401 Unauthorized maps to unauthorized and authVerified=no', () => {
  const res = classifyError(401, '{"error":{"message":"Invalid API key"}}');
  assert.equal(res.status, 'unauthorized');
  assert.equal(res.category, 'auth');
  assert.equal(res.authVerified, 'no');
});

test('Error Classifier — 403 Forbidden maps to forbidden and authVerified=yes', () => {
  const res = classifyError(403, '{"error":{"message":"Permission denied"}}');
  assert.equal(res.status, 'forbidden');
  assert.equal(res.category, 'forbidden');
  assert.equal(res.authVerified, 'yes');
});

test('Error Classifier — 402 Insufficient Credit maps to no-credit and authVerified=yes', () => {
  const res = classifyError(402, '{"error":{"message":"Insufficient quota"}}');
  assert.equal(res.status, 'no-credit');
  assert.equal(res.category, 'insufficient-credit');
  assert.equal(res.authVerified, 'yes');
});

test('Error Classifier — 404 Endpoint Not Found maps to config-error', () => {
  const res = classifyError(404, 'Not Found', false, 'models');
  assert.equal(res.status, 'config-error');
  assert.equal(res.category, 'endpoint-not-found');
});

test('Error Classifier — 404 Model Not Found maps to no-usable-model and authVerified=yes', () => {
  const res = classifyError(404, '{"error":{"message":"The model does not exist or is not found"}}');
  assert.equal(res.status, 'no-usable-model');
  assert.equal(res.category, 'model-not-found');
  assert.equal(res.authVerified, 'yes');
  assert.equal(res.isFallbackWorthy, true);
});

test('Error Classifier — 429 Rate Limit maps to rate-limited and authVerified=yes', () => {
  const res = classifyError(429, '{"error":{"message":"Rate limit exceeded"}}');
  assert.equal(res.status, 'rate-limited');
  assert.equal(res.category, 'rate-limit');
  assert.equal(res.authVerified, 'yes');
  // Must NEVER map 429 to unauthorized
  assert.notEqual(res.status, 'unauthorized');
});

test('Error Classifier — 500, 502, 503, 504 map to provider-unavailable', () => {
  assert.equal(classifyError(500, 'Internal Error').status, 'provider-unavailable');
  assert.equal(classifyError(502, 'Bad Gateway').status, 'provider-unavailable');
  assert.equal(classifyError(503, 'Service Unavailable').status, 'provider-unavailable');
  assert.equal(classifyError(504, 'Gateway Timeout').status, 'provider-unavailable');
});

test('Error Classifier — Browser Opaque Failure maps to blocked-or-network', () => {
  const res = classifyError(0, 'Failed to fetch', true);
  assert.equal(res.status, 'blocked-or-network');
  assert.equal(res.category, 'cors-or-network');
  // Must NEVER map opaque CORS to unauthorized or working
  assert.notEqual(res.status, 'unauthorized');
  assert.notEqual(res.status, 'working');
});

test('Error Classifier — 200 with embedded error object classifies by error code', () => {
  const res = classifyError(200, '{"error":{"code":401,"message":"Token revoked"}}');
  assert.equal(res.status, 'unauthorized');
  assert.equal(res.category, 'auth');
});

test('Error Classifier — Provider Signal Priority (§2): Gemini HTTP 400 API_KEY_INVALID maps to auth -> unauthorized', () => {
  const gemini = BUNDLED_PROVIDERS.find(p => p.id === 'google-gemini')!;
  const gemini400Body = JSON.stringify({
    error: {
      code: 400,
      message: 'API key not valid. Please pass a valid API key.',
      status: 'INVALID_ARGUMENT',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
    },
  });
  const res = classifyError(400, gemini400Body, false, 'generate', 'unknown', gemini.errorSignals);
  assert.equal(res.category, 'auth');
  assert.equal(res.status, 'unauthorized');
  assert.equal(res.authVerified, 'no');
});
