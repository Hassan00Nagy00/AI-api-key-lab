import dns from 'node:dns';
import { fetch as undiciFetch, Agent, ProxyAgent, Dispatcher } from 'undici';
import { ApiRequestPayload, ElectronApiResponse, StreamEvent } from '../types/electron';
import { SecretStore } from './secretStore';
import { JsonStore, redactSecretsFromText, SanitizedLogger } from './jsonStore';
import { isBlockedIpAddress, validateAndResolveOutboundUrl, validateOutboundUrlSync } from './ssrfGuard';
import { BudgetService } from '../services/budgetService';
import { ProviderRegistry } from '../services/providerRegistry';

export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB limit per §5
export const SYSTEM_PROXY_DIAGNOSTIC_MESSAGE =
  'A system proxy is configured; direct connections may fail';
export const PROXY_MODE_SECURITY_NOTE =
  'System proxy mode active (undici ProxyAgent): literal-host, approved-host, https-only, and local pre-resolution DNS checks are enforced, but connect-time IP verification is weaker because the proxy resolves the final address.';

export interface ProxyDiagnostic {
  isDirect: boolean;
  isProxied: boolean;
  proxyResult: string;
  proxyUrl?: string;
  proxyUri?: string;
  diagnosticMessage?: string;
  diagnostic: string | null;
}

export interface MainExecutorDeps {
  secretStore: SecretStore;
  jsonStore: JsonStore;
  logger?: SanitizedLogger;
  dnsLookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  resolveProxy?: (url: string) => Promise<string>; // e.g. session.defaultSession.resolveProxy(url)
  systemProxyUrl?: string; // Optional explicit HTTP proxy URL for ProxyAgent
  enforceBudgetGuard?: boolean; // Enforces §0A.1 Budget Guard in main-process executor
}

/**
 * Converts a Chromium/Electron PAC proxy string (e.g. "PROXY 127.0.0.1:8888; DIRECT")
 * into an HTTP proxy URL (`http://127.0.0.1:8888`) if applicable.
 */
export function parsePacProxyString(pacResult: string): string | undefined {
  if (!pacResult) return undefined;
  const trimmed = pacResult.trim();
  if (!trimmed || trimmed.toUpperCase() === 'DIRECT') {
    return undefined;
  }
  const firstDirective = trimmed.split(';')[0].trim();
  const match = firstDirective.match(/^(PROXY|HTTPS)\s+([^\s;]+)/i);
  if (!match) return undefined;
  const proto = match[1].toUpperCase() === 'HTTPS' ? 'https://' : 'http://';
  return `${proto}${match[2]}`;
}

export class MainProcessExecutor {
  private secretStore: SecretStore;
  private jsonStore: JsonStore;
  private logger?: SanitizedLogger;
  private dnsLookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
  private resolveProxyFn?: (url: string) => Promise<string>;
  private systemProxyUrl?: string;
  private enforceBudgetGuard: boolean;
  private activeStreams = new Map<string, AbortController>();
  private lastProxyDiagnostic: ProxyDiagnostic | null = null;

  constructor(deps: MainExecutorDeps) {
    this.secretStore = deps.secretStore;
    this.jsonStore = deps.jsonStore;
    this.logger = deps.logger;
    this.dnsLookup = deps.dnsLookup;
    this.resolveProxyFn = deps.resolveProxy;
    this.systemProxyUrl = deps.systemProxyUrl;
    this.enforceBudgetGuard = deps.enforceBudgetGuard ?? false;
  }

