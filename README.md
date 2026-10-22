# AI API Key Lab

**AI API Key Lab** is a local-first workbench engineered for developers, AI engineers, and researchers who collect free, trial, and personal AI API keys.

---

## Key Features

1. **Host-Bound Storage & Late Secret Binding**:
   - Zero-leak architecture: Secrets are bound to approved provider hostnames.
   - Adapters produce request templates with the placeholder `{{secret}}`.
   - The executor resolves the secret in-process immediately before transmission.

2. **Protocol-Native Adapters**:
   - **Google Gemini**: Native API with `x-goog-api-key` header and `generateContent`.
   - **OpenAI-Compatible**: Standard `/models` and `/chat/completions`.
   - **Anthropic Messages**: Native `/v1/messages` with `x-api-key`.
   - **Cohere Native**: `/v2/models` and `/v2/chat`.
   - **Generic REST**: Configurable custom endpoints with safe template substitution.

3. **Multi-Tier Verification Ladder**:
   - **Tier 0**: Model discovery proving auth.
   - **Tier 2**: Real generation test with standard prompt (`"Hi"`).
   - **Response Validation**: Enforces non-empty visible text and reasoning retry logic.

4. **Two Distinct Facts**:
   - *Does the key work?* (`status: working`)
   - *Is a free model confirmed?* (`tier: free` strictly confirmed with evidence: `provider-api` -> `user` -> `registry` -> `naming-rule` -> `none`).

5. **Local WebCrypto Vault & Encrypted Backups**:
   - AES-256-GCM authenticated with AAD and derived via PBKDF2 (600,000 iterations).
   - Export masked configs (JSON, CSV, .env).

6. **Full Internationalization & RTL**:
   - English and Arabic with bidirectional isolation (`<bdi>`, logical properties, LTR code blocks).

---

## Quick Start

```bash
# Install dependencies
npm install

# Start local development server
npm run dev

# Run automated tests
npm test

# Run real HTTP fake provider test gate
npm run test:gate

# Lint & typecheck
npm run lint
```
