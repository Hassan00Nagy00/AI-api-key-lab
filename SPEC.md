# SPEC.md — AI API Key Lab Specification

## 1. Product Understanding & Scope
**AI API Key Lab** is a local-first, developer-focused workbench designed to store, manage, discover, test, validate, and compare AI API keys and models across diverse providers.
The product addresses the chaos of collecting free-tier, trial, and personal AI API keys across disparate platforms (Google Gemini, Groq, OpenRouter, NVIDIA NIM, Mistral, Cohere, DeepSeek, SambaNova, Cerebras, Hugging Face, custom endpoints, etc.).

Key capabilities:
- **Zero-leak security & Mechanical Late Binding**: Strict host binding, mechanical late secret binding via `SecretVault` (import-restricted to `executor.ts` and `secretStore.ts` only), central `RedactorService`, Canary-Secret leak verification, masking (`sk-...••••7F3A`), optional AES-256-GCM browser vault with user passphrase, and encrypted portable backups.
- **Protocol-native adapters**: Google Gemini (native `x-goog-api-key` header with `generateContent`), OpenAI-compatible, Anthropic-compatible (`POST /v1/messages`), Cohere (`/v2`), and Generic REST (custom providers with template parsing).
- **Two distinct questions**:
  1. *Does the key work?* Confirmed only when a real generation ("Hi") succeeds and passes full response validation.
  2. *Is a free model confirmed?* Evaluated strictly through evidence hierarchy (`provider-api` -> `user` -> `registry` -> `naming-rule` -> `none`).
- **Live Model Discovery & Cheapest-First Selection**: Querying endpoints for actual available models without hardcoding assumptions, ranking unknown-tier models cheapest-first (`testModelPreference`, `cheapPatterns`, never auto-selecting `avoidPatterns`, smaller context window before larger).
- **Fail-safe Error Categorization & Provider Signal Priority**: Provider-specific `errorSignals` take priority over default HTTP status mapping; network/CORS/429/model-not-found are never misdiagnosed as `unauthorized`.
- **Developer Tools & §13A Specifications**: Budget Guard & Cost-Safety Caps, Key-Format Provider Suggestion (`keyShape`, ReDoS-safe), Key Expiry & Rotation Tracker, One-Click Redacted Diagnostics Bundle, Model Watch & Quota Snapshots, Golden Provider Fixtures, Chat playground, and exportable configs.
- **macOS First Design & i18n**: System typography, Cmd shortcuts, dark technical theme, full English & Arabic with strict bidirectional isolation (`<bdi>`, logical CSS, LTR code blocks).

---

## 2. VERBATIM COPY OF §2 CANONICAL DEFINITIONS

**KEY STATUS** — the only allowed values of `ApiKeyRecord.status`:
- `untested` · `testing` (UI-transient; on startup becomes `untested`) · `working` (the LAST test completed a real generation AND passed Response Validation) · `rate-limited` (429/quota) · `unauthorized` (401 / provider invalid-key signal) · `forbidden` (403) · `no-credit` (402/insufficient balance) · `no-usable-model` (auth not rejected, but no generation-capable non-paid model could be selected, or model-not-found) · `provider-unavailable` (5xx/maintenance/gateway) · `network-error` (offline/DNS/TLS/timeout) · `blocked-or-network` (BROWSER ONLY: opaque fetch failure; may be CORS or network) · `config-error` (bad URL/template/adapter config, malformed response caused by config) · `unknown-error`.
- Orthogonal fields: `authVerified: "yes"|"no"|"unknown"`; `lastKnownGood?: {at, model, latencyMs, modelTier}` (set on every success, never cleared by failures).