  /**
   * 07_P3 §0A.2: At startup and per host call `session.defaultSession.resolveProxy(url)`;
   * if the result is not DIRECT show a diagnostic ("A system proxy is configured; direct connections may fail").
   */
  async checkSystemProxy(targetUrl: string): Promise<ProxyDiagnostic> {
    if (!this.resolveProxyFn) {
      const direct: ProxyDiagnostic = {
        isDirect: true,
        isProxied: false,
        proxyResult: 'DIRECT',
        diagnostic: null,
      };
      this.lastProxyDiagnostic = direct;
      return direct;
    }

    try {
      const raw = (await this.resolveProxyFn(targetUrl)) || 'DIRECT';
      const normalized = raw.trim();
      if (!normalized || normalized.toUpperCase() === 'DIRECT') {
        const direct: ProxyDiagnostic = {
          isDirect: true,
          isProxied: false,
          proxyResult: 'DIRECT',
          diagnostic: null,
        };
        this.lastProxyDiagnostic = direct;
        return direct;
      }

      const proxyUrl = parsePacProxyString(normalized) || this.systemProxyUrl;
      const diag: ProxyDiagnostic = {
        isDirect: false,
        isProxied: true,
        proxyResult: normalized,
        proxyUrl,
        proxyUri: proxyUrl,
        diagnosticMessage: SYSTEM_PROXY_DIAGNOSTIC_MESSAGE,
        diagnostic: SYSTEM_PROXY_DIAGNOSTIC_MESSAGE,
      };
      this.lastProxyDiagnostic = diag;
      this.logger?.log('WARN', SYSTEM_PROXY_DIAGNOSTIC_MESSAGE, {
        targetHost: (() => {
          try {
            return new URL(targetUrl).hostname;
          } catch {
            return 'unknown';
          }
        })(),
        proxyResult: normalized,
      });
      return diag;
    } catch {
      const direct: ProxyDiagnostic = {
        isDirect: true,
        isProxied: false,
        proxyResult: 'DIRECT',
        diagnostic: null,
      };
      this.lastProxyDiagnostic = direct;
      return direct;
    }
  }

  getLastProxyDiagnostic(): ProxyDiagnostic | null {
    return this.lastProxyDiagnostic;
  }

  /**
   * Builds a connect-time guarded undici `Agent` (Default Direct Mode) or `ProxyAgent` (Optional System Proxy Mode)
   * per `07_P3 §0A.2` and `§5`.
   */
  private createDispatcher(options: {
    allowLoopback: boolean;
    useSystemProxy: boolean;
    effectiveProxyUrl?: string;
  }): { dispatcher: Dispatcher; usedProxyMode: boolean } {
    if (options.useSystemProxy && options.effectiveProxyUrl) {
      return {
        dispatcher: new ProxyAgent(options.effectiveProxyUrl),
        usedProxyMode: true,
      };
    }

    const customLookup = this.dnsLookup;
    const allowLoopback = options.allowLoopback;

    const agent = new Agent({
      connect: {
        lookup: (hostname, _opts, callback) => {
          const runLookup = async () => {
            const records = customLookup
              ? await customLookup(hostname)
              : await dns.promises.lookup(hostname, { all: true, verbatim: true });

            if (!records || records.length === 0) {
              throw new Error(`DNS resolution returned no addresses for "${hostname}"`);
            }

            for (const rec of records) {
              const check = isBlockedIpAddress(rec.address, { allowLoopback });
              if (check.blocked) {
                throw new Error(
                  `DNS rebinding / SSRF blocked at connect time: Host "${hostname}" resolved to restricted IP "${rec.address}" (${check.reason})`
                );
              }
            }

            return records;
          };

          runLookup()
            .then((records) => {
              // Node net.connect / undici lookup callback supports array when all:true or single address
              if (_opts && typeof _opts === 'object' && (_opts as any).all) {
                callback(null, records as any);
              } else {
                callback(null, records[0].address as any, records[0].family);
              }
            })
            .catch((err) => {
              callback(err instanceof Error ? err : new Error(String(err)), '' as any, 4);
            });
        },
      },
    });

    return { dispatcher: agent, usedProxyMode: false };
  }

