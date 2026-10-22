import { PreparedRequest, ApiResponse } from '../types/test';
import { ApiRequestPayload, StreamEvent } from '../types/electron';
import { SecretVault } from './secretVault';

export interface ExecutionContext {
  keyId: string;
  boundHost: string;
  providerId?: string;
  allowLocalHttp?: boolean;
  signal: AbortSignal;
  onChunk?: (chunk: string) => void;
}

export interface ApiExecutor {
  execute(req: PreparedRequest, ctx: ExecutionContext): Promise<ApiResponse>;
}

/**
 * Native Electron Renderer Executor:
 * Delegates HTTP & SSE/NDJSON streaming to the Electron Main Process via `window.electronAPI.api`.
 * Raw secrets are NEVER held or read in the renderer — Main binds `{{secret}}` by `keyId` from Keychain.
 */
export class ElectronApiExecutor implements ApiExecutor {
  async execute(req: PreparedRequest, ctx: ExecutionContext): Promise<ApiResponse> {
    if (typeof window === 'undefined' || !window.electronAPI) {
      throw new Error('ElectronApiExecutor requires window.electronAPI preload bridge');
    }

    const requestId = crypto.randomUUID();
    let serializedBody: string | undefined = undefined;
    if (req.body !== undefined) {
      serializedBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const payload: ApiRequestPayload = {
      requestId,
      keyId: ctx.keyId,
      boundHost: ctx.boundHost,
      providerId: ctx.providerId,
      allowLocalHttp: ctx.allowLocalHttp,
      url: req.url,
      method: req.method === 'GET' || req.method === 'DELETE' ? req.method : 'POST',
      headers: { ...req.headers },
      query: req.query ? { ...req.query } : undefined,
      body: serializedBody,
      timeoutMs: 30000,
    };

    // Streaming path via `api:stream-start` & `api:stream-event`
    if (ctx.onChunk) {
      return new Promise<ApiResponse>((resolve, reject) => {
        let settled = false;
        let accumulatedBody = '';

        const cleanup = () => {
          unsubscribe();
          ctx.signal.removeEventListener('abort', onAbort);
        };

        const onAbort = () => {
          void window.electronAPI?.api.streamAbort(requestId);
        };

        ctx.signal.addEventListener('abort', onAbort, { once: true });

        const unsubscribe = window.electronAPI!.api.onStreamEvent((event: StreamEvent) => {
          if (event.requestId !== requestId || settled) return;

          if (event.type === 'chunk') {
            accumulatedBody += event.chunk;
            ctx.onChunk?.(event.chunk);
          } else if (event.type === 'done') {
            settled = true;
            cleanup();
            resolve({
              status: event.status,
              statusText: event.statusText,
              headers: event.headers,
              bodyText: event.bodyText || accumulatedBody,
              latencyMs: event.latencyMs,
            });
          } else if (event.type === 'aborted') {
            settled = true;
            cleanup();
            resolve({
              status: 408,
              statusText: 'Client Timeout / Request Aborted',
              headers: {},
              bodyText: 'Request timed out or was aborted by user.',
              latencyMs: event.latencyMs,
            });
          } else if (event.type === 'error') {
            settled = true;
            cleanup();
            if (event.errorCode === 'ERR_HOST_BINDING' || event.message.startsWith('Host binding violation:')) {
              reject(new Error(event.message));
            } else {
              resolve({
                status: event.status || 0,
                statusText: event.message,
                headers: {},
                bodyText: event.message,
                latencyMs: event.latencyMs,
              });
            }
          }
        });

        window.electronAPI!.api.streamStart(payload).catch((err) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
        });
      });
    }

    // Standard non-streaming request via `api:request`
    const res = await window.electronAPI.api.request(payload);
    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      bodyText: res.bodyText,
      latencyMs: res.latencyMs,
    };
  }
}

export class BrowserApiExecutor implements ApiExecutor {
  async execute(req: PreparedRequest, ctx: ExecutionContext): Promise<ApiResponse> {
    const startTime = performance.now();
    let timeToFirstTokenMs: number | undefined;

    // 1. Host Binding Validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(req.url);
    } catch {
      throw new Error(`Invalid URL: ${req.url}`);
    }

    const host = parsedUrl.hostname.toLowerCase();
    const expectedHost = ctx.boundHost.toLowerCase();

