import dns from 'node:dns';
import net from 'node:net';

export interface SsrfValidationOptions {
  boundHost?: string;
  providerId?: string;
  allowLocalProviderHttp?: boolean; // True only when provider is local (ollama/lmstudio/custom-local) AND user consented
  dnsLookup?: (hostname: string) => Promise<{ address: string; family: number }[]>;
}

const LOCAL_PROVIDER_IDS = new Set(['ollama', 'lmstudio', 'custom-local', 'local']);

/**
 * Parse an IPv4 dotted-quad string into a 32-bit unsigned integer.
 * Returns null if not a valid dotted-quad IPv4 address.
 */
export function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result >>> 0;
}

function inCidrV4(ipUint32: number, networkIp: string, prefixBits: number): boolean {
  const netUint32 = parseIpv4ToUint32(networkIp);
  if (netUint32 === null) return false;
  const mask = prefixBits === 0 ? 0 : (~0 << (32 - prefixBits)) >>> 0;
  return (ipUint32 & mask) >>> 0 === (netUint32 & mask) >>> 0;
}

/**
 * Checks whether an IPv4 or IPv6 literal belongs to a blocked private, loopback,
 * link-local, metadata, multicast, CGNAT, or IPv4-mapped IPv6 range per §2 & §15.
 */
export function isBlockedIpAddress(
  rawIp: string,
  options?: { allowLoopback?: boolean }
): { blocked: boolean; reason?: string } {
  const cleaned = rawIp.trim().replace(/^\[|\]$/g, '').toLowerCase();

  // Check if IPv4-mapped IPv6 in dotted notation (e.g., ::ffff:127.0.0.1 or 0:0:0:0:0:ffff:169.254.169.254)
  const v4MappedDottedMatch = cleaned.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4MappedDottedMatch) {
    const innerRes = isBlockedIpAddress(v4MappedDottedMatch[1], options);
    if (innerRes.blocked) {
      return {
        blocked: true,
        reason: `IPv4-mapped IPv6 address (${cleaned}) maps to blocked IPv4: ${innerRes.reason}`,
      };
    }
    return { blocked: false };
  }

  // Check if IPv4-mapped IPv6 in hex-word notation (e.g., ::ffff:7f00:1 or ::ffff:a9fe:a9fe)
  const v4MappedHexMatch = cleaned.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (v4MappedHexMatch) {
    const hi = parseInt(v4MappedHexMatch[1], 16);
    const lo = parseInt(v4MappedHexMatch[2], 16);
    const dotted = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    const innerRes = isBlockedIpAddress(dotted, options);
    if (innerRes.blocked) {
      return {
        blocked: true,
        reason: `IPv4-mapped IPv6 address (${cleaned} -> ${dotted}) maps to blocked IPv4: ${innerRes.reason}`,
      };
    }
    return { blocked: false };
  }

  const ipVersion = net.isIP(cleaned);
  if (ipVersion === 4) {
    const ipNum = parseIpv4ToUint32(cleaned);
    if (ipNum === null) {
      return { blocked: true, reason: `Malformed IPv4 address: ${cleaned}` };
    }

    // Cloud metadata & Link-local (169.254.0.0/16) — ALWAYS blocked even if local loopback is allowed
    if (inCidrV4(ipNum, '169.254.0.0', 16)) {
      return {
        blocked: true,
        reason: `SSRF protection: Link-local / Cloud metadata range (169.254.0.0/16) is strictly blocked (${cleaned})`,
      };
    }

    // 0.0.0.0/8 ("this" network) — ALWAYS blocked
    if (inCidrV4(ipNum, '0.0.0.0', 8)) {
      return {
        blocked: true,
        reason: `SSRF protection: Unspecified network range (0.0.0.0/8) is strictly blocked (${cleaned})`,
      };
    }

    // Loopback (127.0.0.0/8)
    if (inCidrV4(ipNum, '127.0.0.0', 8)) {
      if (options?.allowLoopback) {
        return { blocked: false };
      }
      return {
        blocked: true,
        reason: `SSRF protection: Loopback address (${cleaned}) is blocked without explicit local provider consent`,
      };
    }

    // RFC1918 Private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
    if (
      inCidrV4(ipNum, '10.0.0.0', 8) ||
      inCidrV4(ipNum, '172.16.0.0', 12) ||
      inCidrV4(ipNum, '192.168.0.0', 16)
    ) {
      return {
        blocked: true,
        reason: `SSRF protection: Private RFC1918 network address (${cleaned}) is blocked`,
      };
    }

    // CGNAT (100.64.0.0/10)
    if (inCidrV4(ipNum, '100.64.0.0', 10)) {
      return {
        blocked: true,
        reason: `SSRF protection: Carrier-Grade NAT range (100.64.0.0/10) is blocked (${cleaned})`,
      };
    }

    // Multicast (224.0.0.0/4) and Reserved/Broadcast (240.0.0.0/4)
    if (inCidrV4(ipNum, '224.0.0.0', 4) || inCidrV4(ipNum, '240.0.0.0', 4)) {
      return {
        blocked: true,
        reason: `SSRF protection: Multicast/reserved range is blocked (${cleaned})`,
      };
    }

    return { blocked: false };
  }

  if (ipVersion === 6) {
    if (cleaned === '::' || cleaned === '0:0:0:0:0:0:0:0') {
      return { blocked: true, reason: 'SSRF protection: Unspecified IPv6 address (::) is blocked' };
    }

    if (cleaned === '::1' || cleaned === '0:0:0:0:0:0:0:1') {
      if (options?.allowLoopback) {
        return { blocked: false };
      }
      return {
        blocked: true,
        reason: 'SSRF protection: IPv6 loopback (::1) is blocked without explicit local provider consent',
      };
    }

    // Unique-local fc00::/7 (starts with fc or fd)
    if (/^f[cd][0-9a-f]{0,2}:/i.test(cleaned)) {
      return {
        blocked: true,
        reason: `SSRF protection: IPv6 Unique-Local range (fc00::/7) is blocked (${cleaned})`,
      };
    }

    // Link-local fe80::/10 (starts with fe8, fe9, fea, feb)
    if (/^fe[89ab][0-9a-f]:/i.test(cleaned)) {
      return {
        blocked: true,
        reason: `SSRF protection: IPv6 Link-Local range (fe80::/10) is blocked (${cleaned})`,
      };
    }

    // Multicast ff00::/8
    if (/^ff[0-9a-f]{2}:/i.test(cleaned)) {
      return {
        blocked: true,
        reason: `SSRF protection: IPv6 Multicast range (ff00::/8) is blocked (${cleaned})`,
      };
    }

    return { blocked: false };
  }

  return { blocked: false };
}

