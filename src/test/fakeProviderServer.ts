import http from 'http';

export function createFakeProviderServer(port: number = 4444): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    const pathname = url.pathname;

    // Set CORS headers by default unless endpoint is /no-cors
    if (pathname !== '/no-cors') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Scenarios per §9
    if (pathname === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            { id: 'fake-model-1', name: 'Fake Model 1', context_length: 32768 },
            { id: 'fake-model-2', name: 'Fake Model 2', context_length: 65536 },
          ],
        })
      );
      return;
    }

    // 200 valid generation
    if (pathname === '/v1/chat/completions/valid') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: 'Hello! I am a verified AI response.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 10, total_tokens: 12 },
        })
      );
      return;
    }

    // 200 empty output
    if (pathname === '/v1/chat/completions/empty') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        })
      );
      return;
    }

    // 200 with embedded error object
    if (pathname === '/v1/chat/completions/error-object') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { code: 429, message: 'Rate limit exceeded inside 200' },
        })
      );
      return;
    }

    // 200 reasoning-only output
    if (pathname === '/v1/chat/completions/reasoning-only') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: '', reasoning_content: 'Deep reasoning trace without final answer' },
              finish_reason: 'stop',
            },
          ],
        })
      );
      return;
    }

    // 401 Unauthorized
    if (pathname === '/v1/chat/completions/401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
      return;
    }

    // 402 Insufficient Credit
    if (pathname === '/v1/chat/completions/402') {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Insufficient credit balance' } }));
      return;
    }

    // 403 Forbidden
    if (pathname === '/v1/chat/completions/403') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Country or model forbidden' } }));
      return;
    }

    // 404 Model Not Found
    if (pathname === '/v1/chat/completions/404-model') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'The model fake-model-x is not found' } }));
      return;
    }

    // 429 Rate Limit with Retry-After
    if (pathname === '/v1/chat/completions/429') {
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': '15',
        'x-ratelimit-remaining-requests': '0',
      });
      res.end(JSON.stringify({ error: { message: 'Rate limit reached. Please retry in 15s.' } }));
      return;
    }

    // 500 Server Error
    if (pathname === '/v1/chat/completions/500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal server error' } }));
      return;
    }

    // 503 Service Unavailable
    if (pathname === '/v1/chat/completions/503') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Service temporarily overloaded' } }));
      return;
    }

    // Malformed JSON
    if (pathname === '/v1/chat/completions/malformed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('<html><body>Internal gateway error</body></html>');
      return;
    }

    // Timeout simulation
    if (pathname === '/v1/chat/completions/timeout') {
      const timer = setTimeout(() => {
        if (!res.writableEnded) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'Too late' } }] }));
        }
      }, 2000);
      req.on('close', () => clearTimeout(timer));
      return;
    }

    // Cross-host Redirect simulation (must be refused by BrowserApiExecutor)
    if (pathname === '/v1/chat/completions/redirect') {
      res.writeHead(302, {
        Location: 'https://evil-collector.example.com/steal',
      });
      res.end();
      return;
    }

    // No-CORS endpoint (omits Access-Control-Allow-Origin)
    if (pathname === '/no-cors') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'No CORS header' } }] }));
      return;
    }

    // Modern Unseen Models endpoint (OpenAI-compatible) per §10
    if (pathname === '/v1/models/modern') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [
            { id: 'gpt-9-omni-preview:free', name: 'GPT-9 Omni Preview', context_length: 2000000, pricing: { prompt: '0', completion: '0' } },
            { id: 'claude-7-sonnet-20280101', name: 'Claude 7 Sonnet', context_length: 1000000 },
            { id: 'whisper-large-v9-embedding', name: 'Whisper Embedding', context_length: 8192 },
          ],
        })
      );
      return;
    }

    // Gemini v1beta/models endpoint with unseen modern models & excluded modalities per §10 & §11
    if (pathname === '/v1beta/models') {
      // Verify key is sent via x-goog-api-key header and NOT in query string
      if (url.searchParams.has('key')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'API key must not be passed in URL query string' } }));
        return;
      }
      const apiKeyHeader = req.headers['x-goog-api-key'];
      if (!apiKeyHeader) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing x-goog-api-key header' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          models: [
            {
              name: 'models/gemini-9.5-ultra-2029',
              displayName: 'Gemini 9.5 Ultra (2029)',
              supportedGenerationMethods: ['generateContent', 'countTokens'],
              inputTokenLimit: 4194304,
              outputTokenLimit: 65536,
            },
            {
              name: 'models/text-embedding-005',
              displayName: 'Text Embedding 005',
              supportedGenerationMethods: ['embedContent'],
            },
            {
              name: 'models/gemini-live-2.5-audio',
              displayName: 'Gemini Live Audio',
              supportedGenerationMethods: ['generateContent', 'bidiGenerateContent'],
            },
            {
              name: 'models/imagen-4.0-generate',
              displayName: 'Imagen 4.0',
              supportedGenerationMethods: ['predict'],
            },
          ],
        })
      );
      return;
    }

    // Gemini generateContent endpoint for unseen modern model
    if (pathname === '/v1beta/models/gemini-9.5-ultra-2029:generateContent') {
      if (url.searchParams.has('key')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'API key must not be passed in URL query string' } }));
        return;
      }
      const apiKeyHeader = req.headers['x-goog-api-key'];
      if (!apiKeyHeader) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing x-goog-api-key header' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Hello from unseen future model gemini-9.5-ultra-2029!' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 2,
            candidatesTokenCount: 10,
            totalTokenCount: 12,
          },
        })
      );
      return;
    }

    // Default 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Endpoint not found' } }));
  });

  return server;
}
