# P2 — AUDIT PROMPT (send as ONE message, after the master build prompt has finished)

Send everything below the line to an agent that has a terminal and a real browser on your Mac. Give it the project folder produced by the master build prompt.

---

TASK: Run, Audit, Test, Debug, Secure and Fully Validate "AI API Key Lab"

You are a senior staff-level engineer responsible for: local execution, full-stack debugging, API-integration validation, provider-adapter validation, browser QA, security review, dependency auditing, automated testing, UI/UX testing, regression testing, real-API integration testing and production-readiness review.

This is NOT a request to merely read the code. You must: run the application locally; inspect the whole codebase; find real bugs and architectural problems; fix them; re-run; re-test every important workflow; perform browser-based UI testing; perform security and dependency checks; verify real provider integrations; verify that model discovery is dynamic; verify that the application never marks a key WORKING without a real successful model response; leave the project stable and ready for manual verification. Do not declare completion while known functional, runtime, build, type, lint or security issues remain.

The machine is a MacBook (macOS, Apple Silicon). The product is "AI API Key Lab".

## 0. RULES THAT GOVERN THIS ENTIRE TASK
1. **Canonical definitions.** The statuses, error categories, model dimensions, response validation, verification ladder and model-selection algorithm in the project's `SPEC.md` §"Canonical Definitions" (the master build prompt §2) are the single source of truth. If they are missing, or the code's enums differ from them, aligning code and docs to them is your FIRST fix. Reproduced here so this prompt is self-contained:
   - KEY STATUS (only allowed values): `untested`, `testing`, `working`, `rate-limited`, `unauthorized`, `forbidden`, `no-credit`, `no-usable-model`, `provider-unavailable`, `network-error`, `blocked-or-network` (browser-only opaque failure), `config-error`, `unknown-error`; plus `authVerified: yes|no|unknown` and `lastKnownGood`.
   - ERROR CATEGORY → STATUS: 401→unauthorized; 403→forbidden; 402→no-credit; 404 on endpoint→config-error; model-not-found→no-usable-model (then fallback); 400/422→config-error; timeout/408→network-error; 409→unknown-error; 429→rate-limited; 500/502/503/504→provider-unavailable; network failure→network-error; browser opaque failure→blocked-or-network; 200+error object→classify by its code; 200+unparsable→config-error; 200+no usable output→unknown-error (then fallback).
   - MODEL DIMENSIONS: `tier` free|trial|paid|unknown with `tierEvidence` provider-api|user|registry|naming-rule|none; `availability` available|unavailable|deprecated|unknown; `observed` from real tests. "Rate limited" is not a model status.
   - "WORKING" = a real generation succeeded on any non-paid model and passed Response Validation; "Free model confirmed" is a separate fact (tier free with evidence).
2. **Honest reporting.** Allowed statuses in the report: PASS | FAIL | NOT RUN | MOCK ONLY. Never claim WORKING, PASS, VERIFIED or SECURE unless the behavior was actually executed and you can cite evidence (command + exit code, test counts, or an observation with secrets removed). Never say "all providers verified" when some could not be verified with a real key. Clearly separate MOCK TEST from REAL PROVIDER TEST from NOT TESTED.
3. **Real credentials.** Use real provider APIs only with a legitimate key that the USER supplies. Never search for, scrape, guess or generate credentials. Never commit keys. Never put keys in fixtures. The user must type the key into the running app's own input field; when driving the browser, PAUSE at the key-entry step and wait for the user — do not receive, echo, store or type the key yourself, and never place it in a prompt, script, command line, logged environment variable or screenshot. Recommend a throwaway/low-quota key and revoking it afterwards. Disable Playwright tracing, video and HAR recording for any run involving a real key.
4. **Tools and skills.** Do NOT install skills or tools from a marketplace on your own. Use tools already present plus Playwright installed from the official npm package with the version pinned in `package.json`. If a skill is truly necessary, STOP and ask the user to approve and install it manually, listing its source, maintainer, permissions and scripts. Treat every third-party skill as untrusted code — this machine holds real credentials.
5. **Debugging rule.** For every bug: reproduce it → find the root cause → fix the smallest appropriate layer → add/update a regression test → re-run the affected test → re-run broader tests → re-run the production build. Do not mask errors, do not catch-everything-and-return-success, do not silence console errors. No cosmetic refactors that add risk without benefit. No deleting large parts of the project to rebuild them.