    // Check scheme (HTTPS required, unless localhost/127.0.0.1 for local Ollama)
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    if (parsedUrl.protocol !== 'https:' && !isLocalHost) {
      throw new Error(`Insecure protocol: ${parsedUrl.protocol} is not allowed for remote hosts`);
    }

    // Host binding check
    if (host !== expectedHost) {
      throw new Error(
        `Host binding violation: Request target "${host}" does not match key bound host "${expectedHost}"`
      );
    }

    // Ensure no embedded credentials in URL
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('Embedded credentials in request URL are prohibited');
    }

    // 2. Late Secret Retrieval via isolated SecretVault
    const secret = SecretVault.getSecret(ctx.keyId);
    if (!secret) {
      throw new Error('API key secret is missing or storage vault is locked');
    }


    // 3. Substitute {{secret}} placeholder in headers, query, and url
    const resolvedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      resolvedHeaders[k] = v.replace(/\{\{secret\}\}/g, secret);
    }

    // Add anthropic-dangerous-direct-browser-access only for hosts that document it (api.anthropic.com)
    if (host === 'api.anthropic.com' && !resolvedHeaders['anthropic-dangerous-direct-browser-access']) {
      resolvedHeaders['anthropic-dangerous-direct-browser-access'] = 'true';
    }

    // Append query params if present
    if (req.query) {
      for (const [qk, qv] of Object.entries(req.query)) {
        const resolvedQv = qv.replace(/\{\{secret\}\}/g, secret);
        parsedUrl.searchParams.set(qk, resolvedQv);
      }
    }

    // Substitute in body if string/template
    let resolvedBody: BodyInit | undefined = undefined;
    if (req.body !== undefined) {
      if (typeof req.body === 'string') {
        resolvedBody = req.body.replace(/\{\{secret\}\}/g, secret);
      } else {
        const serialized = JSON.stringify(req.body);
        resolvedBody = serialized.replace(/\{\{secret\}\}/g, secret);
      }
    }

    // 4. Perform Network Fetch with Redirect Refusal and Opaque Failure Capture
    try {
      const response = await fetch(parsedUrl.toString(), {
        method: req.method,
        headers: resolvedHeaders,
        body: resolvedBody,
        signal: ctx.signal,
        redirect: 'manual',
      });

      // Refuse any redirect to prevent cross-host secret exfiltration
      if (
        response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400)
      ) {
        const location = response.headers.get('location') || 'redirect target';
        throw new Error(
          `Host binding violation: HTTP redirect (${response.status}) to "${location}" refused to prevent secret exfiltration`
        );
      }

      const latencyMs = Math.round(performance.now() - startTime);

      // Extract response headers
      const resHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        resHeaders[key.toLowerCase()] = val;
      });

      // Handle streaming if onChunk is provided and readable stream exists
      let bodyText = '';
      if (ctx.onChunk && response.body && response.ok) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let receivedFirstToken = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!receivedFirstToken) {
            receivedFirstToken = true;
            timeToFirstTokenMs = Math.round(performance.now() - startTime);
          }
          const chunkStr = decoder.decode(value, { stream: true });
          bodyText += chunkStr;
          ctx.onChunk(chunkStr);
        }
      } else {
        bodyText = await response.text();
      }

      return {
        status: response.status,
        statusText: response.statusText,
        headers: resHeaders,
        bodyText,
        latencyMs,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message.startsWith('Host binding violation:')) {
        throw err;
      }

      const latencyMs = Math.round(performance.now() - startTime);
      const isAbort = err instanceof DOMException && err.name === 'AbortError';

      if (isAbort) {
        return {
          status: 408,
          statusText: 'Client Timeout / Request Aborted',
          headers: {},
          bodyText: 'Request timed out or was aborted by user.',
          latencyMs,
        };
      }

      // Browser opaque network / CORS failure
      return {
        status: 0,
        statusText: err instanceof Error ? err.message : 'Network failure',
        headers: {},
        bodyText: err instanceof Error ? err.message : 'Opaque fetch failure (CORS or offline)',
        isOpaqueError: true,
        latencyMs,
      };
    }
  }
}

export function getDefaultExecutor(): ApiExecutor {
  if (typeof window !== 'undefined' && window.electronAPI) {
    return new ElectronApiExecutor();
  }
  return new BrowserApiExecutor();
}

export const defaultExecutor: ApiExecutor = {
  execute(req: PreparedRequest, ctx: ExecutionContext): Promise<ApiResponse> {
    return getDefaultExecutor().execute(req, ctx);
  },
};
