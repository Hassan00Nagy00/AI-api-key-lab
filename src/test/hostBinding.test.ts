import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserApiExecutor } from '../services/executor';
import { StorageService } from '../services/storage';

test('Host Binding — rejects requests when hostname violates boundHost', async () => {
  const executor = new BrowserApiExecutor();
  // Attempt to call evil-server.com while key is bound to api.groq.com
  await assert.rejects(
    async () => {
      await executor.execute(
        {
          url: 'https://evil-server.com/v1/chat/completions',
          method: 'POST',
          headers: {},
        },
        {
          keyId: 'mock-key',
          boundHost: 'api.groq.com',
          signal: new AbortController().signal,
        }
      );
    },
    {
      message: /Host binding violation/,
    }
  );
});

test('Host Binding — rejects URLs with embedded user credentials', async () => {
  const executor = new BrowserApiExecutor();
  await assert.rejects(
    async () => {
      await executor.execute(
        {
          url: 'https://admin:password@api.groq.com/v1/chat/completions',
          method: 'POST',
          headers: {},
        },
        {
          keyId: 'mock-key',
          boundHost: 'api.groq.com',
          signal: new AbortController().signal,
        }
      );
    },
    {
      message: /Embedded credentials/,
    }
  );
});

test('Host Binding — rejects insecure HTTP for remote hosts', async () => {
  const executor = new BrowserApiExecutor();
  await assert.rejects(
    async () => {
      await executor.execute(
        {
          url: 'http://api.groq.com/v1/chat/completions',
          method: 'POST',
          headers: {},
        },
        {
          keyId: 'mock-key',
          boundHost: 'api.groq.com',
          signal: new AbortController().signal,
        }
      );
    },
    {
      message: /Insecure protocol/,
    }
  );
});