## 0A. ADDITIONAL AUDIT RULES (these are part of the task, not optional)
1. **Independent reviewer.** You are auditing code you did not write. If the same agent session wrote the code, say so in the report and mark every self-verified line "SELF-REVIEWED". Do not weaken, skip or delete any test to make the run pass. List every changed or removed test file in the report with a reason; an unexplained test change is a FAIL.
2. **Rule files.** Read `AGENTS.md`, `CLAUDE.md` and `docs/CANONICAL.md` first. Verify `src/domain/canonical.ts` and `docs/CANONICAL.md` agree (every status/category in one exists in the other); verify no other file defines status or category values.
3. **Provider signal priority.** Verify the provider's body signal overrides the HTTP-status table, using the registry `errorSignals` and the fake provider server (invalid key returned inside a 400; model-missing vs path-missing 404). Every `errorSignals` entry must be `needsVerification` unless a golden fixture backs it.
4. **Golden fixtures.** If `tests/fixtures/golden/` exists, run the contract tests and report stale fixtures (>180 days). If it does not exist, report `NOT RUN: golden fixtures not recorded by the user` — never fabricate fixtures and never call the fake server a substitute for real provider responses.
5. **Canary-secret test.** Run it, then attack it: confirm it scans console, storage dumps, history, exports, diagnostics bundle, error messages and logs, and fails when a canary is deliberately leaked into each of them (mutation check).
6. **Late-binding enforcement.** Confirm the dependency/lint rule exists and fails when a UI module imports the secret store (test it by adding a temporary violating import, then remove it).
7. **Budget Guard.** Verify daily caps per key and global, that tests, fallbacks and scheduled checks all consume the same budget, that the cap hard-stops, that Tier-0 list calls use a separate counter, and that unknown-tier selection is cheapest-first and never selects an `avoidPatterns` model while another candidate exists.
8. **Diagnostics bundle.** Verify its contents against the allowed list (no keys, fingerprints, prompts, responses, query strings, custom hosts) and that it passes the redactor.
9. **Features that exist.** Audit only routes and features that were built; list unbuilt ones under Known Limitations. A route or sidebar entry without a working feature is a FAIL.
10. **Supply chain.** Verify the lockfile is committed and versions are exact; install with `npm ci --ignore-scripts`, then list every dependency that has an install script and whether it was reviewed; run `npm audit`; flag any dependency without a justification in SPEC.md. Do not run installs in an environment that contains real keys.
11. **CI files.** Verify `.github/workflows/ci.yml` exists, uses no secrets, has `permissions: contents: read`, and its actions are pinned to full commit SHAs (if not, report it). Do not assume CI is green: report `NOT RUN` unless you saw a real run.
12. **Real invalid-key observation.** In the manual handoff, the user also enters a deliberately wrong key for a real provider and writes down the status the app shows; that real result becomes a golden fixture and is compared with the fake-server result. Mismatch → FAIL until `errorSignals` are corrected.
13. **Report additions.** Add these lines to the final report with the usual evidence rule: Golden Fixtures · Canary Test · Late-Binding Enforcement · Budget Guard · Diagnostics Bundle · Test-File Changes (list) · Supply Chain · CI Files · Self-Reviewed Lines.

## 1. UNDERSTAND THE PROJECT FIRST
Before changing anything, inspect: framework, language, package manager, build system, routing, state management, storage system, provider registry, adapter architecture, model discovery, key storage, chat, test infrastructure, environment variables, dev server, production build, existing tests, documentation. Read `package.json`, lockfile, tsconfig, Vite config, environment config, source, tests, provider files, adapter files, storage services, API services, README/docs. Do not make assumptions about the project.

## 2. SAFE CHECKPOINT
Check Git status and branch. If the project is under Git, create a safe checkpoint/commit when appropriate. Keep a recoverable state. Prefer targeted fixes.