/**
 * Synchronously validates the URL structure, scheme, credentials, boundHost, and literal IP rules.
 */
export function validateOutboundUrlSync(
  rawUrl: string,
  options: SsrfValidationOptions = {}
): { valid: true; parsedUrl: URL; allowLoopback: boolean } | { valid: false; error: string } {
  if (!rawUrl || typeof rawUrl !== 'string' || /[\u0000-\u001F\u007F]/.test(rawUrl)) {
    return { valid: false, error: 'Invalid URL: Contains control characters or is empty' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return { valid: false, error: `Invalid URL format: ${rawUrl}` };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'Embedded credentials in request URL are prohibited' };
  }

  const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLoopbackHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';

  // Host binding check (must run before any secret substitution or network call)
  if (options.boundHost) {
    const expectedHost = options.boundHost.toLowerCase().replace(/^\[|\]$/g, '');
    if (host !== expectedHost) {
      return {
        valid: false,
        error: `Host binding violation: Request target "${host}" does not match key bound host "${expectedHost}"`,
      };
    }
  }

  const isLocalProvider = !options.providerId || LOCAL_PROVIDER_IDS.has(options.providerId);
  const allowLoopback = Boolean(options.allowLocalProviderHttp && isLocalProvider && isLoopbackHost);

  // Scheme validation
  if (parsedUrl.protocol === 'http:') {
    if (!allowLoopback) {
      return {
        valid: false,
        error: `Insecure protocol: http: is not allowed for "${host}". HTTPS is required (local HTTP requires explicit local provider consent).`,
      };
    }
  } else if (parsedUrl.protocol !== 'https:') {
    return {
      valid: false,
      error: `Disallowed protocol "${parsedUrl.protocol}". Only https: is permitted.`,
    };
  }

  // If hostname is a literal IP, validate immediately against SSRF ranges
  if (net.isIP(host) !== 0 || host.startsWith('::ffff:')) {
    const ipCheck = isBlockedIpAddress(host, { allowLoopback });
    if (ipCheck.blocked) {
      return { valid: false, error: ipCheck.reason || `Blocked IP address: ${host}` };
    }
  } else if (host === 'localhost' && !allowLoopback) {
    return {
      valid: false,
      error: 'SSRF protection: Loopback host (localhost) is blocked without explicit local provider consent',
    };
  }

  return { valid: true, parsedUrl, allowLoopback };
}

/**
 * Full async SSRF & DNS-rebinding validator:
 * 1. Validates URL structure, scheme, boundHost, and literal IP ranges.
 * 2. Resolves hostname via DNS (`dns.promises.lookup(host, { all: true })`) at connect time
 *    and verifies EVERY resolved IP address against the blocked IP ranges.
 */
export async function validateAndResolveOutboundUrl(
  rawUrl: string,
  options: SsrfValidationOptions = {}
): Promise<{ valid: true; parsedUrl: URL; resolvedAddresses: string[] } | { valid: false; error: string }> {
  const syncCheck = validateOutboundUrlSync(rawUrl, options);
  if (!syncCheck.valid) {
    return syncCheck;
  }

  const { parsedUrl, allowLoopback } = syncCheck;
  const host = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // If literal IP, no DNS lookup required
  if (net.isIP(host) !== 0) {
    return { valid: true, parsedUrl, resolvedAddresses: [host] };
  }

  const lookupFn =
    options.dnsLookup ||
    (async (h: string) => {
      const records = await dns.promises.lookup(h, { all: true, verbatim: true });
      return records;
    });

  let records: { address: string; family: number }[];
  try {
    records = await lookupFn(host);
  } catch (err: unknown) {
    return {
      valid: false,
      error: `DNS resolution failed for "${host}": ${err instanceof Error ? err.message : 'Unknown DNS error'}`,
    };
  }

  if (!records || records.length === 0) {
    return {
      valid: false,
      error: `DNS resolution returned no addresses for "${host}"`,
    };
  }

  const resolvedAddresses: string[] = [];
  for (const rec of records) {
    const ipCheck = isBlockedIpAddress(rec.address, { allowLoopback });
    if (ipCheck.blocked) {
      return {
        valid: false,
        error: `DNS rebinding / SSRF blocked: Host "${host}" resolved to restricted IP "${rec.address}" (${ipCheck.reason})`,
      };
    }
    resolvedAddresses.push(rec.address);
  }

  return { valid: true, parsedUrl, resolvedAddresses };
}