  /**
   * Resolves key metadata, boundHost, local HTTP consent, Proxy rules, Budget Guard, and secret (late binding).
   */
  private async prepareAndValidate(
    payload: ApiRequestPayload,
    options?: { enforceBudgetGuard?: 'generation' | 'tier0' | boolean }
  ): Promise<{
    finalUrl: string;
    resolvedHeaders: Record<string, string>;
    resolvedBody: string | undefined;
    secretToRedact: string[];
    dispatcher: Dispatcher;
    usedProxyMode: boolean;
    proxyDiagnostic: ProxyDiagnostic;
  }> {
    const keysMeta = this.jsonStore.read('keys_meta');
    const settings = this.jsonStore.read('settings');
    const keyMeta = payload.keyId ? keysMeta.find((k) => k.id === payload.keyId) : undefined;

    const boundHost = payload.boundHost || keyMeta?.boundHost;
    const providerId = payload.providerId || keyMeta?.providerId;

    // 0. Check Budget Guard in Main Process if enabled (07_P3 §0A.1)
    const shouldEnforceBudget = Boolean(options?.enforceBudgetGuard || this.enforceBudgetGuard);
    if (shouldEnforceBudget && payload.keyId) {
      const state = BudgetService.getState();
      const capPerKey = settings?.dailyGenerationCapPerKey ?? 20;
      const capGlobal = settings?.dailyGenerationCapGlobal ?? 100;
      const capTier0 = settings?.dailyTier0CapGlobal ?? 300;

      const isGenerationCall =
        options?.enforceBudgetGuard === 'generation' ||
        (options?.enforceBudgetGuard !== 'tier0' && payload.method === 'POST');
      if (isGenerationCall) {
        const currentKeyCalls = state.perKeyGenerations[payload.keyId] || 0;
        if (currentKeyCalls >= capPerKey) {
          throw new Error(
            `Budget Guard hard-stop: Daily generation cap reached for this key (${currentKeyCalls}/${capPerKey}).`
          );
        }
        if (state.globalGenerations >= capGlobal) {
          throw new Error(
            `Budget Guard hard-stop: Daily global generation cap reached (${state.globalGenerations}/${capGlobal}).`
          );
        }
        const budget = BudgetService.checkAndConsumeGeneration(payload.keyId, { source: 'test' });
        if (!budget.allowed) {
          throw new Error(`Budget Guard hard-stop: ${budget.reason || 'Daily generation cap reached.'}`);
        }
      } else {
        if (state.globalTier0Calls >= capTier0) {
          throw new Error(
            `Budget Guard hard-stop: Daily Tier-0 model listing cap reached (${state.globalTier0Calls}/${capTier0}).`
          );
        }
        const tier0 = BudgetService.checkAndConsumeTier0(payload.keyId);
        if (!tier0.allowed) {
          throw new Error(`Budget Guard hard-stop: ${tier0.reason || 'Daily Tier-0 model listing cap reached.'}`);
        }
      }
    }

    // Check per-provider / per-host local consent
    const localConsents = this.jsonStore.read('local_consents');
    let parsedTargetUrl: URL;
    try {
      parsedTargetUrl = new URL(payload.url);
    } catch {
      throw new Error(`Invalid URL: ${payload.url}`);
    }
    const parsedTargetHost = parsedTargetUrl.hostname.toLowerCase();

    const consentKey = `${providerId || 'local'}:${parsedTargetHost}`;
    const hasLocalConsent = Boolean(payload.allowLocalHttp || localConsents[consentKey]);

    // Check system proxy status for this URL (07_P3 §0A.2)
    const proxyDiagnostic = await this.checkSystemProxy(payload.url);
    const useSystemProxy = Boolean(settings?.useSystemProxy);
    const effectiveProxyUrl = proxyDiagnostic.proxyUrl || this.systemProxyUrl;

    // If "Use system proxy" is enabled, enforce strict proxy-mode rules (07_P3 §0A.2):
    // 1. Literal-host checks & pre-resolution DNS check on this machine
    // 2. https: only (unless explicit local test fixture with allowLocalConsent)
    // 3. Approved hosts only (must be in provider's allowedHosts or key's boundHost)
    if (useSystemProxy && effectiveProxyUrl) {
      if (parsedTargetUrl.protocol !== 'https:' && !hasLocalConsent) {
        throw new Error(
          `System proxy mode requires https: only (refused ${parsedTargetUrl.protocol}//${parsedTargetHost})`
        );
      }
      if (providerId) {
        const provider = ProviderRegistry.get(providerId);
        if (
          provider &&
          provider.allowedHosts.length > 0 &&
          !provider.allowedHosts.map((h) => h.toLowerCase()).includes(parsedTargetHost) &&
          boundHost?.toLowerCase() !== parsedTargetHost
        ) {
          throw new Error(
            `Host binding violation in proxy mode: "${parsedTargetHost}" is not an approved host for provider "${providerId}"`
          );
        }
      }
    }

    // Deny renderer overrides of Host header per §9
    for (const headerKey of Object.keys(payload.headers || {})) {
      if (headerKey.toLowerCase() === 'host') {
        throw new Error('Security violation: Renderer is not allowed to override the Host header');
      }
    }

    // 1. Validate URL, Host Binding, Scheme, SSRF IP ranges, and Pre-Resolution DNS check BEFORE touching secret
    const syncCheck = validateOutboundUrlSync(payload.url, {
      boundHost,
      providerId,
      allowLocalProviderHttp: hasLocalConsent,
    });
    if (!syncCheck.valid) {
      throw new Error(syncCheck.error);
    }

    const ssrfResult = await validateAndResolveOutboundUrl(payload.url, {
      boundHost,
      providerId,
      allowLocalProviderHttp: hasLocalConsent,
      dnsLookup: this.dnsLookup,
    });

    if (!ssrfResult.valid) {
      throw new Error(ssrfResult.error);
    }

    const { parsedUrl } = ssrfResult;

    // 2. Late Secret Lookup (ONLY after host binding and SSRF/DNS validation succeed)
    let secret = '';
    const secretToRedact: string[] = [];
    if (payload.keyId) {
      const storedSecret = this.secretStore.getSecret(payload.keyId);
      if (!storedSecret) {
        throw new Error('API key secret is missing from Keychain vault');
      }
      secret = storedSecret;
      secretToRedact.push(secret);
    }

    // 3. Substitute {{secret}} placeholder in headers, query, and body
    const resolvedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(payload.headers || {})) {
      resolvedHeaders[k] = secret ? v.replace(/\{\{secret\}\}/g, secret) : v;
    }

