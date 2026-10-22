# CANONICAL DEFINITIONS (single source of truth)

## 2. CANONICAL DEFINITIONS (single source of truth — use these exact names everywhere)

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