**ERROR CATEGORY → KEY STATUS**
- 401 `auth` → unauthorized · 403 `forbidden` → forbidden · 402 `insufficient-credit` → no-credit
- 404 on models/chat endpoint `endpoint-not-found` → config-error · model not found/unsupported `model-not-found` → no-usable-model (then fallback)
- **PROVIDER SIGNAL PRIORITY:** the provider's own error signal (error code/status string/reason in the response body) overrides the HTTP-status table; the table is only the default when no known signal is present. Signals live in the registry as data (`errorSignals: [{ httpStatus, match, category }]`), e.g. an invalid-key reason delivered inside a 400 must map to `unauthorized`, and a 404 whose body says the MODEL is missing maps to `model-not-found` while a 404 on the path maps to `endpoint-not-found`. Every `errorSignals` entry is `needsVerification` until a golden fixture (recorded from a real response) proves it.
- 400/422 `bad-request` → config-error · 408/client timeout `timeout` → network-error · 409 `conflict` → unknown-error
- 429 `rate-limit`|`quota-exhausted` → rate-limited · 500 `server-error` → provider-unavailable · 502/503/504 `bad-gateway`|`service-unavailable` → provider-unavailable
- fetch failure (non-browser) `network` → network-error · opaque failure (browser) `cors-or-network` → blocked-or-network
- 200 + error object → classify by the error's own code · 200 + unparsable `malformed-response` → config-error · 200 + no usable output `empty-response` → unknown-error (then fallback)
- Never map CORS/network/timeout/rate-limit/server errors/model-not-found to `unauthorized`. A 429 with `authVerified="yes"` displays "Rate limited — the key appears valid".

**MODEL DIMENSIONS** (the only model statuses)
- `tier`: free | trial | paid | unknown · `tierEvidence`: provider-api | user | registry | naming-rule | none (strongest first) · `availability`: available | unavailable | deprecated | unknown · `observed`: {lastWorkingAt?, lastFailureCategory?} from real tests only.
- "Rate limited" is NOT a model status, only a transient test observation.
- Never set `tier="free"` without evidence other than `none`. Badge FREE only when tier is free (tooltip shows evidence); show "Tier unverified" when unknown.

**WHAT "WORKING" MEANS (two separate questions)**
1. Does the key work? → status `working` after a real generation succeeds on any non-paid model (free, trial or unknown tier).
2. Is a free model confirmed? → shown separately ("Free model confirmed") only when the successful model has tier free with evidence. The dashboard shows both counts. A valid key must not stay failed merely because the provider exposes no pricing data.
Never auto-select a `paid` model; use one only if the user selects it explicitly and confirms a cost warning.

**TEST REQUEST DEFAULTS**: message `Hi`; max output tokens 256; temperature unset; timeout 30 s (chat 120 s); no automatic retries except the fallback-model rule.

**RESPONSE VALIDATION** — success needs ALL: 2xx; no error object in body; parseable; non-empty visible text. Special case: reasoning/thinking output with no visible text and a length-limit finish → retry ONCE with double tokens; visible text appears → working; still reasoning-only → working with warning "reasoning-only output"; neither visible text nor reasoning → `empty-response` (not working).

**VERIFICATION LADDER** (cheapest first; only Tier 2 can produce `working`): Tier 0 list models (proves auth only where `modelsRequiresAuth=true`); Tier 1 optional token-count/dry endpoint when the provider offers one; Tier 2 real generation with "Hi". Record `authVerified` after each tier. A 2xx at Tier 0/1 alone never sets `working`.

**MODEL SELECTION** (single algorithm)
- Candidate filter: generation-capable per adapter metadata; availability not unavailable/deprecated; tier not paid; id not matching the provider's data-driven `excludeModelPatterns` (e.g. embeddings, TTS, image, live/realtime families) — patterns live in the registry, never in logic.
- Ranking: (1) user-selected model (if paid → require confirmation) (2) this key's `lastKnownGood` if still listed (3) live-reported free (evidence provider-api) (4) registry-recommended present in the live list (5) remaining candidates: if the tier is known free/trial, higher observed reliability then lower historical latency; if the tier is UNKNOWN (typical for Gemini and most providers), cheapest-first — never largest-first: (5a) registry `testModelPreference` entries (ordered, data, with `verifiedAt`) present in the live list, (5b) registry `cheapPatterns` matches (e.g. lite/flash/mini/small/nano/haiku — data in the registry, never hard-coded in logic), (5c) registry `avoidPatterns` (pro/opus/large/ultra…) last, (5d) smaller context window before larger (a heuristic, labelled as such). A model matching `avoidPatterns` is never auto-selected while any other candidate exists.
- Fallback on model-not-found / empty-response / rate-limit: next candidate; additional attempts configurable 1–3, default 2; show "Primary model failed. Trying fallback…"; never retry endlessly. No models API → use the registry list and mark `source="registry"`. Nothing qualifies → `no-usable-model` with "No verified generation-capable, non-paid model could be selected."

