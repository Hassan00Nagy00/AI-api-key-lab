import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResponse } from '../services/responseValidator';

test('Response Validation — valid visible text passes', () => {
  const result = validateResponse({
    visibleText: 'Hello there!',
    finishReason: 'stop',
  });
  assert.equal(result.isValid, true);
  if (result.isValid) {
    assert.equal(result.visibleText, 'Hello there!');
  }
});

test('Response Validation — empty output produces empty-response failure', () => {
  const result = validateResponse({
    visibleText: '   ',
    finishReason: 'stop',
  });
  assert.equal(result.isValid, false);
  if (!result.isValid) {
    assert.equal(result.category, 'empty-response');
  }
});

test('Response Validation — reasoning-only with length finish requires retry', () => {
  const result = validateResponse({
    visibleText: '',
    reasoningText: 'Thinking through problem...',
    finishReason: 'length',
  });
  assert.equal(result.isValid, false);
  if (!result.isValid) {
    assert.equal(result.category, 'reasoning-retry-needed');
  }
});

test('Response Validation — reasoning-only with stop finish passes with warning', () => {
  const result = validateResponse({
    visibleText: '',
    reasoningText: 'Full thought completed with no text part.',
    finishReason: 'stop',
  });
  assert.equal(result.isValid, true);
  if (result.isValid) {
    assert.equal(result.reasoningOnlyWarning, true);
  }
});

test('Response Validation — embedded error object fails validation', () => {
  const result = validateResponse({
    visibleText: '',
    hasErrorObject: true,
    errorMessage: 'Quota exhausted',
  });
  assert.equal(result.isValid, false);
  if (!result.isValid) {
    assert.equal(result.category, 'error-object');
  }
});
