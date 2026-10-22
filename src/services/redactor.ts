/**
 * Central Redactor & Sanitizer Service (§13A Diagnostics Bundle, Chat History & Canary Protection).
 * Removes secrets, token-like strings, query-string credentials, and hashes custom hosts.
 */

const SECRET_PATTERNS: RegExp[] = [
  /CANARY-[A-Za-z0-9_-]{4,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bgsk_[A-Za-z0-9_-]{8,}\b/g,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
  /\bnvapi-[A-Za-z0-9_-]{8,}\b/g,
  /\bcsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bhf_[A-Za-z0-9_-]{8,}\b/g,
  /\bxai-[A-Za-z0-9_-]{8,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:key|api_key|apikey|token|access_token|secret)=)[^&\s"']+/gi,
];

const registeredCanariesOrSecrets = new Set<string>();

export class RedactorService {
  /**
   * Register a known secret value (or canary) so any occurrence or substring >= 6 chars
   * can be scrubbed by the redactor if it ever reaches an output surface.
   */
  static registerSensitiveValue(secret: string): void {
    const trimmed = secret.trim();
    if (trimmed.length >= 6) {
      registeredCanariesOrSecrets.add(trimmed);
    }
  }

  static clearRegisteredValues(): void {
    registeredCanariesOrSecrets.clear();
  }

  /**
   * Redact a string of any known secrets, token patterns, and query-string keys.
   */
  static redactString(input: string, extraSecrets: string[] = []): string {
    if (!input) return input;
    let out = input;

    const allSecrets = [...registeredCanariesOrSecrets, ...extraSecrets];
    for (const sec of allSecrets) {
      if (!sec || sec.length < 6) continue;
      // Replace full secret first
      out = out.split(sec).join('[REDACTED_SECRET]');
      // Also check 6+ char prefixes/suffixes/chunks if part of a known secret
      if (sec.length >= 12) {
        const prefix8 = sec.slice(0, 8);
        const suffix8 = sec.slice(-8);
        const mid8 = sec.slice(Math.floor(sec.length / 2) - 4, Math.floor(sec.length / 2) + 4);
        for (const sub of [prefix8, suffix8, mid8]) {
          if (sub.length >= 6 && out.includes(sub)) {
            out = out.split(sub).join('[REDACTED]');
          }
        }
      }
    }

    for (const pattern of SECRET_PATTERNS) {
      out = out.replace(pattern, (match, group1) => {
        if (group1) return `${group1}[REDACTED]`;
        return '[REDACTED_SECRET]';
      });
    }

    return out;
  }

  /**
   * Deep-redact any JSON-serializable value.
   */
  static redactObject<T>(obj: T, extraSecrets: string[] = []): T {
    if (obj === null || obj === undefined) return obj;
    const serialized = JSON.stringify(obj);
    const redacted = this.redactString(serialized, extraSecrets);
    return JSON.parse(redacted) as T;
  }

  /**
   * Deterministic non-reversible hash for custom hostnames (§13A Diagnostics bundle).
   */
  static hashCustomHost(host: string): string {
    const normalized = host.trim().toLowerCase();
    // FNV-1a 64-bit style deterministic hex hash (sync, works in browser & Node)
    let h1 = 0xdeadbeef ^ normalized.length;
    let h2 = 0x41c6ce57 ^ normalized.length;
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hex = (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
    return `custom-host#${hex}`;
  }

  /**
   * Strip query strings and credentials from any URL.
   */
  static sanitizeUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return '[INVALID_URL]';
    }
  }

  /**
   * Check whether a string contains the secret or any substring of length >= minLen (§13A Canary-secret test).
   */
  static containsSecretOrSubstring(content: string, secret: string, minLen: number = 6): boolean {
    if (!content || !secret) return false;
    if (content.includes(secret)) return true;
    const trimmed = secret.trim();
    if (trimmed.length < minLen) return content.includes(trimmed);
    for (let i = 0; i <= trimmed.length - minLen; i++) {
      const sub = trimmed.slice(i, i + minLen);
      if (content.includes(sub)) {
        return true;
      }
    }
    return false;
  }
}

