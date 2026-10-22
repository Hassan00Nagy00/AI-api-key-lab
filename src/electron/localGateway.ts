import crypto from 'node:crypto';
import http from 'node:http';
import { ApiRequestPayload, KeyMeta } from '../types/electron';
import { ProviderRegistry } from '../services/providerRegistry';
import { JsonStore, redactSecretsFromText, SanitizedLogger, writeFileAtomicSync } from './jsonStore';
import { SecretStore } from './secretStore';
import { MainProcessExecutor } from './mainExecutor';
import fs from 'node:fs';
import path from 'node:path';

export const GATEWAY_TOKEN_SECRET_ID = '__local_gateway_token__';
export const DEFAULT_GATEWAY_PORT = 43110;

export interface LocalGatewayConfig {
  enabled: boolean;
  port: number;
  priorityKeyIds: string[];
  enableAutomaticFailover: boolean;
  maxRequestsBudget: number;
  requestsUsed: number;
  maxRequestsPerMinutePerKey: number;
}

export interface GatewayActivityLogEntry {
  id: string;
  timestamp: string;
  providerId: string;
  modelId: string;
  latencyMs: number;
  status: number;
  errorCategory?: string;
}

export interface GatewayStatusSnapshot {
  running: boolean;
  bindAddress: '127.0.0.1';
  port: number;
  baseUrl: string;
  maskedToken: string;
  config: LocalGatewayConfig;
  workingKeyCount: number;
  recentLogs: GatewayActivityLogEntry[];
}

export interface GatewayToolSnippets {
  cursor: string;
  aider: string;
  opencode: string;
  curl: string;
  python: string;
  typescript: string;
}

function maskGatewayToken(token: string): string {
  if (!token || token.length < 10) return 'aklg_••••';
  return `aklg_••••${token.slice(-4)}`;
}

