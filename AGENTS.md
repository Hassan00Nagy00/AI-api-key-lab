# AI API Key Lab — rules for any coding agent

Personal local tool for managing and testing free/trial AI API keys. Target: web build first, then macOS (Apple Silicon) Electron app.

## Read first, re-read at the start of every phase
- `docs/CANONICAL.md` — statuses, error categories, model dimensions, response validation, verification ladder, model selection. Use these exact names. Never invent new statuses.
- `SPEC.md` — architecture and decisions.

## Hard rules
1. A key is `working` ONLY after a real generation request returned a validated response. No mock success, no hard-coded success, no manual "move to working".
2. A stored secret never reaches the renderer, logs, URLs, query strings, history, chat, errors, diagnostics or exports (masked by default). Only `ApiExecutor` and `SecretStore` may touch the secret store (enforced by a lint/dependency rule).
3. A secret is sent only to the key's bound host, over https, never along a redirect.
4. Provider error signals (body) override the HTTP status table; the table is the default.
5. Never choose a paid-tier or `avoidPatterns` model automatically; unknown tier = cheapest first.
6. Every generation goes through the Budget Guard.
7. Never weaken, skip or delete a test to make it pass. List any test change and why in the phase report.
8. Never ask for, receive, type, log or store a real API key. The user types real keys into the app or into the fixture recorder themselves.
9. Do not add dependencies without a one-line justification in SPEC.md. `npm ci`, lockfile committed, exact versions.
10. Honest reports only: PASS | FAIL | NOT RUN | MOCK ONLY, each with evidence. Unfinished features are absent, not placeholders.

## Commands
`npm run lint` · `npm run typecheck` · `npm run test` · `npm run test:gate` · `npm run build` · `npm run verify:report` (after the audit phase)

## Phases
A Foundation → B Storage & safety → C Core UI → D Remaining. Stop after each phase, report, wait for "continue".
