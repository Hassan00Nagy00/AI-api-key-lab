# Signed Registry Updates (Ed25519 Detached Signatures)

AI API Key Lab enforces **cryptographically signed registry updates** so a compromised CDN, MITM proxy, or malicious remote server can never inject untrusted provider definitions, downgrade the registry, or silently redirect existing API keys to a new host.

---

## 1. Security Invariants

1. **Public-Key Only in Application**:
   - The application embeds only the maintainer's **Ed25519 SPKI Public Key** (`EMBEDDED_REGISTRY_PUBLIC_KEY_PEM` in `src/electron/signedRegistry.ts`).
   - The Ed25519 private key is kept strictly offline by the maintainer and is **never** committed to the repository or bundled in the app.
2. **Verify Signature Before Parsing**:
   - Raw UTF-8 bytes of the remote registry are verified against the detached 64-byte Ed25519 signature (`crypto.verify(null, Buffer.from(rawJson, 'utf8'), publicKey, signature)`) **before** `JSON.parse()` or any catalog merge runs.
3. **Canonical JSON Representation**:
   - All object keys are recursively sorted in lexicographical UTF-8 order (`canonicalizeJson`) with zero insignificant whitespace so the signed byte sequence is 100% deterministic.
4. **HTTPS & SSRF Enforcement**:
   - Remote registry URLs must use `https://` and pass the SSRF guard (rejecting loopback, RFC1918 private networks, link-local `169.254.169.254`, and IPv4-mapped IPv6 addresses).
5. **Monotonic `registryVersion` (Anti-Rollback)**:
   - Every registry carries an integer `registryVersion`. Any update with `registryVersion <= activeVersion` is rejected with `REGISTRY_ROLLBACK_DETECTED`.
6. **Host-List Protection for Stored Keys**:
   - Even a cryptographically valid remote registry **cannot** change `allowedHosts` (or `baseUrl`) of any provider for which the user already has stored API keys without explicit user approval (`pending_host_approval`).
7. **Offline Resilience**:
   - The last verified registry is atomically persisted to `verified_registry.json` (`0600` permissions). When offline, the application seamlessly falls back to the last verified registry on disk (or the bundled registry).

---

## 2. Maintainer Workflow: Generating the Ed25519 Key Pair

Generate the Ed25519 key pair on an air-gapped or secure maintainer workstation outside the Git working tree:

```bash
npx tsx scripts/signRegistry.ts --keygen ~/secure-offline-keys/ai-api-key-lab
```

Or using standard OpenSSL:

```bash
# 1. Generate Ed25519 private key (KEEP OFFLINE — NEVER COMMIT)
openssl genpkey -algorithm Ed25519 -out ~/secure-offline-keys/registry-ed25519.priv.pem
chmod 600 ~/secure-offline-keys/registry-ed25519.priv.pem

# 2. Extract Ed25519 public key (SPKI PEM)
openssl pkey -in ~/secure-offline-keys/registry-ed25519.priv.pem -pubout -out ./registry-ed25519.pub.pem
```

Copy the contents of `registry-ed25519.pub.pem` into `EMBEDDED_REGISTRY_PUBLIC_KEY_PEM` in `src/electron/signedRegistry.ts`.

---

## 3. Maintainer Workflow: Signing a Registry Release

1. Prepare the registry JSON document with a strictly incremented `registryVersion` integer:

```json
{
  "registryVersion": 2,
  "releasedAt": "2026-05-01T00:00:00.000Z",
  "providers": [
    ...
  ]
}
```

2. Canonicalize and sign the registry file using `scripts/signRegistry.ts`:

```bash
npx tsx scripts/signRegistry.ts \
  --sign ./release/registry-v2.json \
  --key ~/secure-offline-keys/registry-ed25519.priv.pem \
  --pub ./registry-ed25519.pub.pem
```

This command:
- Canonicalizes `./release/registry-v2.json` in place (sorted keys, deterministic formatting).
- Produces the detached base64 Ed25519 signature at `./release/registry-v2.json.sig`.
- Self-verifies the detached signature against the public key before succeeding.

3. Publish both `registry-v2.json` and `registry-v2.json.sig` (or serve the signature in the `X-Registry-Signature-Ed25519` response header) over `https://`.