---

## 3. Architecture & Design Principles

### Layers & Decoupling
1. **Single Source of Truth (`src/domain/canonical.ts` & `docs/CANONICAL.md`)**:
   - All canonical statuses, error categories, model tiers, tier evidences, and error-category-to-status mappings live in `src/domain/canonical.ts` and are verified against `docs/CANONICAL.md` by `src/test/canonicalRules.test.ts`.
2. **Mechanical Late Secret Binding (`src/services/secretVault.ts`)**:
   - Enforced by ESLint (`no-restricted-imports` in `.eslintrc.json`) and `scripts/checkArchitecture.ts` (`npm run lint`).
   - Only `src/services/executor.ts` and `src/services/secretStore.ts` may import `secretVault`. UI, adapters, state, loggers, and formatters never touch raw secrets.
3. **Central Redaction & Canary Leak Prevention (`src/services/redactor.ts`)**:
   - Every log sink, error formatter, history serializer, and diagnostics bundle passes through `RedactorService` before leaving memory.
4. **Provider Adapters & Signal Priority**:
   - `OpenAICompatibleAdapter`, `AnthropicCompatibleAdapter`, `GeminiAdapter`, `CohereAdapter`, `GenericRestAdapter`.
   - `classifyError` evaluates provider `errorSignals` first before falling back to the HTTP status table.

---

## 4. File Layout

```
/
├── AGENTS.md
├── CLAUDE.md
├── SPEC.md
├── VALIDATION_REPORT.md
├── .eslintrc.json
├── package.json
├── index.html
├── metadata.json
├── vite.config.ts
├── tsconfig.json
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── release-check.yml
├── docs/
│   ├── CANONICAL.md
│   └── SIGNED_REGISTRY.md
├── scripts/
│   ├── buildElectron.ts
│   ├── checkArchitecture.ts
│   ├── generateIcons.ts
│   ├── record-fixtures.ts
│   └── verifyReport.ts
├── tests/
│   └── fixtures/
│       └── golden/
│           ├── google-gemini/
│           └── groq/
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── domain/
    │   └── canonical.ts
    ├── electron/
    │   ├── main.ts
    │   ├── preload.ts
    │   ├── ipcSchemas.ts
    │   ├── ipcHandlers.ts
    │   ├── mainExecutor.ts
    │   ├── secretStore.ts
    │   ├── ssrfGuard.ts
    │   ├── menu.ts
    │   ├── tray.ts
    │   ├── notificationService.ts
    │   └── localGateway.ts
    ├── types/
    │   ├── provider.ts
    │   ├── key.ts
    │   ├── model.ts
    │   ├── test.ts
    │   ├── chat.ts
    │   ├── settings.ts
    │   ├── backup.ts
    │   └── diagnostics.ts
    ├── schemas/
    │   ├── providerSchema.ts
    │   ├── keySchema.ts
    │   ├── backupSchema.ts
    │   ├── settingsSchema.ts
    │   └── customProviderSchema.ts
    ├── locales/
    │   ├── en.json
    │   ├── ar.json
    │   └── i18n.ts
    ├── services/
    │   ├── secretVault.ts
    │   ├── secretStore.ts
    │   ├── redactor.ts
    │   ├── budgetService.ts
    │   ├── expiryService.ts
    │   ├── providerDetector.ts
    │   ├── diagnosticsBundleService.ts
    │   ├── modelWatchAndQuota.ts
    │   ├── fixtureSanitizer.ts
    │   ├── schedulerService.ts
    │   ├── signedRegistryService.ts
    │   ├── leakHunterService.ts
    │   ├── crypto.ts
    │   ├── storage.ts
    │   ├── executor.ts
    │   ├── providerRegistry.ts
    │   ├── freeModelResolver.ts
    │   ├── modelSelector.ts
    │   ├── responseValidator.ts
    │   ├── errorClassifier.ts
    │   ├── testService.ts
    │   ├── chatService.ts
    │   ├── configGenerator.ts
    │   ├── diagnosticsService.ts
    │   ├── exportService.ts
    │   └── observedService.ts
    ├── adapters/
    │   ├── types.ts
    │   ├── openai.ts
    │   ├── anthropic.ts
    │   ├── gemini.ts
    │   ├── cohere.ts
    │   └── genericRest.ts
    ├── providers/
    │   └── catalog.ts
    ├── hooks/
    │   ├── useKeys.ts
    │   ├── useProviders.ts
    │   ├── useSettings.ts
    │   └── useShortcuts.ts
    ├── components/
    │   ├── common/
    │   ├── layout/
    │   ├── keys/
    │   ├── testing/
    │   └── config/
    ├── views/
    │   ├── DashboardView.tsx
    │   ├── WorkingKeysView.tsx
    │   ├── AllKeysView.tsx
    │   ├── FailedKeysView.tsx
    │   ├── ProvidersView.tsx
    │   ├── ModelsView.tsx
    │   ├── CompareView.tsx
    │   ├── ApiTesterView.tsx
    │   ├── ChatPlaygroundView.tsx
    │   ├── CustomProvidersView.tsx
    │   ├── DiagnosticsView.tsx
    │   ├── HistoryView.tsx
    │   ├── SettingsView.tsx
    │   ├── BackupView.tsx
    │   └── SecurityAddonsView.tsx
    └── test/
        ├── fakeProviderServer.ts
        ├── testGate.ts
        ├── canonicalRules.test.ts
        ├── goldenFixtures.test.ts
        ├── v1Specs13A.test.ts
        ├── errorClassification.test.ts
        ├── responseValidation.test.ts
        ├── hostBinding.test.ts
        ├── modelSelection.test.ts
        ├── backupCrypto.test.ts
        ├── addonsPhase4.test.ts
        └── electronDesktop.test.ts
```