## 3. TOOLS
Verify Node.js, the package manager, TypeScript, ESLint, the test framework, and Playwright. Install missing dependencies only when justified. Do not replace the existing stack unnecessarily.

## 4. RUN LOCALLY
Determine the dev command (`npm install`, `npm run dev` or equivalent) and start the app. Verify: the server starts; no startup, dependency, configuration or environment error; no failed imports; no runtime exception. Determine the real local URL.

## 5. BROWSER QA
Open the running app in a real browser (Playwright's WebKit engine — name it "WebKit" in the report, never "Safari" — and Chromium; real Safari counts only if the user tests it by hand) and test the real application. Inspect: console, network failures, runtime exceptions, failed requests, broken routes, broken icons, layout problems, unusable controls, missing labels, broken dialogs, broken navigation, responsive layout. Take screenshots where useful (sanitized).

## 6. ROUTE AUDIT
Visit every route: `/dashboard`, `/keys`, `/keys/add`, `/keys/:id`, `/keys/working`, `/keys/failed`, `/providers`, `/providers/:id`, `/models`, `/compare`, `/tester`, `/chat`, `/custom-providers`, `/diagnostics`, `/history`, `/settings`, `/settings/backup` (adapt to the actual router). Every top-level route has a sidebar entry. For each route verify: loads, renders, no console error, no uncaught exception, navigation works, back navigation works, refresh works (also when the router is switched to hash/custom-protocol mode), empty/loading/error states work.

## 7. FULL FUNCTIONALITY AUDIT
Nothing may be a placeholder; unfinished features must be hidden. Test both successful and unsuccessful paths for: add key, edit key, delete key, save, cancel, search, filter, sort, copy, show/hide key, retest, open chat, provider selection, model selection, provider details, custom provider create/edit/delete, import, export, backup, settings, language switching, RTL/LTR, font scaling, dark/light, keyboard shortcuts, dialogs, toasts, error messages, test history, chat history.

## 8. THE CRITICAL API-TESTING RULE
A key may NEVER become `working` merely because: the key exists, the Base URL is valid, `/models` returns 200, authentication metadata looks valid, a model list came back, or the request did not fail immediately. `working` is allowed only after a REAL generation request succeeds and passes Response Validation (2xx; no error object; parseable; non-empty visible text; the reasoning-only rule). No mock response, no fake success, no hard-coded success condition, no simulated model response. There is NO manual "Move to working" action: verify it does not exist. Only the Verification Ladder's Tier 2 can produce `working`.

## 9. DYNAMIC MODEL DISCOVERY (mandatory)
Where a provider exposes a models API: call the real endpoint, parse the live response, normalize it, detect current model IDs, newly introduced models and unavailable/deprecated ones, update the UI from the live response, and never silently replace a live list with a stale hard-coded list. The bundled registry may serve only as fallback metadata, protocol information, known provider configuration, compatibility metadata and free-tier hints — never as the primary live discovery source when a models API exists. Verify a "Refresh Models" action: requests live data, preserves user configuration, marks missing models unavailable, highlights new models, shows the refresh time.

## 10. MODERN MODEL DETECTION AND REGRESSION
New model IDs must be recognized without a frontend code change. Search for logic like `if (model === "old-model-name")` and remove it unless provider-specific behavior truly requires it. Write a regression test that feeds model IDs the code has never seen (through the fake provider server and, when possible, a live provider response) and asserts they are accepted by metadata, not by hard-coded names. Never write a test that only asserts the existence of an old static model.

## 11. GEMINI-SPECIFIC VALIDATION
Query live Gemini model metadata. A model is a candidate for the generation test only when its supported generation methods include `generateContent` AND it passes the registry's data-driven `excludeModelPatterns` (TTS, image generation, embedding and live/realtime families can advertise `generateContent` yet fail a plain text "Hi"; never hard-code names in logic). Authenticate with the `x-goog-api-key` header, not a query-string key. The Gemini model list has no pricing: Gemini tier comes from registry/user evidence and defaults to `unknown`; free quotas are per-model and can be zero for some models. Then run a real generation with "Hi" (max output tokens 256). Do not mark the key `working` until: authentication was not rejected; a currently available candidate was selected; the model is generation-compatible; the real endpoint accepted the request; a real response returned; it passed Response Validation.

## 12. DO NOT APPLY GEMINI LOGIC TO OTHER PROVIDERS
`generateContent` is Gemini-specific. Each provider uses its own protocol: OpenAI-compatible → `GET /models` + `POST /chat/completions`; Anthropic-compatible → the Messages API; Gemini → its native discovery and generation; Cohere → its native schema; Generic → configured templates. The adapter layer decides the method. Do not force a universal implementation where the provider API does not support it, and do not copy Gemini logic into other adapters.

## 13. PROVIDER-WIDE VALIDATION
Audit ALL adapters (OpenAI-compatible, Anthropic-compatible, Gemini, Cohere, Generic REST), then every provider in the registry. For each determine: correct base URL, authentication, models endpoint, generation endpoint, request body, response parser, model extraction, error parser, streaming behavior, free-model detection. Providers differ: some expose models dynamically, some expose none, some expose pricing separately, some are OpenAI-compatible, some native, some need special headers/formats/error schemas/free-tier semantics. Build correct provider-specific handling.

## 14. PROVIDER REGISTRY AUDIT
Verify: unique IDs; correct protocol values; valid base URLs; correct models-endpoint configuration; correct auth method; correct adapter selection; free-tier metadata marked as metadata, not truth; optional fields handled; unsupported capabilities not falsely advertised; every entry has `allowedHosts`; entries without a URL (Cloudflare Workers AI, Kilo Code, Ollama Cloud, Aion Labs) are `baseUrl=null` + `needsVerification=true` unless verified from official documentation; uncertain entries (Chutes, glhf.chat, Z AI international vs China, SiliconFlow `.cn` vs international, Nebius, ModelScope, Alibaba regions) are flagged; Cloudflare uses `requiredParams` (account id); at least one `anthropic-compatible` provider exists where an official endpoint exists (otherwise that adapter is documented as "not verified against a live provider"). Where live data exists, prefer it over registry metadata. Verify unsigned or downgraded remote registries are rejected and that an `allowedHosts` change requires user approval.

## 15. FREE-MODEL RESOLUTION AND MODEL SELECTION
Audit against the canonical rules: evidence-based tier (provider-api → user → registry (with `verifiedAt`; >90 days = stale) → naming-rule declared in registry → none); never "model exists = free"; never "provider has a free plan = every model is free"; unknown pricing → `unknown`. Selection order: user-selected (paid requires explicit confirmation) → last-known-good → live-reported free → registry-recommended present in the live list → other candidates by context, reliability, latency. A paid-tier model is never auto-selected. Fallback attempts bounded 1–3 (default 2) with "Primary model failed. Trying fallback…". If nothing qualifies → `no-usable-model` with "No verified generation-capable, non-paid model could be selected." A key that passed on an unknown-tier model is `working` and displays "Tier unverified".

## 16. REAL TEST FLOW (no shortcuts)
Select Provider → Enter Key → Load Provider Configuration → Discover Models Dynamically (Tier 0) → Identify Free Models → Validate Model Capability → Select Test Model → Send REAL "Hi" (Tier 2) → Receive REAL Response → Validate Response → Mark per the canonical table. Verify the key stays `testing` until the real response arrives.

## 17. RESPONSE VALIDATION
HTTP 200 is not success. Require non-empty visible output, valid structure, provider-specific success fields, no hidden error object, no empty completion, no malformed body. Reasoning-only output: retry once with double the token limit; visible text → working; still reasoning-only → working with warning; neither → empty-response (not working). Only after this validation may the key be considered `working`.

## 18. FAILURE CLASSIFICATION AND CORS
Verify every row of the canonical error table with a fixture, including 402, 400/422, 504, timeouts, errors inside a 200 body, malformed bodies and empty outputs. Do not mislabel: CORS/network failure, provider downtime, model-not-found, quota exhaustion or timeouts as an invalid key. A 429 with `authVerified="yes"` shows "Rate limited — the key appears valid".
A browser cannot tell CORS from a network failure. Verify the app uses `blocked-or-network` (category `cors-or-network`) with: "The browser blocked or could not complete the request. This can be CORS or a network problem. It does NOT prove the key is invalid. Test this provider with the desktop app.", and never `unauthorized` or `working`. Verify `browserCallable` is informational and editable, and that the browser-only executor adds `anthropic-dangerous-direct-browser-access` only for hosts that document it. Use the fake provider server WITHOUT CORS headers (in Playwright) to produce a real opaque failure and confirm the classification. Keep the architecture compatible with a future Electron execution layer.

## 19. SECURITY AUDIT — KEYS, STORAGE, CUSTOM PROVIDERS, IMPORT
- **Keys:** search the whole project for secret exposure: source, logs, `console.log`, error handlers, localStorage, sessionStorage, IndexedDB, URLs, query parameters, route state, analytics, telemetry, stack traces, screenshots, debug output. Keys are masked in the UI (last 4 only); errors are sanitized (redaction by exact stored-secret match, substrings ≥6 characters, and patterns); the key is not appended to URLs unless the provider documents query authentication (Gemini must use a header).
- **Late binding:** adapters, services and components other than the executor and the secret store can never read a stored secret.
- **Host binding:** the secret is sent only to the key's `boundHost`, only over https (http only for explicitly approved local providers), never with embedded URL credentials, never along a redirect; changing the host needs confirmation and resets the key to `untested`; imported custom providers and remote registry changes are untrusted until approved. Test each with a fixture.
- **Storage:** keys not duplicated or stored in several places; not in logs, chat history, or default exports. The browser vault uses AES-256-GCM with a key derived from a user passphrase (PBKDF2-HMAC-SHA256, ≥600,000 iterations, random salt, non-extractable WebCrypto key in memory, idle auto-lock); without a passphrase the UI must say keys are not truly protected. A clear abstraction exists for later Keychain-backed storage.
- **Custom providers (high-risk):** check SSRF, arbitrary endpoint abuse, unsafe redirects, unsafe URL protocols, malicious request templates, script execution, injection through configuration, unsafe JSONPath evaluation, dynamic function construction. No `eval()` or `new Function()` for provider processing; use controlled parsing and schema validation.
- **Import/export:** test export, import, malformed import, duplicates, invalid provider IDs/model IDs, masked secrets, secret-export confirmation. Reject unknown fields, files >10 MB, and `__proto__`/`constructor`/`prototype` keys; imports cannot execute code; no unsafe deserialization. Verify the encrypted backup format (header with kdf and cipher parameters, header bound as AES-GCM AAD, fresh salt/IV per backup, wrong password → generic failure, tampering detected, schema validation after decryption).
- **Dependencies:** run `npm audit` (or equivalent); inspect outdated critical dependencies, known vulnerabilities, suspicious/unnecessary/duplicate/abandoned packages. Targeted safe upgrades only; after changes run tests, typecheck, lint, build and browser tests.

## 20. STATIC QUALITY AUDIT AND REQUEST LIFECYCLE
Review: TypeScript strictness, unnecessary `any`, duplicated or dead code, race conditions, promise handling, missing error handling, stale state, memory/event-listener leaks, improper cleanup, accidental infinite or duplicate requests, unnecessary re-renders. Every API request has: timeout, abort, retry rules, rate-limit handling, error normalization, cleanup, loading state, duplicate-request protection. No infinite retries; no hammering; respect `Retry-After`. Multi-model tests: default max 5 models per run (more needs confirmation), concurrency 1, delay ≥1500 ms, stop a provider on the first rate-limit.

## 21. CHAT PLAYGROUND
Real provider requests only; no mock assistant messages in production/test mode. The Playground never auto-sends; it offers "Send test message (Hi)". Only `working` keys (or `rate-limited` with `authVerified="yes"`, with a warning) are selectable; otherwise "This API key has not been successfully verified." The UI must make it difficult or impossible to open a real chat with an untested key, a known-invalid key or an unsupported model. Test: select a working provider, key and verified model → "Hi" → real response → follow-up ("What is 2 + 2?") → real answer. Verify rendering, errors, retry, clear, model switching, streaming and Stop where supported, markdown, code blocks, copy, and that keys never appear in saved chats.

## 22. WORKING-KEY STATE MACHINE AND PAGES
States are exactly the canonical KEY STATUS values. Valid transitions: `untested → testing → {any terminal status}`; any terminal → `testing` (retest) → any terminal; `testing` is never persisted (on startup it becomes `untested`); editing baseUrl/host/provider resets to `untested`. `lastKnownGood` is set on every success and never cleared by a failure. Working Keys page: "Working" section (status working) and "Previously working" section (has `lastKnownGood`, current status transient), each showing last-verified time; a previous success never guarantees the key still works. Test the whole workflow: badge, provider, model (+tier), latency, last tested, actions (chat, edit, retest, copy, delete). Test history: every real test produces one record with provider, model, status, timestamp, latency, HTTP status, sanitized error category; no full keys, secret headers or raw sensitive responses.

## 23. NO MOCK SUCCESS IN REAL MODE
Search for: fake success, demo success, hard-coded assistant responses, mocked key validity, fake model availability, hard-coded `working` status, simulated latency. Disable these in real mode. Demo data exists only if flagged `isDemo`, labelled DEMO DATA, excluded from counts/exports/tests, and removed from the production build flag.

## 24. UI QUALITY
- **i18n:** switch English↔Arabic: all text changes; layout is RTL; tables, forms, dialogs, chat, icons, navigation correct; no untranslated strings (provider/registry descriptions and provider error messages are English and marked as such). LTR tokens (keys, masked keys, URLs, model IDs, code, JSON, "412 ms") are isolated with `<bdi>`/`unicode-bidi: isolate`/`dir="ltr"`; code blocks always LTR; logical CSS properties; only directional icons mirrored.
- **Font size:** Small, Default, Large, Extra Large — no major layout breaks in sidebar, tables, buttons, dialogs, forms, chat, cards.
- **Dark/Light/System:** readable text, contrast, visible borders/inputs/disabled states, understandable badges, no white-on-white or black-on-black.
- **Responsive:** desktop, laptop, tablet, mobile-sized viewport; sidebar, navigation, tables→cards, provider cards, forms, chat, dialogs, overflow, horizontal scrolling, wrapping.
- **Accessibility:** keyboard navigation, focus states, labels, form fields, dialogs and modal focus, ARIA, contrast; never color alone for status (icon + text).
- **Shortcuts:** desktop-style accelerators defined once; in the browser build Cmd+N/T/W are not relied on (command palette Cmd+K, "?" help, `g`-sequences disabled while typing).
- **Performance:** repeated model requests, unnecessary API calls, repeated renders, excessive polling, memory leaks, giant bundles, unnecessary dependencies, slow first render; memoization/virtualization only where beneficial.

## 25. BUILD, CONSOLE, NETWORK
Run the project's real commands (equivalents of `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`; inspect `package.json` if a script is missing). Fix all real failures. Then run the app again and browse every major page: no unexpected uncaught exceptions, React errors, failed imports, repeated 404s, failed API calls caused by app bugs, broken event handlers (expected provider failures from intentionally invalid credentials are fine only if handled by the error system).
Inspect network requests: correct endpoints, methods, bodies, authentication; no key leakage; no key in a URL unless required; no duplicate requests; proper abort and timeout. Do NOT save HAR files, traces or screenshots from real-key runs in the repository; verify the secret appears only in the designated auth header (or documented query parameter) and only on requests to the key's `boundHost`.

## 26. ADAPTER CONTRACT AND ARCHITECTURE
Every adapter must conform to one contract and never read the secret:
```ts
interface ProviderAdapter {
  buildListModels(input: ListModelsInput): PreparedRequest;   // contains the "{{secret}}" placeholder only
  parseModels(res: ApiResponse): ModelInfo[];
  buildGenerate(input: GenerateInput): PreparedRequest;
  parseGenerate(res: ApiResponse): ParsedOutput;              // visible text, reasoning-only flag, finish reason, usage
  classifyError(res: ApiResponse | unknown): Diagnostic;      // uses the canonical mapping
}
```
Execution goes only through `ApiExecutor`. If you find provider logic duplicated in UI components, static models replacing API discovery, provider code mixed with React components, key logic mixed with rendering, unsafe storage or duplicated request logic, refactor toward: Provider Registry → Provider Adapter → Model Service → API Test Service → Chat Service → Storage Service → UI, keeping provider-specific differences isolated.

## 27. ELECTRON READINESS (NOT conversion)
The app is NOT being converted yet. Do NOT begin Electron packaging and do not add Electron dependencies. Verify only that: API requests are abstracted; storage and encryption are abstracted; the renderer needs no Node access; provider logic is not tied to browser-only assumptions; adapters use the late-binding `PreparedRequest` contract; host binding is enforced in ONE place (the executor); routing can switch between browser history and hash/custom-protocol routing; the code has no Windows-specific paths or shortcut assumptions (the target is macOS).

## 28. WORKING-GATE SELF-TEST (required deliverable)
Provide `npm run test:gate`: it starts the local fake provider server on a random localhost port (test tree only, excluded from production builds) and runs the REAL test service and executor against scenarios: valid, empty output, error-in-200, reasoning-only, 401, 402, 403, model-not-found, 429 with Retry-After, 500, 503, timeout, malformed JSON, no-CORS variant. It asserts the resulting STATUS and CATEGORY against the canonical table, that the secret goes only to the bound host, and that a redirect to another host is refused. A failing scenario blocks completion.

## 29. EVIDENCE PACK
Every PASS in the final report must point to evidence in `reports/evidence/` (command outputs with exit codes, test summaries with counts, sanitized screenshots; add the folder to `.gitignore` if it could contain sensitive data). Add `npm run verify:report`: re-runs the cheap checks (lint, typecheck, unit tests, the gate self-test, a scan of build output for secret patterns) and compares them with the statuses in the report; if any status in the report is better than what the script finds, it fails and prints the mismatch. A line without evidence is treated as NOT RUN.

## 30. FINAL REGRESSION SUITE
Run before declaring completion: Application (starts, builds, routes, no runtime errors) · Providers (registry loads, adapters load, endpoints resolve, auth correct, dynamic discovery where available) · Models (live models recognized, new IDs accepted, unsupported rejected, Gemini capability check, other providers' logic provider-specific) · API Keys (add, edit, delete, mask, test, retest, working state, failed state, history) · Chat (real request, real response, follow-up, errors, retry, clear, model switching) · UI (dark/light, EN/AR, LTR/RTL, font size, responsive, accessibility) · Security (no key logging, no accidental exposure, safe import/export, dependency audit, unsafe-code audit, host/late binding).

## 31. STRICT ACCEPTANCE — the task is NOT complete if any is true
The app does not start · build fails · typecheck fails · lint fails because of new issues · major tests fail · major routes broken · API keys leaked · API tests mocked in production mode · a key becomes `working` without a real successful generation response · static model lists replace dynamic discovery where a live models API exists · Gemini models selected without capability validation · modern model IDs rejected because not hard-coded · the Playground uses fake assistant responses · provider APIs incorrectly forced through Gemini logic · a CORS/opaque failure is classified as an invalid key · a 429 is classified as an invalid key · a model-not-found error is classified as an invalid key · a key can be moved to Working by a manual action · the renderer/adapters can read a stored secret · a secret can be sent to a host other than `boundHost` or follows a redirect · the code's enums differ from the canonical definitions · a valid key is permanently stuck as failed only because the provider exposes no pricing data · buttons are non-functional · major console errors remain · security issues of meaningful severity remain · the report contains PASS for anything not executed.

## 32. MANUAL TEST HANDOFF (prepare for the user, macOS, Safari or Chrome)
The first manual test is Google Gemini with a fresh legitimate key that the USER types in (do not stop your audit at Gemini; everything is provider-agnostic).
- Test 1 Add key: Add API Key → Google Gemini → enter the key (do not type a Base URL unless needed) → Test API Key. Expect: configuration auto-loaded, live model discovery, current model IDs shown, old hard-coded models not the sole source.
- Test 2 Model discovery: live detection; a newly available model appears without code changes.
- Test 3 Capability validation: for each Gemini candidate the app determines `generateContent` support and excluded families; unsupported models are never selected.
- Test 4 Real key validation: "Hi" sent for real; response real; no mock.
- Test 5 WORKING state: stays `testing` until the real response arrives; becomes `working` only after Response Validation.
- Test 6 Working Keys: the key appears under Working.
- Test 7 Playground: press "Send test message (Hi)", then "Explain what an API is in one sentence." — real answer.
- Test 8 Follow-up: another normal question; conversation state correct.
- Test 9 Retest: Retest from Working Keys makes another real request.
- Test 10 Invalid key: use the app's isolated negative test against the fake provider server (or an intentionally invalid credential if safe) → `unauthorized`, NOT `working`.
For every other provider type repeat: Provider Selection → Automatic Configuration → Dynamic Model Discovery (when supported) → Free Model Resolution → Capability Validation → Real Generation → Real Response → WORKING/FAILED → Working Keys → Playground. Do not create Gemini-only code that passes while other providers remain broken.

## 33. DO NOT STOP AFTER CODE REVIEW
Do not stop after reading code, lint, tests, compiling or typechecking. You must run the app and perform real browser workflows; the final state must be based on actual execution. If the environment cannot run something, write exactly `NOT RUN: <what> — <reason>`.

## 34. DOCUMENTATION
Update documentation where needed: architectural changes, adapter fixes, model discovery behavior, testing behavior, browser/CORS limitations, security changes (late binding, host binding, storage tiers, backup format), manual testing steps. No documentation noise.

## 35. FINAL REPORT (use exactly; no pre-filled results)
Each line: `<Area> — <PASS|FAIL|NOT RUN|MOCK ONLY> — Evidence: <…>`.
```
PROJECT VALIDATION REPORT
Application — overall: PASS / PASS WITH LIMITATIONS / FAIL
Build (command, result) · TypeScript · Lint · Automated Tests (passed/failed) · test:gate
Browser QA (routes tested, console errors, network errors)
Provider Architecture · Dynamic Model Discovery · Modern Model Detection
Gemini Validation · Other Provider Validation (each provider: REAL or MOCK ONLY or NOT RUN)
Real API Test · WORKING-State Validation · Host Binding and Late Binding
Playground Validation · Security Audit · Dependency Audit
Internationalization (EN / AR / RTL / LTR / bidi isolation) · Responsive · Accessibility
Known Limitations (genuine only) · Fixed Issues (actually fixed) · Manual Verification Required (exact steps) · Not Tested (explicit list)
```
Never print or store the test key.

## 36. FINAL PRIORITY
The highest priority is functional correctness of the API testing engine. It must correctly answer two separate questions: (1) "Does this API key actually work?" — a real generation succeeded on a non-paid model; (2) "Is a free model confirmed?" — only when the tier is free with evidence. The only acceptable path to `working` is:
Real Key → Real Provider → Current Model Discovery → Valid Model Capability → Real Generation Request → Real Model Response → Verified Output → WORKING.
Anything less must NOT result in `working`.

## 37. EXECUTE IN THIS ORDER
1 Inspect the repository · 2 Safe checkpoint · 3 Verify tools (no marketplace installs) · 4 Install dependencies · 5 Run locally · 6 Browser QA · 7 Audit all adapters · 8 Audit dynamic discovery · 9 Audit modern models · 10 Audit Gemini capability detection · 11 Audit real API testing · 12 Audit WORKING-state logic · 13 Audit Playground · 14 Audit storage/security · 15 Audit custom providers · 16 Audit import/export/backup · 17 Audit localization/RTL/bidi · 18 Dependency/security checks · 19 Fix all issues · 20 Add regression tests · 21 Re-run tests, browser tests, typecheck, lint, build · 22 Re-test the important API flows · 23 Verify no known errors remain · 24 Final report + evidence pack · 25 Manual Gemini checklist · 26 STOP before the Electron phase. Do not begin Electron packaging.

The next phase is a separate task (macOS Electron migration). The current objective is: MAKE THE EXISTING APPLICATION RUN CORRECTLY, TEST CORRECTLY, DISCOVER CURRENT MODELS DYNAMICALLY, USE REAL API REQUESTS, VERIFY REAL MODEL RESPONSES, PROTECT API KEYS, AND LEAVE THE PROJECT READY FOR MANUAL FINAL VERIFICATION.