    if (payload.query) {
      for (const [qk, qv] of Object.entries(payload.query)) {
        const resolvedQv = secret ? qv.replace(/\{\{secret\}\}/g, secret) : qv;
        parsedUrl.searchParams.set(qk, resolvedQv);
      }
    }

    let resolvedBody: string | undefined = payload.body;
    if (resolvedBody !== undefined && secret) {
      resolvedBody = resolvedBody.replace(/\{\{secret\}\}/g, secret);
    }

    const { dispatcher, usedProxyMode } = this.createDispatcher({
      allowLoopback: syncCheck.allowLoopback,
      useSystemProxy,
      effectiveProxyUrl,
    });

    return {
      finalUrl: parsedUrl.toString(),
      resolvedHeaders,
      resolvedBody,
      secretToRedact,
      dispatcher,
      usedProxyMode,
      proxyDiagnostic,
    };
  }

  /**
   * Executes a single HTTP request in the Electron Main process using the pinned `undici` package (`07_P3 §5`).
   */
  async executeRequest(
    payload: ApiRequestPayload,
    options?: { enforceBudgetGuard?: 'generation' | 'tier0' | boolean }
  ): Promise<ElectronApiResponse> {
    const startTime = performance.now();
    let secretToRedact: string[] = [];

    try {
      const prepared = await this.prepareAndValidate(payload, options);
      secretToRedact = prepared.secretToRedact;

      const controller = new AbortController();
      const timeoutMs = Math.min(Math.max(payload.timeoutMs || 30000, 50), 120000);
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await undiciFetch(prepared.finalUrl, {
          method: payload.method,
          headers: prepared.resolvedHeaders,
          body: payload.method === 'GET' ? undefined : prepared.resolvedBody,
          signal: controller.signal,
          redirect: 'manual',
          dispatcher: prepared.dispatcher,
        });

        clearTimeout(timer);

        // Refuse all 3xx redirects to prevent cross-host secret exfiltration
        if (
          response.type === 'opaqueredirect' ||
          (response.status >= 300 && response.status < 400)
        ) {
          const location = response.headers.get('location') || 'redirect target';
          throw new Error(
            `Host binding violation: HTTP redirect (${response.status}) to "${location}" refused to prevent secret exfiltration`
          );
        }

        const resHeaders: Record<string, string> = {};
        response.headers.forEach((val, key) => {
          resHeaders[key.toLowerCase()] = redactSecretsFromText(val, secretToRedact);
        });

        if (prepared.usedProxyMode) {
          resHeaders['x-keylab-proxy-mode'] = 'system-proxy-weaker-connect-ip-guarantee';
        }
        if (!prepared.proxyDiagnostic.isDirect && prepared.proxyDiagnostic.diagnosticMessage) {
          resHeaders['x-keylab-proxy-diagnostic'] = prepared.proxyDiagnostic.diagnosticMessage;
        }

        // Read response body with 10 MB size cap
        let bodyText = '';
        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let totalBytes = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new Error(
                `ERR_RESPONSE_TOO_LARGE: Response exceeded maximum allowed size of ${MAX_RESPONSE_BYTES} bytes`
              );
            }
            bodyText += decoder.decode(value, { stream: true });
          }
          bodyText += decoder.decode();
        } else {
          bodyText = await response.text();
          if (Buffer.byteLength(bodyText, 'utf8') > MAX_RESPONSE_BYTES) {
            throw new Error(
              `ERR_RESPONSE_TOO_LARGE: Response exceeded maximum allowed size of ${MAX_RESPONSE_BYTES} bytes`
            );
          }
        }

        const latencyMs = Math.round(performance.now() - startTime);
        const safeBody = redactSecretsFromText(bodyText, secretToRedact);
        const safeStatusText = redactSecretsFromText(response.statusText, secretToRedact);

        return {
          ok: response.ok,
          status: response.status,
          statusText: safeStatusText,
          headers: resHeaders,
          bodyText: safeBody,
          latencyMs,
        };
      } finally {
        clearTimeout(timer);
        await prepared.dispatcher.close().catch(() => {});
      }
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      const rawMsg =
        err instanceof Error
          ? err.cause instanceof Error
            ? `${err.message}: ${err.cause.message}`
            : err.message
          : 'Network execution error';
      const safeMsg = redactSecretsFromText(rawMsg, secretToRedact);

      // Re-throw host binding / SSRF / Budget Guard / Keychain errors so caller/tests can distinguish security blocks
      if (
        safeMsg.startsWith('Host binding violation') ||
        safeMsg.startsWith('SSRF protection:') ||
        safeMsg.includes('DNS rebinding / SSRF blocked') ||
        safeMsg.startsWith('Insecure protocol:') ||
        safeMsg.startsWith('System proxy mode requires https:') ||
        safeMsg.startsWith('Disallowed protocol') ||
        safeMsg.startsWith('Embedded credentials') ||
        safeMsg.startsWith('Security violation:') ||
        safeMsg.startsWith('Budget Guard') ||
        safeMsg.includes('IPv4-mapped IPv6') ||
        safeMsg.includes('ERR_KEYCHAIN_UNAVAILABLE') ||
        safeMsg.includes('Keychain encryption')
      ) {
        throw new Error(safeMsg);
      }

      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError');

      if (isAbort) {
        return {
          ok: false,
          status: 408,
          statusText: 'Client Timeout / Request Aborted',
          headers: {},
          bodyText: 'Request timed out or was aborted by user.',
          latencyMs,
          errorCode: 'ERR_TIMEOUT',
        };
      }

      this.logger?.log('WARN', 'MainProcessExecutor network error', { message: safeMsg }, secretToRedact);

      return {
        ok: false,
        status: 0,
        statusText: safeMsg,
        headers: {},
        bodyText: safeMsg,
        latencyMs,
        errorCode: safeMsg.startsWith('ERR_RESPONSE_TOO_LARGE') ? 'ERR_RESPONSE_TOO_LARGE' : 'ERR_NETWORK',
      };
    }
  }

  /**
   * Starts a streaming request in the Electron Main process using `undiciFetch` and emits `StreamEvent`s via `onEvent`.
   */
  async startStream(
    payload: ApiRequestPayload,
    onEvent: (event: StreamEvent) => void
  ): Promise<void> {
    const startTime = performance.now();
    const { requestId } = payload;
    let secretToRedact: string[] = [];
    let dispatcherToClose: Dispatcher | null = null;

    const controller = new AbortController();
    this.activeStreams.set(requestId, controller);

    const timeoutMs = Math.min(Math.max(payload.timeoutMs || 60000, 50), 300000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const prepared = await this.prepareAndValidate(payload);
      secretToRedact = prepared.secretToRedact;
      dispatcherToClose = prepared.dispatcher;

      const response = await undiciFetch(prepared.finalUrl, {
        method: payload.method,
        headers: prepared.resolvedHeaders,
        body: payload.method === 'GET' ? undefined : prepared.resolvedBody,
        signal: controller.signal,
        redirect: 'manual',
        dispatcher: prepared.dispatcher,
      });

      if (
        response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400)
      ) {
        const location = response.headers.get('location') || 'redirect target';
        throw new Error(
          `Host binding violation: HTTP redirect (${response.status}) to "${location}" refused to prevent secret exfiltration`
        );
      }

      const resHeaders: Record<string, string> = {};
      response.headers.forEach((val, key) => {
        resHeaders[key.toLowerCase()] = redactSecretsFromText(val, secretToRedact);
      });

      let fullBodyText = '';
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let totalBytes = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error(
              `ERR_RESPONSE_TOO_LARGE: Stream exceeded maximum allowed size of ${MAX_RESPONSE_BYTES} bytes`
            );
          }
          const chunk = redactSecretsFromText(decoder.decode(value, { stream: true }), secretToRedact);
          fullBodyText += chunk;
          onEvent({
            requestId,
            type: 'chunk',
            chunk,
            status: response.status,
            headers: resHeaders,
          });
        }
        const tail = redactSecretsFromText(decoder.decode(), secretToRedact);
        if (tail) {
          fullBodyText += tail;
          onEvent({
            requestId,
            type: 'chunk',
            chunk: tail,
            status: response.status,
            headers: resHeaders,
          });
        }
      } else {
        fullBodyText = redactSecretsFromText(await response.text(), secretToRedact);
      }

      onEvent({
        requestId,
        type: 'done',
        status: response.status,
        statusText: redactSecretsFromText(response.statusText, secretToRedact),
        headers: resHeaders,
        bodyText: fullBodyText,
        latencyMs: Math.round(performance.now() - startTime),
      });
    } catch (err: unknown) {
      const latencyMs = Math.round(performance.now() - startTime);
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError');

      if (isAbort) {
        onEvent({
          requestId,
          type: 'aborted',
          latencyMs,
        });
        return;
      }

      const rawMsg = err instanceof Error ? err.message : 'Stream execution failed';
      const safeMsg = redactSecretsFromText(rawMsg, secretToRedact);
      onEvent({
        requestId,
        type: 'error',
        errorCode: safeMsg.startsWith('Host binding violation:')
          ? 'ERR_HOST_BINDING'
          : safeMsg.startsWith('SSRF protection:') || safeMsg.includes('DNS rebinding')
          ? 'ERR_SSRF_BLOCKED'
          : 'ERR_STREAM',
        message: safeMsg,
        latencyMs,
      });
    } finally {
      clearTimeout(timer);
      this.activeStreams.delete(requestId);
      if (dispatcherToClose) {
        await dispatcherToClose.close().catch(() => {});
      }
    }
  }

  /**
   * Aborts an in-flight stream by `requestId`.
   */
  abortStream(requestId: string): boolean {
    const ctrl = this.activeStreams.get(requestId);
    if (ctrl) {
      ctrl.abort();
      this.activeStreams.delete(requestId);
      return true;
    }
    return false;
  }

  /**
   * Aborts all active streams (e.g. on `before-quit` per 07_P3 §13).
   */
  abortAllStreams(): void {
    for (const [id, ctrl] of this.activeStreams.entries()) {
      ctrl.abort();
      this.activeStreams.delete(id);
    }
  }
}