function constantTimeTokenCompare(expected: string, provided: string): boolean {
  const bufA = Buffer.from(expected, 'utf8');
  const bufB = Buffer.from(provided, 'utf8');
  if (bufA.length !== bufB.length) {
    // Compare against bufA anyway to avoid length leak timing
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates the Host header to defeat DNS rebinding attacks.
 * Only allows 127.0.0.1 or localhost (with optional :port).
 */
export function isValidLocalGatewayHostHeader(hostHeader: string | undefined, activePort?: number): boolean {
  if (!hostHeader || typeof hostHeader !== 'string') {
    return false;
  }
  const trimmed = hostHeader.trim().toLowerCase();
  const match = /^(127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/.exec(trimmed);
  if (!match) {
    return false;
  }
  if (match[2] && activePort && activePort > 0) {
    const portNum = Number(match[2]);
    if (portNum !== activePort) {
      return false;
    }
  }
  return true;
}

/**
 * Detects browser-initiated requests via Origin or Sec-Fetch-* headers.
 * Any request from a web browser context is rejected to block cross-site local probing.
 */
export function hasBrowserOriginHeaders(headers: http.IncomingHttpHeaders, method?: string): boolean {
  if (method === 'OPTIONS') {
    return true;
  }
  if (headers['origin'] !== undefined) {
    return true;
  }
  if (headers['sec-fetch-site'] !== undefined || headers['sec-fetch-mode'] !== undefined) {
    return true;
  }
  if (headers['access-control-request-method'] !== undefined || headers['access-control-request-headers'] !== undefined) {
    return true;
  }
  return false;
}

/**
 * Generates ready-to-copy client snippets containing ONLY the local gateway URL and token placeholder/value.
 */
export function buildGatewayClientSnippets(
  port: number,
  tokenDisplay = '<YOUR_GATEWAY_TOKEN>',
  defaultModel = 'auto'
): GatewayToolSnippets {
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  return {
    cursor: `// Cursor Settings -> Models -> OpenAI API Base URL\nBase URL: ${baseUrl}\nAPI Key:  ${tokenDisplay}\nModel:    ${defaultModel}`,
    aider: `aider --openai-api-base ${baseUrl} --openai-api-key "${tokenDisplay}" --model openai/${defaultModel}`,
    opencode: `{\n  "provider": "openai-compatible",\n  "baseURL": "${baseUrl}",\n  "apiKey": "${tokenDisplay}",\n  "model": "${defaultModel}"\n}`,
    curl: `curl -X POST "${baseUrl}/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${tokenDisplay}" \\\n  -d '{"model":"${defaultModel}","messages":[{"role":"user","content":"Hello!"}]}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}",\n    api_key="${tokenDisplay}",\n)\n\nresponse = client.chat.completions.create(\n    model="${defaultModel}",\n    messages=[{"role": "user", "content": "Hello!"}],\n)\nprint(response.choices[0].message.content)`,
    typescript: `import OpenAI from 'openai';\n\nconst client = new OpenAI({\n  baseURL: '${baseUrl}',\n  apiKey: '${tokenDisplay}',\n});\n\nconst res = await client.chat.completions.create({\n  model: '${defaultModel}',\n  messages: [{ role: 'user', content: 'Hello!' }],\n});\nconsole.log(res.choices[0]?.message?.content);`,
  };
}

export class LocalGatewayService {
  private userDataDir: string;
  private configPath: string;
  private jsonStore: JsonStore;
  private secretStore: SecretStore;
  private executor: MainProcessExecutor;
  private logger?: SanitizedLogger;

  private server: http.Server | null = null;
  private activePort: number = DEFAULT_GATEWAY_PORT;
  private config: LocalGatewayConfig = {
    enabled: false,
    port: DEFAULT_GATEWAY_PORT,
    priorityKeyIds: [],
    enableAutomaticFailover: true,
    maxRequestsBudget: 100,
    requestsUsed: 0,
    maxRequestsPerMinutePerKey: 30,
  };

  private activityLog: GatewayActivityLogEntry[] = [];
  private keyRateTimestamps = new Map<string, number[]>();

  constructor(opts: {
    userDataDir: string;
    jsonStore: JsonStore;
    secretStore: SecretStore;
    executor: MainProcessExecutor;
    logger?: SanitizedLogger;
  }) {
    this.userDataDir = opts.userDataDir;
    this.jsonStore = opts.jsonStore;
    this.secretStore = opts.secretStore;
    this.executor = opts.executor;
    this.logger = opts.logger;
    fs.mkdirSync(this.userDataDir, { recursive: true });
    this.configPath = path.join(this.userDataDir, 'local_gateway_config.json');

    this.loadConfig();
    this.ensureGatewayTokenExists();
  }

  private loadConfig(): void {
    if (!fs.existsSync(this.configPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf8')) as Partial<LocalGatewayConfig>;
      this.config = {
        enabled: false, // Always starts off by default until explicitly started or toggled
        port: typeof parsed.port === 'number' && parsed.port >= 0 && parsed.port <= 65535 ? parsed.port : DEFAULT_GATEWAY_PORT,
        priorityKeyIds: Array.isArray(parsed.priorityKeyIds) ? parsed.priorityKeyIds : [],
        enableAutomaticFailover: parsed.enableAutomaticFailover ?? true,
        maxRequestsBudget: typeof parsed.maxRequestsBudget === 'number' && parsed.maxRequestsBudget >= 1 ? parsed.maxRequestsBudget : 100,
        requestsUsed: typeof parsed.requestsUsed === 'number' && parsed.requestsUsed >= 0 ? parsed.requestsUsed : 0,
        maxRequestsPerMinutePerKey:
          typeof parsed.maxRequestsPerMinutePerKey === 'number' && parsed.maxRequestsPerMinutePerKey >= 1
            ? parsed.maxRequestsPerMinutePerKey
            : 30,
      };
      this.activePort = this.config.port;
    } catch {
      // keep defaults
    }
  }

  private saveConfig(): void {
    writeFileAtomicSync(this.configPath, JSON.stringify(this.config, null, 2), 0o600);
  }

  private ensureGatewayTokenExists(): string {
    try {
      const existing = this.secretStore.getSecret(GATEWAY_TOKEN_SECRET_ID);
      if (existing && existing.startsWith('aklg_')) {
        return existing;
      }
      const generated = `aklg_${crypto.randomBytes(24).toString('hex')}`;
      this.secretStore.saveSecret(GATEWAY_TOKEN_SECRET_ID, generated);
      return generated;
    } catch {
      // If Keychain is unavailable, do not generate a fallback plaintext token
      return '';
    }
  }

  public rotateGatewayToken(): { maskedToken: string } {
    const newToken = `aklg_${crypto.randomBytes(24).toString('hex')}`;
    this.secretStore.saveSecret(GATEWAY_TOKEN_SECRET_ID, newToken);
    this.logger?.log('INFO', 'Rotated Local Gateway bearer token');
    return { maskedToken: maskGatewayToken(newToken) };
  }

  public getRawGatewayToken(): string {
    const token = this.secretStore.getSecret(GATEWAY_TOKEN_SECRET_ID);
    if (!token) {
      return this.ensureGatewayTokenExists();
    }
    return token;
  }

  public getStatus(): GatewayStatusSnapshot {
    const token = this.getRawGatewayToken();
    const keysMeta = this.jsonStore.read('keys_meta');
    const workingKeyCount = keysMeta.filter((k) => k.status === 'working' && this.secretStore.hasSecret(k.id)).length;
    const effectivePort = this.activePort || this.config.port || DEFAULT_GATEWAY_PORT;

    return {
      running: Boolean(this.server && this.server.listening),
      bindAddress: '127.0.0.1',
      port: effectivePort,
      baseUrl: `http://127.0.0.1:${effectivePort}/v1`,
      maskedToken: maskGatewayToken(token),
      config: { ...this.config, enabled: Boolean(this.server && this.server.listening), port: effectivePort },
      workingKeyCount,
      recentLogs: [...this.activityLog],
    };
  }

  public updateConfig(patch: Partial<Omit<LocalGatewayConfig, 'enabled'>> & { resetBudgetUsage?: boolean }): GatewayStatusSnapshot {
    if (typeof patch.port === 'number' && patch.port >= 0 && patch.port <= 65535) {
      this.config.port = patch.port;
      if (!this.server || !this.server.listening) {
        this.activePort = patch.port;
      }
    }
    if (Array.isArray(patch.priorityKeyIds)) {
      this.config.priorityKeyIds = patch.priorityKeyIds.filter((id) => typeof id === 'string');
    }
    if (typeof patch.enableAutomaticFailover === 'boolean') {
      this.config.enableAutomaticFailover = patch.enableAutomaticFailover;
    }
    if (typeof patch.maxRequestsBudget === 'number' && patch.maxRequestsBudget >= 1) {
      this.config.maxRequestsBudget = Math.floor(patch.maxRequestsBudget);
    }
    if (typeof patch.maxRequestsPerMinutePerKey === 'number' && patch.maxRequestsPerMinutePerKey >= 1) {
      this.config.maxRequestsPerMinutePerKey = Math.floor(patch.maxRequestsPerMinutePerKey);
    }
    if (patch.resetBudgetUsage) {
      this.config.requestsUsed = 0;
    }

    this.saveConfig();
    return this.getStatus();
  }

  public async start(portOverride?: number): Promise<GatewayStatusSnapshot> {
    if (this.server && this.server.listening) {
      return this.getStatus();
    }

    const token = this.getRawGatewayToken();
    if (!token) {
      throw new Error('Cannot start Local Gateway: macOS Keychain (SecretStore) is unavailable.');
    }

    const requestedPort = portOverride !== undefined ? portOverride : this.config.port;

    const srv = http.createServer((req, res) => {
      void this.handleHttpRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        srv.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        srv.removeListener('error', onError);
        resolve();
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
      // STRICT INVARIANT: Bind to 127.0.0.1 ONLY
      srv.listen(requestedPort, '127.0.0.1');
    });

    this.server = srv;
    const addr = srv.address();
    if (addr && typeof addr === 'object') {
      this.activePort = addr.port;
      if (requestedPort !== 0) {
        this.config.port = addr.port;
      }
    }
    this.config.enabled = true;
    this.saveConfig();

    this.logger?.log('INFO', 'Local Gateway started on 127.0.0.1', { port: this.activePort });
    return this.getStatus();
  }

  public async stop(): Promise<GatewayStatusSnapshot> {
    if (!this.server) {
      this.config.enabled = false;
      this.saveConfig();
      return this.getStatus();
    }

    const srv = this.server;
    this.server = null;
    this.config.enabled = false;
    this.saveConfig();

    await new Promise<void>((resolve) => {
      srv.close(() => resolve());
    });

    this.logger?.log('INFO', 'Local Gateway stopped');
    return this.getStatus();
  }

  public clearActivityLog(): void {
    this.activityLog = [];
  }

  private recordActivity(entry: Omit<GatewayActivityLogEntry, 'id' | 'timestamp'>): void {
    const cleanEntry: GatewayActivityLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      providerId: entry.providerId,
      modelId: entry.modelId,
      latencyMs: entry.latencyMs,
      status: entry.status,
      errorCategory: entry.errorCategory,
    };

    this.activityLog.unshift(cleanEntry);
    if (this.activityLog.length > 100) {
      this.activityLog.length = 100;
    }

    // Log ONLY providerId, modelId, latencyMs, status, and errorCategory — never prompts, responses, or secrets
    this.logger?.log('INFO', 'Local Gateway request processed', {
      providerId: cleanEntry.providerId,
      modelId: cleanEntry.modelId,
      latencyMs: cleanEntry.latencyMs,
      status: cleanEntry.status,
      errorCategory: cleanEntry.errorCategory,
    });
  }

  private isKeyWithinRateLimit(keyId: string): boolean {
    const now = Date.now();
    const windowStart = now - 60000;
    const timestamps = (this.keyRateTimestamps.get(keyId) || []).filter((ts) => ts > windowStart);
    this.keyRateTimestamps.set(keyId, timestamps);
    return timestamps.length < this.config.maxRequestsPerMinutePerKey;
  }

  private recordKeyRequestTimestamp(keyId: string): void {
    const now = Date.now();
    const timestamps = this.keyRateTimestamps.get(keyId) || [];
    timestamps.push(now);
    this.keyRateTimestamps.set(keyId, timestamps);
  }

  private getOrderedWorkingKeys(requestedModel?: string): KeyMeta[] {
    const allKeys = this.jsonStore.read('keys_meta');
    const workingKeys = allKeys.filter((k) => k.status === 'working' && this.secretStore.hasSecret(k.id));

    // Order by user's priorityKeyIds first, then remaining working keys
    const priorityMap = new Map<string, number>();
    this.config.priorityKeyIds.forEach((id, idx) => priorityMap.set(id, idx));

    const sorted = [...workingKeys].sort((a, b) => {
      const prioA = priorityMap.has(a.id) ? priorityMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const prioB = priorityMap.has(b.id) ? priorityMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (prioA !== prioB) return prioA - prioB;

      // If a specific model was requested and matches selectedModel or lastKnownGood.model, prefer it
      if (requestedModel && requestedModel !== 'auto') {
        const aMatch = a.selectedModel === requestedModel || a.lastKnownGood?.model === requestedModel ? 0 : 1;
        const bMatch = b.selectedModel === requestedModel || b.lastKnownGood?.model === requestedModel ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return 0;
    });

    if (!this.config.enableAutomaticFailover && sorted.length > 1) {
      return [sorted[0]];
    }
    return sorted;
  }

  private sendJsonError(
    res: http.ServerResponse,
    status: number,
    errorCode: string,
    message: string
  ): void {
    const body = JSON.stringify({
      error: {
        message,
        type: 'gateway_error',
        code: errorCode,
      },
    });
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const startedAt = Date.now();

    // 1. Reject browser-origin requests (defeats malicious web pages probing 127.0.0.1)
    if (hasBrowserOriginHeaders(req.headers, req.method)) {
      this.recordActivity({
        providerId: 'gateway',
        modelId: 'none',
        latencyMs: Date.now() - startedAt,
        status: 403,
        errorCategory: 'BROWSER_ORIGIN_REJECTED',
      });
      this.sendJsonError(
        res,
        403,
        'BROWSER_ORIGIN_REJECTED',
        'Browser-origin requests (Origin / Sec-Fetch-* headers) are forbidden on the Local Gateway.'
      );
      return;
    }

    // 2. Validate Host header (defeats DNS rebinding attacks)
    if (!isValidLocalGatewayHostHeader(req.headers.host, this.activePort)) {
      this.recordActivity({
        providerId: 'gateway',
        modelId: 'none',
        latencyMs: Date.now() - startedAt,
        status: 403,
        errorCategory: 'INVALID_HOST_HEADER',
      });
      this.sendJsonError(
        res,
        403,
        'INVALID_HOST_HEADER',
        'Forbidden Host header. Local Gateway only accepts 127.0.0.1 or localhost.'
      );
      return;
    }

    // 3. Require valid random Bearer token from Keychain-backed SecretStore
    const expectedToken = this.getRawGatewayToken();
    const authHeader = req.headers['authorization'] || '';
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(Array.isArray(authHeader) ? authHeader[0] : authHeader);
    const providedToken = bearerMatch ? bearerMatch[1].trim() : '';

    if (!expectedToken || !providedToken || !constantTimeTokenCompare(expectedToken, providedToken)) {
      this.recordActivity({
        providerId: 'gateway',
        modelId: 'none',
        latencyMs: Date.now() - startedAt,
        status: 401,
        errorCategory: 'UNAUTHORIZED_GATEWAY_TOKEN',
      });
      this.sendJsonError(res, 401, 'INVALID_GATEWAY_TOKEN', 'Invalid or missing Local Gateway bearer token.');
      return;
    }

    const parsedPath = (req.url || '/').split('?')[0];

    // 4. Route GET /v1/models
    if (req.method === 'GET' && (parsedPath === '/v1/models' || parsedPath === '/models')) {
      const workingKeys = this.getOrderedWorkingKeys();
      const modelsData = workingKeys.map((k) => {
        const modelId = k.selectedModel || k.lastKnownGood?.model || `${k.providerId}-default`;
        return {
          id: modelId,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: k.providerId,
        };
      });

      this.recordActivity({
        providerId: 'gateway',
        modelId: 'models-list',
        latencyMs: Date.now() - startedAt,
        status: 200,
      });

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ object: 'list', data: modelsData }));
      return;
    }

    // 5. Route POST /v1/chat/completions
    if (req.method === 'POST' && (parsedPath === '/v1/chat/completions' || parsedPath === '/chat/completions')) {
      // Enforce configurable request budget before dispatching
      if (this.config.requestsUsed >= this.config.maxRequestsBudget) {
        this.recordActivity({
          providerId: 'gateway',
          modelId: 'none',
          latencyMs: Date.now() - startedAt,
          status: 429,
          errorCategory: 'GATEWAY_BUDGET_EXCEEDED',
        });
        this.sendJsonError(
          res,
          429,
          'GATEWAY_BUDGET_EXCEEDED',
          `Local Gateway request budget exceeded (${this.config.requestsUsed}/${this.config.maxRequestsBudget}). Reset or increase budget in AI API Key Lab.`
        );
        return;
      }

      let rawBody: string;
      try {
        rawBody = await this.readRequestBody(req, 2 * 1024 * 1024);
      } catch (err) {
        this.sendJsonError(res, 400, 'INVALID_REQUEST_BODY', err instanceof Error ? err.message : 'Bad request body');
        return;
      }

      let parsedBody: Record<string, any>;
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        this.sendJsonError(res, 400, 'INVALID_JSON', 'Request body must be valid JSON.');
        return;
      }

      const requestedModel = typeof parsedBody.model === 'string' ? parsedBody.model : 'auto';
      const messages = Array.isArray(parsedBody.messages) ? parsedBody.messages : [];
      if (messages.length === 0) {
        this.sendJsonError(res, 400, 'MISSING_MESSAGES', 'messages array is required.');
        return;
      }

      const candidateKeys = this.getOrderedWorkingKeys(requestedModel);
      if (candidateKeys.length === 0) {
        this.recordActivity({
          providerId: 'none',
          modelId: requestedModel,
          latencyMs: Date.now() - startedAt,
          status: 503,
          errorCategory: 'NO_WORKING_KEYS',
        });
        this.sendJsonError(
          res,
          503,
          'NO_WORKING_KEYS',
          'No verified "working" API keys are available in AI API Key Lab.'
        );
        return;
      }

      // Increment budget usage for this gateway completion call
      this.config.requestsUsed += 1;
      this.saveConfig();

      // Load custom providers into registry
      for (const cp of this.jsonStore.read('custom_providers')) {
        ProviderRegistry.registerProvider(cp);
      }

      let lastStatus = 502;
      let lastErrorCategory = 'UPSTREAM_ERROR';
      let lastErrorMessage = 'All candidate working keys failed.';

      for (const candidateKey of candidateKeys) {
        if (!this.isKeyWithinRateLimit(candidateKey.id)) {
          lastStatus = 429;
          lastErrorCategory = 'PER_KEY_RATE_LIMIT';
          lastErrorMessage = `Per-key rate limit (${this.config.maxRequestsPerMinutePerKey}/min) reached for key "${candidateKey.label}".`;
          continue;
        }

        const provider = ProviderRegistry.get(candidateKey.providerId);
        const effectiveBaseUrl = candidateKey.customBaseUrl || provider?.baseUrl || '';
        if (!effectiveBaseUrl) {
          continue;
        }
        const effectiveProtocol = provider?.protocol || 'openai-compatible';

        const effectiveModel =
          requestedModel && requestedModel !== 'auto'
            ? requestedModel
            : candidateKey.selectedModel ||
              candidateKey.lastKnownGood?.model ||
              provider?.models?.[0]?.id ||
              'gpt-4o-mini';

        const outboundPayload = this.buildExecutorPayloadForKey({
          key: candidateKey,
          providerBaseUrl: effectiveBaseUrl,
          protocol: effectiveProtocol,
          model: effectiveModel,
          messages,
          temperature: parsedBody.temperature,
          maxTokens: parsedBody.max_tokens,
        });

        this.recordKeyRequestTimestamp(candidateKey.id);
        const execStart = Date.now();
        const upstreamRes = await this.executor.executeRequest(outboundPayload);
        const execLatency = Date.now() - execStart;

        // Collect all known secrets to guarantee no secret ever leaks in responses
        const knownSecrets: string[] = [expectedToken];
        const keySecret = this.secretStore.getSecret(candidateKey.id);
        if (keySecret) knownSecrets.push(keySecret);

        if (upstreamRes.ok && upstreamRes.status >= 200 && upstreamRes.status < 300) {
          const normalizedResponse = this.normalizeToOpenAIResponse(
            upstreamRes.bodyText,
            effectiveProtocol,
            effectiveModel,
            knownSecrets
          );


          this.recordActivity({
            providerId: candidateKey.providerId,
            modelId: effectiveModel,
            latencyMs: execLatency,
            status: 200,
          });

          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Gateway-Provider': candidateKey.providerId,
            'X-Gateway-Model': effectiveModel,
          });
          res.end(normalizedResponse);
          return;
        }

        // Handle upstream 429 rate limit: automatic failover to next working key!
        if (upstreamRes.status === 429) {
          this.recordActivity({
            providerId: candidateKey.providerId,
            modelId: effectiveModel,
            latencyMs: execLatency,
            status: 429,
            errorCategory: 'RATE_LIMITED_FAILOVER',
          });
          lastStatus = 429;
          lastErrorCategory = 'RATE_LIMITED';
          lastErrorMessage = 'Upstream provider returned 429 Rate Limit.';
          continue;
        }

        // Non-200 error on this key
        this.recordActivity({
          providerId: candidateKey.providerId,
          modelId: effectiveModel,
          latencyMs: execLatency,
          status: upstreamRes.status || 502,
          errorCategory: upstreamRes.errorCode || `HTTP_${upstreamRes.status}`,
        });
        lastStatus = upstreamRes.status || 502;
        lastErrorCategory = upstreamRes.errorCode || `HTTP_${upstreamRes.status}`;
        lastErrorMessage = redactSecretsFromText(
          `Upstream provider (${candidateKey.providerId}) returned status ${upstreamRes.status}.`,
          knownSecrets
        );

        // Fail over on 5xx server errors if automatic failover is enabled
        if (upstreamRes.status >= 500 && this.config.enableAutomaticFailover) {
          continue;
        }
        break;
      }

      this.sendJsonError(res, lastStatus, lastErrorCategory, lastErrorMessage);
      return;
    }

    this.sendJsonError(res, 404, 'NOT_FOUND', `Unsupported Local Gateway endpoint: ${req.method} ${parsedPath}`);
  }

  private buildExecutorPayloadForKey(params: {
    key: KeyMeta;
    providerBaseUrl: string;
    protocol: string;
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    maxTokens?: number;
  }): ApiRequestPayload {
    const cleanBase = params.providerBaseUrl.replace(/\/+$/, '');
    const isLocalProvider = ['ollama', 'lmstudio', 'custom-local', 'local'].includes(params.key.providerId);

    if (params.protocol === 'google-gemini') {
      const contents = params.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content ?? '') }],
      }));
      return {
        requestId: crypto.randomUUID(),
        keyId: params.key.id,
        boundHost: params.key.boundHost,
        providerId: params.key.providerId,
        allowLocalHttp: isLocalProvider,
        url: `${cleanBase}/models/${encodeURIComponent(params.model)}:generateContent`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': '{{secret}}',
        },
        body: JSON.stringify({ contents }),
        timeoutMs: 30000,
      };
    }

    if (params.protocol === 'anthropic-compatible') {
      const systemMsg = params.messages.find((m) => m.role === 'system')?.content;
      const nonSystem = params.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content ?? ''),
        }));
      return {
        requestId: crypto.randomUUID(),
        keyId: params.key.id,
        boundHost: params.key.boundHost,
        providerId: params.key.providerId,
        allowLocalHttp: isLocalProvider,
        url: `${cleanBase}/messages`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': '{{secret}}',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: params.model,
          max_tokens: params.maxTokens || 1024,
          ...(systemMsg ? { system: systemMsg } : {}),
          messages: nonSystem.length > 0 ? nonSystem : [{ role: 'user', content: 'Hello' }],
        }),
        timeoutMs: 30000,
      };
    }

    // Default: OpenAI-compatible protocol
    return {
      requestId: crypto.randomUUID(),
      keyId: params.key.id,
      boundHost: params.key.boundHost,
      providerId: params.key.providerId,
      allowLocalHttp: isLocalProvider,
      url: `${cleanBase}/chat/completions`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer {{secret}}',
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...(params.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
      }),
      timeoutMs: 30000,
    };
  }

  private normalizeToOpenAIResponse(
    rawBodyText: string,
    protocol: string,
    model: string,
    knownSecrets: string[]
  ): string {
    const scrubbedBody = redactSecretsFromText(rawBodyText, knownSecrets);

    try {
      const parsed = JSON.parse(scrubbedBody);

      // If already OpenAI chat.completion shape, return scrubbed JSON
      if (parsed && Array.isArray(parsed.choices)) {
        return JSON.stringify(parsed);
      }

      let assistantText = '';
      if (protocol === 'google-gemini') {
        assistantText = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else if (protocol === 'anthropic-compatible') {
        assistantText = parsed?.content?.[0]?.text || '';
      } else {
        assistantText =
          parsed?.choices?.[0]?.message?.content ||
          parsed?.text ||
          parsed?.response ||
          scrubbedBody;
      }

      return JSON.stringify({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: redactSecretsFromText(String(assistantText), knownSecrets),
            },
            finish_reason: 'stop',
          },
        ],
      });
    } catch {
      return JSON.stringify({
        id: `chatcmpl-${crypto.randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: scrubbedBody,
            },
            finish_reason: 'stop',
          },
        ],
      });
    }
  }

  private readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;

      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy();
          reject(new Error('Request body exceeds maximum size limit'));
          return;
        }
        chunks.push(chunk);
      });

      req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'));
      });

      req.on('error', (err) => {
        reject(err);
      });
    });
  }
}
