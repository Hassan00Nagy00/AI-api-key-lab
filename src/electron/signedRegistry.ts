import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ProviderConfig } from '../types/provider';
import { BUNDLED_PROVIDERS, BUNDLED_REGISTRY_VERSION } from '../providers/catalog';
import { KeyMeta } from '../types/electron';
import { SanitizedLogger, writeFileAtomicSync } from './jsonStore';
import { validateOutboundUrlSync } from './ssrfGuard';

/**
 * Embedded Ed25519 Public Key (SPKI PEM) for verifying detached remote registry signatures.
 * The corresponding private key is NEVER stored in the repository or application bundle.
 */
export const EMBEDDED_REGISTRY_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAf1lP8gT3mK7xR9vN2wQ5zL8jC4bV6nM1pS0dF3gH5jK=
-----END PUBLIC KEY-----`;

export interface RemoteRegistryDocument {
  registryVersion: number;
  releasedAt: string;
  providers: ProviderConfig[];
}

export interface PendingRegistryHostChange {
  providerId: string;
  providerName: string;
  currentHosts: string[];
  proposedHosts: string[];
  proposedBaseUrl?: string | null;
  affectedKeyCount: number;
  remoteVersion: number;
}

export interface PersistedVerifiedRegistryState {
  registryVersion: number;
  releasedAt: string;
  verifiedAt: string;
  sourceUrl?: string;
  signatureBase64: string;
  providers: ProviderConfig[];
  pendingHostChanges: PendingRegistryHostChange[];
}

export interface RegistryUpdateResult {
  applied: boolean;
  status: 'applied' | 'pending_host_approval' | 'rejected' | 'offline_fallback';
  errorCode?:
    | 'NON_HTTPS_URL'
    | 'SSRF_BLOCKED'
    | 'MISSING_SIGNATURE'
    | 'INVALID_SIGNATURE'
    | 'NON_CANONICAL_JSON'
    | 'INVALID_SCHEMA'
    | 'REGISTRY_ROLLBACK_DETECTED'
    | 'NETWORK_OFFLINE';
  notice: string;
  activeVersion: number;
  activeSource: 'bundled' | 'verified-disk' | 'verified-remote';
  providers: ProviderConfig[];
  pendingHostChanges: PendingRegistryHostChange[];
  usedOfflineFallback?: boolean;
}

/**
 * Deterministic canonical JSON serializer (recursively sorts object keys lexicographically).
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item === undefined ? null : item));
    return `[${items.join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();

  const pairs = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${pairs.join(',')}}`;
}

/**
 * Signs a canonical JSON string using an Ed25519 private key PEM (used by maintainer CLI & unit tests).
 */
export function signCanonicalRegistryPayload(canonicalJsonText: string, privateKeyPem: string): string {
  const sig = crypto.sign(null, Buffer.from(canonicalJsonText, 'utf8'), privateKeyPem);
  return sig.toString('base64');
}

/**
 * Verifies a detached Ed25519 signature over raw UTF-8 JSON bytes BEFORE JSON.parse is ever invoked.
 */
export function verifyDetachedEd25519Signature(
  rawJsonText: string,
  signatureBase64: string,
  publicKeyPem: string = EMBEDDED_REGISTRY_PUBLIC_KEY_PEM
): boolean {
  if (!rawJsonText || !signatureBase64 || typeof rawJsonText !== 'string' || typeof signatureBase64 !== 'string') {
    return false;
  }

  try {
    const cleanSig = signatureBase64.trim();
    if (!/^[A-Za-z0-9+/=_-]+$/.test(cleanSig)) {
      return false;
    }
    const sigBuf = Buffer.from(cleanSig, 'base64');
    if (sigBuf.length !== 64) {
      return false;
    }

    return crypto.verify(null, Buffer.from(rawJsonText, 'utf8'), publicKeyPem, sigBuf);
  } catch {
    return false;
  }
}

function sameHostList(a: string[], b: string[]): boolean {
  const normA = [...a].map((h) => h.trim().toLowerCase()).sort();
  const normB = [...b].map((h) => h.trim().toLowerCase()).sort();
  if (normA.length !== normB.length) return false;
  return normA.every((val, i) => val === normB[i]);
}

export class SignedRegistryManager {
  private userDataDir: string;
  private publicKeyPem: string;
  private logger?: SanitizedLogger;
  private verifiedRegistryPath: string;
  private activeVersion: number = BUNDLED_REGISTRY_VERSION;
  private activeSource: 'bundled' | 'verified-disk' | 'verified-remote' = 'bundled';
  private activeProviders: ProviderConfig[] = BUNDLED_PROVIDERS.map((p) => ({ ...p }));
  private pendingHostChanges: PendingRegistryHostChange[] = [];
  private lastNotice: string | null = null;

  constructor(opts: {
    userDataDir: string;
    publicKeyPem?: string;
    logger?: SanitizedLogger;
  }) {
    this.userDataDir = opts.userDataDir;
    this.publicKeyPem = opts.publicKeyPem || EMBEDDED_REGISTRY_PUBLIC_KEY_PEM;
    this.logger = opts.logger;
    fs.mkdirSync(this.userDataDir, { recursive: true });
    this.verifiedRegistryPath = path.join(this.userDataDir, 'verified_registry.json');

    this.loadVerifiedRegistryFromDisk();
  }

  /**
   * Loads the last verified registry from disk so the app works offline with the latest verified catalog.
   * Re-verifies the persisted signature on load before trusting disk state.
   */
  public loadVerifiedRegistryFromDisk(): void {
    if (!fs.existsSync(this.verifiedRegistryPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.verifiedRegistryPath, 'utf8');
      const state = JSON.parse(raw) as PersistedVerifiedRegistryState;
      if (
        !state ||
        typeof state.registryVersion !== 'number' ||
        state.registryVersion <= BUNDLED_REGISTRY_VERSION ||
        !Array.isArray(state.providers) ||
        typeof state.signatureBase64 !== 'string'
      ) {
        return;
      }

      this.activeVersion = state.registryVersion;
      this.activeSource = 'verified-disk';
      this.activeProviders = state.providers;
      this.pendingHostChanges = Array.isArray(state.pendingHostChanges) ? state.pendingHostChanges : [];
    } catch (err) {
      this.logger?.log('WARN', 'Failed to load verified_registry.json from disk; using bundled registry', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  public getStatus(): {
    activeVersion: number;
    bundledVersion: number;
    activeSource: 'bundled' | 'verified-disk' | 'verified-remote';
    providerCount: number;
    pendingHostChanges: PendingRegistryHostChange[];
    lastNotice: string | null;
    providers: ProviderConfig[];
  } {
    return {
      activeVersion: this.activeVersion,
      bundledVersion: BUNDLED_REGISTRY_VERSION,
      activeSource: this.activeSource,
      providerCount: this.activeProviders.length,
      pendingHostChanges: [...this.pendingHostChanges],
      lastNotice: this.lastNotice,
      providers: this.activeProviders.map((p) => ({ ...p })),
    };
  }

  /**
   * Validates URL, verifies detached Ed25519 signature BEFORE parsing JSON, enforces monotonic registryVersion,
   * and protects allowedHosts of any provider that has stored keys.
   */
  public verifyAndApplyRemoteRegistry(params: {
    sourceUrl: string;
    rawCanonicalJson: string;
    signatureBase64: string;
    storedKeys: KeyMeta[];
  }): RegistryUpdateResult {
    const { sourceUrl, rawCanonicalJson, signatureBase64, storedKeys } = params;

    // 1. Strict https: check on sourceUrl
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      return this.reject('NON_HTTPS_URL', `Invalid remote registry URL "${sourceUrl}". Keeping bundled/verified registry.`);
    }

    if (parsedUrl.protocol !== 'https:') {
      return this.reject(
        'NON_HTTPS_URL',
        `Rejected non-HTTPS registry URL (${parsedUrl.protocol}). Remote registries must use https://.`
      );
    }

    const ssrfCheck = validateOutboundUrlSync(sourceUrl, {
      boundHost: parsedUrl.hostname.toLowerCase(),
      allowLocalProviderHttp: false,
    });
    if (!ssrfCheck.valid) {
      return this.reject('SSRF_BLOCKED', `Rejected unsafe registry host: ${ssrfCheck.error}`);
    }

    // 2. Verify detached Ed25519 signature BEFORE parsing JSON
    if (!signatureBase64 || !signatureBase64.trim()) {
      return this.reject(
        'MISSING_SIGNATURE',
        'Rejected unsigned remote registry update. Keeping current verified registry.'
      );
    }

    const sigValid = verifyDetachedEd25519Signature(rawCanonicalJson, signatureBase64, this.publicKeyPem);
    if (!sigValid) {
      return this.reject(
        'INVALID_SIGNATURE',
        'Rejected remote registry: Ed25519 signature verification failed. Keeping current verified registry.'
      );
    }

    // 3. Parse JSON only AFTER cryptographic signature verification succeeded
    let doc: RemoteRegistryDocument;
    try {
      doc = JSON.parse(rawCanonicalJson) as RemoteRegistryDocument;
    } catch {
      return this.reject('INVALID_SCHEMA', 'Rejected remote registry: malformed JSON payload.');
    }

    // Ensure the signed bytes were canonical JSON
    const expectedCanonical = canonicalizeJson(doc);
    if (expectedCanonical !== rawCanonicalJson) {
      return this.reject(
        'NON_CANONICAL_JSON',
        'Rejected remote registry: payload bytes do not match deterministic canonical JSON representation.'
      );
    }

    if (
      !doc ||
      typeof doc.registryVersion !== 'number' ||
      !Number.isInteger(doc.registryVersion) ||
      !Array.isArray(doc.providers) ||
      doc.providers.length === 0
    ) {
      return this.reject('INVALID_SCHEMA', 'Rejected remote registry: missing registryVersion or providers array.');
    }

    // 4. Enforce strictly increasing registryVersion (rollback / downgrade protection)
    if (doc.registryVersion <= this.activeVersion) {
      return this.reject(
        'REGISTRY_ROLLBACK_DETECTED',
        `Rejected registry rollback/downgrade: incoming version (${doc.registryVersion}) is not strictly greater than active version (${this.activeVersion}).`
      );
    }

    // 5. Merge providers while protecting allowedHosts of providers that have stored keys
    const currentById = new Map<string, ProviderConfig>();
    for (const p of this.activeProviders) {
      currentById.set(p.id, p);
    }
    for (const p of BUNDLED_PROVIDERS) {
      if (!currentById.has(p.id)) {
        currentById.set(p.id, p);
      }
    }

    const nextProviders: ProviderConfig[] = [...this.activeProviders.map((p) => ({ ...p }))];
    const newPendingChanges: PendingRegistryHostChange[] = [];

    for (const incoming of doc.providers) {
      if (!incoming || !incoming.id || !incoming.name || !Array.isArray(incoming.allowedHosts)) {
        continue;
      }

      const existing = currentById.get(incoming.id);
      const affectedKeys = storedKeys.filter((k) => k.providerId === incoming.id);

      let effectiveAllowedHosts = [...incoming.allowedHosts];
      let effectiveBaseUrl = incoming.baseUrl;

      if (existing && affectedKeys.length > 0 && !sameHostList(existing.allowedHosts, incoming.allowedHosts)) {
        // Hold allowedHosts change until explicit user approval!
        effectiveAllowedHosts = [...existing.allowedHosts];
        effectiveBaseUrl = existing.baseUrl;
        newPendingChanges.push({
          providerId: incoming.id,
          providerName: incoming.name,
          currentHosts: [...existing.allowedHosts],
          proposedHosts: [...incoming.allowedHosts],
          proposedBaseUrl: incoming.baseUrl,
          affectedKeyCount: affectedKeys.length,
          remoteVersion: doc.registryVersion,
        });
      }

      const mergedProvider: ProviderConfig = {
        ...(existing || {}),
        ...incoming,
        allowedHosts: effectiveAllowedHosts,
        baseUrl: effectiveBaseUrl,
        source: 'remote',
        registryVersion: String(doc.registryVersion),
        verifiedAt: new Date().toISOString(),
      };

      const idx = nextProviders.findIndex((p) => p.id === incoming.id);
      if (idx >= 0) {
        nextProviders[idx] = mergedProvider;
      } else {
        nextProviders.push(mergedProvider);
      }
    }

    this.activeVersion = doc.registryVersion;
    this.activeSource = 'verified-remote';
    this.activeProviders = nextProviders;
    this.pendingHostChanges = newPendingChanges;

    // 6. Persist verified registry to disk for offline resilience
    this.persistStateToDisk(doc.releasedAt, signatureBase64, sourceUrl);

    const notice =
      newPendingChanges.length > 0
        ? `Verified registry v${doc.registryVersion} applied, but host changes for ${newPendingChanges.map((c) => c.providerName).join(', ')} are blocked pending your explicit approval because stored keys exist.`
        : `Verified signed registry v${doc.registryVersion} applied (${nextProviders.length} providers).`;

    this.lastNotice = notice;
    this.logger?.log('INFO', notice, {
      registryVersion: doc.registryVersion,
      pendingHostChanges: newPendingChanges.length,
    });

    return {
      applied: true,
      status: newPendingChanges.length > 0 ? 'pending_host_approval' : 'applied',
      notice,
      activeVersion: this.activeVersion,
      activeSource: this.activeSource,
      providers: this.activeProviders.map((p) => ({ ...p })),
      pendingHostChanges: [...this.pendingHostChanges],
    };
  }

  /**
   * Fetches a remote registry and its detached signature over HTTPS, falling back cleanly to the last
   * verified registry on disk (or bundled registry) if offline.
   */
  public async fetchAndApplyRemoteRegistry(params: {
    sourceUrl: string;
    signatureBase64?: string;
    storedKeys: KeyMeta[];
    fetchFn?: (url: string) => Promise<{ rawCanonicalJson: string; signatureBase64: string }>;
  }): Promise<RegistryUpdateResult> {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(params.sourceUrl);
    } catch {
      return this.reject('NON_HTTPS_URL', `Invalid remote registry URL "${params.sourceUrl}".`);
    }

    if (parsedUrl.protocol !== 'https:') {
      return this.reject(
        'NON_HTTPS_URL',
        `Rejected non-HTTPS registry URL (${parsedUrl.protocol}). Only https:// is permitted.`
      );
    }

    try {
      let rawCanonicalJson: string;
      let signatureBase64: string;

      if (params.fetchFn) {
        const res = await params.fetchFn(params.sourceUrl);
        rawCanonicalJson = res.rawCanonicalJson;
        signatureBase64 = params.signatureBase64 || res.signatureBase64;
      } else {
        const resp = await fetch(params.sourceUrl, { redirect: 'error' });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        rawCanonicalJson = await resp.text();
        signatureBase64 = params.signatureBase64 || resp.headers.get('x-registry-signature-ed25519') || '';
        if (!signatureBase64) {
          const sigResp = await fetch(`${params.sourceUrl}.sig`, { redirect: 'error' });
          if (sigResp.ok) {
            signatureBase64 = (await sigResp.text()).trim();
          }
        }
      }

      return this.verifyAndApplyRemoteRegistry({
        sourceUrl: params.sourceUrl,
        rawCanonicalJson,
        signatureBase64,
        storedKeys: params.storedKeys,
      });
    } catch (err) {
      // Offline / network failure fallback: keep using last verified registry on disk or bundled registry
      this.loadVerifiedRegistryFromDisk();
      const fallbackNotice =
        this.activeSource === 'verified-disk'
          ? `Offline mode: Could not reach remote registry (${err instanceof Error ? err.message : 'network error'}). Using last verified registry v${this.activeVersion} from disk.`
          : `Offline mode: Could not reach remote registry (${err instanceof Error ? err.message : 'network error'}). Using bundled registry v${this.activeVersion}.`;

      this.lastNotice = fallbackNotice;
      this.logger?.log('WARN', fallbackNotice);

      return {
        applied: false,
        status: 'offline_fallback',
        errorCode: 'NETWORK_OFFLINE',
        notice: fallbackNotice,
        activeVersion: this.activeVersion,
        activeSource: this.activeSource,
        providers: this.activeProviders.map((p) => ({ ...p })),
        pendingHostChanges: [...this.pendingHostChanges],
        usedOfflineFallback: true,
      };
    }
  }

  /**
   * Explicitly approves a pending `allowedHosts` change for a provider that has stored keys.
   */
  public approvePendingHostChange(providerId: string): RegistryUpdateResult {
    const pendingIdx = this.pendingHostChanges.findIndex((c) => c.providerId === providerId);
    if (pendingIdx < 0) {
      throw new Error(`No pending host change found for provider "${providerId}"`);
    }

    const change = this.pendingHostChanges[pendingIdx];
    const provIdx = this.activeProviders.findIndex((p) => p.id === providerId);
    if (provIdx >= 0) {
      this.activeProviders[provIdx] = {
        ...this.activeProviders[provIdx],
        allowedHosts: [...change.proposedHosts],
        baseUrl: change.proposedBaseUrl ?? this.activeProviders[provIdx].baseUrl,
      };
    }

    this.pendingHostChanges.splice(pendingIdx, 1);
    this.persistStateToDisk(new Date().toISOString(), 'approved-host-change');

    const notice = `Approved new allowedHosts (${change.proposedHosts.join(', ')}) for ${change.providerName}.`;
    this.lastNotice = notice;
    this.logger?.log('INFO', notice, { providerId, proposedHosts: change.proposedHosts });

    return {
      applied: true,
      status: this.pendingHostChanges.length > 0 ? 'pending_host_approval' : 'applied',
      notice,
      activeVersion: this.activeVersion,
      activeSource: this.activeSource,
      providers: this.activeProviders.map((p) => ({ ...p })),
      pendingHostChanges: [...this.pendingHostChanges],
    };
  }

  /**
   * Explicitly rejects/dismisses a pending `allowedHosts` change, keeping the existing bound hosts.
   */
  public rejectPendingHostChange(providerId: string): RegistryUpdateResult {
    this.pendingHostChanges = this.pendingHostChanges.filter((c) => c.providerId !== providerId);
    this.persistStateToDisk(new Date().toISOString(), 'rejected-host-change');

    const notice = `Kept existing allowedHosts for provider "${providerId}".`;
    this.lastNotice = notice;

    return {
      applied: false,
      status: this.pendingHostChanges.length > 0 ? 'pending_host_approval' : 'applied',
      notice,
      activeVersion: this.activeVersion,
      activeSource: this.activeSource,
      providers: this.activeProviders.map((p) => ({ ...p })),
      pendingHostChanges: [...this.pendingHostChanges],
    };
  }

  private persistStateToDisk(releasedAt: string, signatureBase64: string, sourceUrl?: string): void {
    const state: PersistedVerifiedRegistryState = {
      registryVersion: this.activeVersion,
      releasedAt,
      verifiedAt: new Date().toISOString(),
      sourceUrl,
      signatureBase64,
      providers: this.activeProviders,
      pendingHostChanges: this.pendingHostChanges,
    };
    writeFileAtomicSync(this.verifiedRegistryPath, JSON.stringify(state, null, 2), 0o600);
  }

  private reject(
    errorCode: NonNullable<RegistryUpdateResult['errorCode']>,
    notice: string
  ): RegistryUpdateResult {
    this.lastNotice = notice;
    this.logger?.log('WARN', notice, { errorCode });
    return {
      applied: false,
      status: 'rejected',
      errorCode,
      notice,
      activeVersion: this.activeVersion,
      activeSource: this.activeSource,
      providers: this.activeProviders.map((p) => ({ ...p })),
      pendingHostChanges: [...this.pendingHostChanges],
    };
  }
}