---

## 5. Dependency Justifications & Supply-Chain Review (`AGENTS.md` Rule 9 & `06_P2 §0A.10`)

### Runtime Dependencies (`dependencies`)
- `react`: Core declarative UI library for the SPA and Electron renderer.
- `react-dom`: DOM rendering bindings for React 19.
- `lucide-react`: Lightweight SVG icon components for developer workbench status badges and actions.
- `zod`: Runtime schema validation at every boundary (provider registry, key storage, backup import/export, IPC).
- `motion`: Smooth UI modal, toast, and drawer transitions.
- `undici`: Pinned HTTP/1.1 & HTTP/2 client for the Electron Main-Process API Executor (`MainProcessExecutor`), enabling connect-time DNS rebinding guards (`Agent` custom lookup) and explicit `ProxyAgent` support (`07_P3 §7`).
- `vite`: Frontend development server and production bundler.
- `@vitejs/plugin-react`: React Fast Refresh and JSX compilation plugin for Vite.
- `@tailwindcss/vite`: Native Tailwind CSS v4 integration plugin for Vite.
- `@google/genai`: Workspace template base SDK dependency (unused at runtime; AI API Key Lab uses its own zero-leak `GeminiAdapter` with `x-goog-api-key`).
- `dotenv`: Workspace template environment loader for local script execution.
- `express`: Workspace template HTTP server typing dependency.

### Dev & Desktop Dependencies (`devDependencies`)
- `typescript`: Strict static type checking (`tsc --noEmit`).
- `tsx`: TypeScript execution engine for `node:test` suites and verification scripts (`checkArchitecture.ts`, `verifyReport.ts`, `buildElectron.ts`).
- `esbuild`: Compiles Electron main (`dist-electron/main.cjs`) and preload (`dist-electron/preload.cjs`) bundles.
- `tailwindcss`: Utility-first CSS framework for dark/light and RTL/LTR logical styling.
- `autoprefixer`: PostCSS vendor prefixing plugin.
- `@types/node`: TypeScript definitions for Node.js built-in modules (`crypto`, `http`, `fs`, `dns`, `net`).
- `@types/react`: TypeScript definitions for React.
- `@types/react-dom`: TypeScript definitions for React DOM.
- `@types/express`: TypeScript definitions for Express.

