# SECURITY.md — Security Architecture & Controls

## 1. Secret Handling & Mechanical Late Binding (`AGENTS.md` & `07_P3 §2, §6`)

1. **Zero Secret Exposure in Renderer, Logs, or URLs**:
   - Raw API keys never enter React state (except the transient input field while typing a new key, which is cleared immediately on save), Redux/context stores, `localStorage`, history, diagnostics bundles, or logs.
   - Query-string keys (`?key=`) are strictly forbidden; Google Gemini authenticates exclusively via the `x-goog-api-key` HTTP header.
   - Masked keys display only the prefix and last 4 characters (`sk-••••7F3A`).
   - All errors and logs pass through `redactSecretsFromText` (`src/services/redactor.ts` and `src/electron/jsonStore.ts`), scrubbing exact secrets, substrings $\ge 6$ characters, Bearer tokens, and provider key patterns.

2. **Mechanical Late Binding**:
   - All 5 provider adapters (`OpenAICompatibleAdapter`, `AnthropicCompatibleAdapter`, `GeminiAdapter`, `CohereAdapter`, `GenericRestAdapter`) construct `PreparedRequest` objects containing only the `"{{secret}}"` placeholder.
   - Only `ApiExecutor` (`src/services/executor.ts`), `SecretStore` (`src/services/secretStore.ts`), and the Electron Main-Process bridge (`src/electron/secretStore.ts`, `src/electron/mainExecutor.ts`) may access the underlying secret vault. Enforced mechanically by `npm run lint` (`scripts/checkArchitecture.ts`) and automated tests.

3. **Host Binding, Redirect Refusal & Connect-Time SSRF Protection (`07_P3 §5 & §9`)**:
   - Every key is bound to its provider's `allowedHosts` at creation (`boundHost`). Re-binding a host requires an explicit user confirmation dialog showing `oldHost -> newHost` and resets the key status to `untested`.
   - `MainProcessExecutor` and `BrowserApiExecutor` enforce `https:` (allowing `http:` only for explicitly consented local providers), reject embedded URL credentials (`user:pass@host`), deny `Host` header overrides, and set `redirect: "manual"` to refuse all `3xx` redirects.
   - In Electron, `MainProcessExecutor` uses a pinned `undici` `Agent` with a connect-time `lookup` guard that blocks loopback (`127.0.0.0/8`, `::1`), RFC 1918 private networks (`10/8`, `172.16/12`, `192.168/16`), link-local and cloud metadata (`169.254.0.0/16`, `fe80::/10`), CGNAT (`100.64.0.0/10`), multicast, `0.0.0.0/8`, unique-local IPv6 (`fc00::/7`), and IPv4-mapped IPv6 (`::ffff:0:0/96`) at socket connection time to defeat DNS rebinding.
   - When the optional **"Use system proxy"** setting is enabled (`undici` `ProxyAgent`), the proxy resolves the final destination IP, so the connect-time IP guarantee is weaker; in this mode, literal-host checks, local pre-resolution DNS checks, `https:`-only, and approved-hosts-only checks are enforced before sending the request.

## 2. Storage Tiers & Keychain / WebCrypto Vaults (`07_P3 §6 & §8`)

- **macOS Desktop Tier (`src/electron/secretStore.ts`)**:
  - Uses Electron `safeStorage` backed by the macOS Keychain to encrypt each secret into `secrets.vault.json` using atomic writes (`0o600`).
  - Fails closed (`ERR_KEYCHAIN_UNAVAILABLE`) if Keychain encryption is unavailable or decryption fails — never falls back to plaintext.
  - Sensitive operations (`revealSecret`, `copySecret`, exporting secrets, host re-binding, erasing all data) are gated behind `systemPreferences.promptTouchID()` when available, or a native confirmation dialog.
  - `copySecret` marks the macOS pasteboard with `org.nspasteboard.ConcealedType` and clears the clipboard after 30 seconds if unchanged. Note that third-party clipboard managers and Apple Universal Clipboard (Handoff) may still retain copies.
- **Browser Tier (`src/services/secretVault.ts`)**:
  - Encrypts secrets with WebCrypto `PBKDF2-HMAC-SHA256` ($\ge 600,000$ iterations, 16-byte random salt) and `AES-256-GCM` (12-byte random IV, 128-bit tag), holding a non-extractable `CryptoKey` in memory with idle auto-lock.
  - When no passphrase is set, the UI displays a persistent honesty warning stating that keys are not encrypted at rest.

## 3. Versioned Encrypted Backups (`07_P3 §8`)

Encrypted backups bind header metadata (`format`, `version`, `createdAt`, `kdf`, `cipher`) as AES-GCM Additional Authenticated Data (AAD) with a fresh 16-byte salt and 12-byte IV on every export:
```json
{
  "format": "ai-api-key-lab-backup",
  "version": 1,
  "createdAt": "2026-10-22T00:00:00.000Z",
  "encrypted": true,
  "kdf": {
    "name": "PBKDF2-HMAC-SHA256",
    "iterations": 600000,
    "salt": "<base64>"
  },
  "cipher": {
    "name": "AES-256-GCM",
    "iv": "<base64>",
    "tagLength": 128
  },
  "payload": "<base64>"
}
```
After decryption, payloads are validated against strict Zod schemas, prototype-pollution keys (`__proto__`, `constructor`, `prototype`) and files $>10\text{ MB}$ are rejected, and duplicate keys are detected by recomputing the salted fingerprint under the destination installation's salt.