### Reviewed Install Scripts (`§0A.10`)
- `esbuild`: Downloads platform-specific native binary for Vite/TSX/Electron compilation (`--ignore-scripts` compatible fallback).
- `electron`: Downloads official Electron runtime binary when packaging the macOS desktop build (`electron-builder.yml`).

---

## 6. Feature List in MUST / SHOULD / COULD Order (§14)

### MUST (Build and validate completely first)
1. **Canonical §2 Rules & Single Source of Truth (`src/domain/canonical.ts` + `docs/CANONICAL.md`)**: Strict adherence to §2 table, Provider Signal Priority (`errorSignals`), and Cheapest-First Model Selection (`5a–5d`).
2. **Mechanical Late Secret Binding (`SecretVault`) + Host Binding + Central Redactor + Canary-Secret Leak Test**: Enforced by lint/architecture checks and Scenario 16 Canary-Secret test.
3. **5 Protocol Adapters + 27+ Bundled Providers**: OpenAI-compatible, Anthropic-compatible, Google Gemini (`x-goog-api-key`), Cohere v2, and Generic REST.
4. **Add / Edit / Delete / Mask / Reveal Keys + Salted Fingerprint Deduplication + ReDoS-Safe Key-Format Provider Suggestion (`keyShape`)**.
5. **Verification Ladder (Tier 0 → Tier 2) + Response Validation + Reasoning-Only Retry + Fallback + Live Model Discovery**.
6. **Budget Guard & Cost-Safety Caps**: Per-key (20/day) and global (100/day) generation caps, separate Tier-0 cap (300/day), one-time unknown-tier billing warning.
7. **Golden Provider Fixtures**: Sanitized fixtures under `tests/fixtures/golden/<providerId>/<case>.json` tested in CI with 180-day staleness guard.
8. **Dashboard, Working Keys, All Keys, Failed Keys, Providers, Models, API Tester, Chat Playground, Custom Providers, Diagnostics, History, Settings, Backup/Import/Export (with Post-Decryption Duplicate Fingerprint Check), Configuration Generator**.
9. **Full English + Arabic RTL with Bidirectional Isolation (`<bdi>`, logical CSS, LTR code/key blocks)**.
10. **Fake-Provider Server + All §11 Gate Tests Passing**.

### SHOULD (Validate after MUST is complete)
1. **Compare View (`/compare`)**: Side-by-side comparison of observed working models.
2. **Key Expiry & Rotation Tracker**: User-declared `expiresAt` and `expiryNote`, 7/3/1 day alerts, `"expired (user-declared)"` state, skipped by scheduled checks.
3. **One-Click Redacted Diagnostics Bundle**: Redacted JSON + readable text report with custom hosts hashed (`custom-host-xxxx`).
4. **Model Watch & Quota Snapshots**: Manual Tier-0 model change diff (`new`, `removed`, `deprecated-marked`) with coalesced notifications, plus rate-limit header snapshots (`"Provider limit unknown"` when absent).
5. **Command Palette (`Cmd+K`)**, Key Groups, History Charts, Multi-Model Test Modal.
6. **Electron Packaging Skeleton & CI/Release Workflows (`.github/workflows/ci.yml` & `release-check.yml`)**.

### COULD
1. Optional Add-Ons from `04_ideas_addon.md` (Signed Registry Updates, Repo Secret Leak Hunter, Local OpenAI-Compatible Proxy Gateway) after all MUST and SHOULD items pass.

---

## 7. Explicit Assumptions
1. **Browser Runtime Constraints**: Fetch calls made from browser origins are subject to CORS. Browser fetch opaque rejections are explicitly labeled `blocked-or-network` and explain that desktop/proxy testing eliminates CORS barriers.
2. **macOS Target**: Key modifiers default to `⌘` (Cmd), font stack uses `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display"`.
3. **No Secret Leaks**: Secrets never leave `SecretVault` / `BrowserApiExecutor` except to the verified `boundHost`.
4. **Local Fake Server for Tests**: A lightweight Node HTTP fake server in `src/test/fakeProviderServer.ts` is used exclusively for `npm run test:gate` and automated unit tests.
