# P3 — macOS DESKTOP PROMPT (send as ONE message, only after P2 passed)

Send everything below the line to an agent running on your Mac (Apple Silicon) with the project folder. Do not send it before the audit prompt (P2) has produced a clean report. You will type the Gemini test key yourself into the installed app when asked; never paste it into the chat with the agent.

---

TASK: Convert the Validated AI API Key Lab into a Secure macOS Electron Desktop Application

You are moving an application from the browser phase into the desktop phase. The target is **macOS on Apple Silicon (MacBook Pro)**. There is no Windows target in this task.

The CANONICAL DEFINITIONS (master build prompt §2, also in the project's SPEC.md) remains the single source of truth for key statuses, error categories, model dimensions, response validation and model selection. This task must not change them.

## 0. PRECONDITIONS (check before doing anything)
1. Find the P2 validation report. If it does not exist, or any area is FAIL, or the Gemini adapter is not PASS with a REAL provider test, STOP and report exactly what is missing. Adapters that need a key you cannot have (OpenAI-compatible, Anthropic-compatible, Cohere, others) may be MOCK ONLY or NOT RUN in the P2 report: that is accepted, must be carried into this phase's report unchanged, and never upgraded to PASS here. Do not assume earlier phases passed.
2. Confirm the environment: macOS, Apple Silicon (`uname -m` must say arm64), Node version, npm, Xcode Command Line Tools. Build and test on THIS Mac natively. Do not use Wine, Docker or cross-compilation.
3. Inspect Git status, the current branch, entry points (Vite config, React entry), the executor abstraction, storage, encryption and provider services. Create a safe checkpoint if appropriate.

Do NOT rebuild the app. Do NOT remove functionality. Do NOT replace real API requests with mocks. Do NOT break the provider architecture. Migration is incremental.

## 0A. ADDITIONAL DESKTOP REQUIREMENTS
1. **Rule files.** Read `AGENTS.md`, `CLAUDE.md` and `docs/CANONICAL.md` first and re-read them before each work block; the canonical statuses and the Budget Guard apply unchanged in the main-process executor.
2. **Proxy / VPN.** Node and undici ignore the macOS system proxy settings (Chromium does not). At startup and per host call `session.defaultSession.resolveProxy(url)`; if the result is not DIRECT show a diagnostic ("A system proxy is configured; direct connections may fail"). Default: direct connection with the guarded `lookup`. Optional setting "Use system proxy": use undici's `ProxyAgent`; because the proxy resolves the final address, the connect-time IP check cannot see it — in this mode apply literal-host checks, a pre-resolution DNS check on this machine, https only and approved hosts only, and document that the guarantee is weaker. Full-tunnel VPNs work transparently. Test both modes against a local proxy fixture and report the result honestly. Do not use `net.fetch` for provider calls unless you document what you lose.
3. **Notifications.** Expiry alerts and Model Watch alerts use the main-process `Notification` class (macOS asks for permission the first time; it may be unreliable with an ad-hoc signature — then fall back to the in-app banner and say so). The renderer's `setPermissionRequestHandler` stays deny-all: that handler governs web permissions in the renderer, not main-process notifications. No notification can fire while the app is closed; there is no login item, launch agent or background daemon.
4. **Scheduler.** Health checks and the opt-in scheduled Model Watch (Tier 0 only, one key per provider, default 24 h, minimum 6 h) share one scheduler that runs only while the app is open and is off by default; both obey the Budget Guard and skip expired and `unauthorized` keys.
5. **Supply chain.** `npm ci` from the committed lockfile, `--ignore-scripts` first, then only reviewed install scripts (Electron's own download/postinstall and the packager are expected — list them). Never run the build in an environment that contains real keys.
6. **CI.** Add the manual `release-check.yml` (`workflow_dispatch`, `macos-14`, arm64): build only and run tests that need no Keychain, Touch ID or real key; verify current macOS-runner billing for private repositories before enabling it. Never put real keys in CI.
7. **Not in this phase.** Local gateway, the `keylab` command-line tool, Leak Hunter and commit guard are separate later tasks; do not start them.


## 1. OBJECTIVE
Product: **AI API Key Lab** — a secure macOS desktop app for managing, testing and chatting through AI API keys. Preserve all existing features (dynamic model discovery, real generation tests, Playground, diagnostics, custom providers, comparison, history, import/export, backup, English/Arabic, RTL/LTR, dark/light, font size). It must feel like a real Mac app, not a website in a window: proper window title, native dialogs, native open/save panels, native menus, standard Mac keyboard shortcuts, application icon. Do not redesign the UI: preserve layout, colors, typography, cards, dashboard, provider pages, chat, settings, Arabic/English and dark/light; make only desktop-specific improvements where useful.

## 2. ARCHITECTURE
Main process (secret store, native network execution, file operations, windows, menus, secure IPC) → Preload bridge (minimal typed API) → React renderer (no Node access, **no secrets**).

**Late secret binding (core security rule).** Adapters build requests with a `{{secret}}` placeholder (master build prompt §3, executor contract). The renderer sends `{ keyId, request }` over IPC; the **main process** looks up the secret, checks the host binding, substitutes it, executes the request and returns a sanitized response. The renderer never receives a stored secret. The only moment a secret exists in the renderer is while the user types a new key; after saving, clear it from state immediately.

## 3. ELECTRON SECURITY BASELINE
- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, `allowRunningInsecureContent: false`, no `webview`, no remote module.
- `app.on('web-contents-created')`: block `will-navigate` to anything outside the app origin; `setWindowOpenHandler` → deny (open allowed https links with the system browser instead).
- `session.setPermissionRequestHandler` and the check handler: deny every permission (camera, mic, geolocation, notifications…) unless a feature explicitly needs one.
- `session.webRequest.onBeforeRequest`: in production block every request whose URL is not the app's own origin.
- `app.requestSingleInstanceLock()`: a second launch focuses the existing window (two instances would corrupt the local store).
- Electron Fuses (via `@electron/fuses`, applied in the packaging `afterPack` step **before code signing**, because flipping fuses changes the binary): RunAsNode off; NodeOptions environment variable off; NodeCliInspect off; cookie encryption on; only load app from asar on; embedded asar integrity validation on where supported.
- Use the latest compatible stable Electron; no deprecated APIs; inspect the version available in the environment before choosing.

## 4. PRELOAD BRIDGE (typed, minimal)
Expose only these, with explicit types. No generic IPC, no arbitrary channels, no `ipcRenderer`, `fs`, `shell`, `process`, `require` in the renderer. **No function returns a stored secret.**

```ts
interface ElectronAPI {
  app: { getVersion(): Promise<string>; getInfo(): Promise<{ platform: string; arch: string; electron: string }> };
  keys: {
    save(input: { providerId: string; label?: string; secret: string; baseUrl: string }): Promise<KeyMeta>; // secret goes IN only
    updateMeta(id: string, patch: KeyMetaPatch): Promise<KeyMeta>;
    delete(id: string): Promise<void>;
    list(): Promise<KeyMeta[]>;                    // metadata only
    copySecret(id: string): Promise<void>;         // main writes the clipboard after user verification
    revealSecret(id: string): Promise<{ masked: string; revealed: string; hideAfterMs: number }>; // behind Touch ID/confirmation, see §6
    rebindHost(id: string, newBaseUrl: string): Promise<KeyMeta>;                                // after confirmation dialog
  };
  api: {
    request(input: { keyId: string; request: PreparedRequest; timeoutMs?: number }): Promise<ApiResponse>;
    streamStart(input: { keyId: string; request: PreparedRequest }): Promise<{ streamId: string }>;
    streamAbort(streamId: string): Promise<void>;
    onStreamEvent(streamId: string, cb: (e: StreamEvent) => void): () => void;  // chunk | end | error
  };
  store: { read(collection: StoreCollection): Promise<unknown>; write(collection: StoreCollection, data: unknown): Promise<void> }; // non-secret metadata only, schema-validated in main
  backup: { create(opts: { includeSecrets: boolean }): Promise<string | null>; importFile(): Promise<ImportReport> };  // dialogs and file I/O happen in main
  files: { exportText(opts: { defaultName: string; content: string; kind: 'json'|'csv'|'env'|'md'|'txt' }): Promise<boolean> };
  external: { open(url: string): Promise<void> };      // https only (see §9)
  data: { eraseAll(): Promise<void> };                  // confirmation dialog in main
}
```
Rules: every IPC channel has a distinct, named purpose (e.g. `keys:save`, `keys:copy-secret`, `api:request`, `api:stream-start`, `api:stream-abort`, `store:read`, `store:write`, `backup:create`, `backup:import`, `files:export-text`, `external:open`, `data:erase-all`). Validate every argument in main with a schema (never trust the renderer); verify the sender frame is the app's own window; return only sanitized errors. The renderer never chooses file paths: dialogs and reads/writes happen in main, and only content or a success flag crosses the bridge.

## 5. NATIVE API EXECUTION
Create `ElectronApiExecutor` beside `BrowserApiExecutor`; provider adapters must not know which one runs. Execute provider HTTP requests in the main process using an explicitly installed, exactly-pinned `undici` package (import its own `fetch` and `Agent`; do NOT pass a dispatcher from the package to the global built-in fetch — versions can differ) so the connect-time guarded `lookup` is real. Responsibilities of the executor: transport, timeout, cancellation (AbortController tied to `streamAbort`), streaming (chunks forwarded as `api:stream-*` events), response size cap (10 MB), and error normalization. Adapters stay responsible for auth format, model discovery, request construction, response parsing, error classification and capability detection. Do not run a local proxy server. This removes browser CORS as a transport limit: a request that previously ended as "blocked-or-network" must now be retested through this executor and classified by its real response.

## 6. SECRETS: STORAGE, REVEAL, COPY, EXPORT
**Storage.** Use Electron `safeStorage` (backed by the macOS Keychain) to encrypt each secret; persist only the encrypted blob in the app's data directory with atomic writes (write temp file, fsync, rename). Do NOT use `keytar` (archived/unmaintained). Never fall back to plaintext: if `safeStorage.isEncryptionAvailable()` is false or decryption fails, **fail closed** with a clear message and a recovery path (restore from an encrypted backup).
Note and document: Keychain may show an access prompt on first use. With ad-hoc signing (§12), the app's code identity changes on every rebuild and macOS may prompt again; a stable Developer ID signature avoids this. Never "solve" it by storing plaintext. Rules that follow from this: (1) before ANY rebuild or replacement of the installed app, create an encrypted backup with secrets (Touch ID/confirmation gate) — this is a mandatory step of the update procedure in the docs; (2) prefer a STABLE signing identity from the first desktop build: option 1, a free self-signed "Code Signing" certificate created by the user in Keychain Access (Certificate Assistant) — stable for your own Mac, not for distribution; option 2, an Apple Development certificate (Xcode with an Apple ID); option 3, Developer ID (paid, needed only for distribution/notarization). Do not create or change certificates or Keychain trust settings yourself; ask the user, take the identity NAME from an environment variable, never commit it; (3) test and report what actually happens on this macOS version: rebuild with the same identity → do the secrets still decrypt (with or without one "Always Allow" prompt)? rebuild ad-hoc → what happens? fail-closed stays as is.
**Metadata vs secrets.** Non-secret metadata (keyId, providerId, label, status, authVerified, lastKnownGood, boundHost, createdAt, …) lives in the app store; secrets live only in the encrypted store. Keep them consistent: on startup reconcile — metadata without a secret → status "untested" and flag "secret missing"; a secret without metadata → offer cleanup. Deleting a key deletes both.
**Reveal / export secrets.** Gate `revealSecret`, `copySecret` (when configured), "Export Secrets" and "Create Backup with secrets" behind `systemPreferences.promptTouchID()` when `canPromptTouchID()` is true; otherwise a native confirmation dialog. Reveal auto-hides after 15 s. `copySecret` writes the clipboard in the main process and schedules a clear after 30 s only if the clipboard still holds that value; document that clipboard managers and Universal Clipboard (Handoff) may keep copies. Where practical mark the copied value as concealed for clipboard managers.
**Configuration generator.** Generated configs contain a placeholder by default; inserting a real secret requires the same gate and a warning, and copying any configuration that contains a secret shows a warning. Never copy automatically and never log clipboard contents.

## 7. MIGRATION FROM THE WEB VERSION
The browser's storage is in a different origin and profile than Electron, so automatic detection of "legacy data" is NOT possible. The only supported path is: in the web app → **Create Encrypted Backup** → in the desktop app → **Import Backup** (file chosen in a native dialog; main process decrypts it, stores secrets in the encrypted store, returns metadata only). Show this as the first-run option "Import from the web version". Never delete anything before the import has been verified; never delete the user's backup file.

## 8. ENCRYPTED BACKUPS
Preserve the existing backup and use exactly the versioned format in master build prompt §6 (Encrypted backup) (format/version/createdAt/encrypted + kdf{name, iterations, salt} + cipher{name, iv, tagLength} + payload, header bound as AES-GCM AAD, random salt and IV every time, PBKDF2-HMAC-SHA256 with at least 600,000 iterations, unknown versions/KDFs rejected, generic wrong-password message, schema validation after decryption). Raw secrets are included only when the user explicitly chooses it, behind the gate in §6, with a serious warning.

## 9. NETWORK SECURITY (host binding, SSRF, redirects, local providers)
All checks run in the main process, in ONE place (the executor), before and during every request:
- **Host binding (master build prompt §6, Host binding):** the secret is attached only if the request hostname equals the key's `boundHost`; `rebindHost` needs a confirmation dialog showing old → new host and resets the key to "untested". Imported/remote/custom providers are untrusted until approved.
- **Scheme/URL:** https only. `http` only for a local provider the user has explicitly approved. Reject `file:`, `javascript:`, `data:`, URLs with embedded credentials, and malformed hosts. Parse with the WHATWG URL parser first (it normalizes decimal/hex/octal IP forms), then validate.
- **SSRF:** block loopback, private (RFC 1918), link-local (including 169.254.169.254 metadata), CGNAT, multicast, unspecified (0.0.0.0/8), IPv6 loopback/unique-local/link-local, and IPv4-mapped IPv6 (re-check the embedded IPv4). Validate the **resolved address at connect time** (custom `lookup` in the undici agent), not only a separate earlier DNS check, to defeat DNS rebinding.
- **Redirects:** `redirect: "manual"`. Never forward credentials across a redirect; treat redirects to another host as an error.
- **Local providers (e.g. Ollama):** allowed only through an explicit per-provider "Allow local provider" consent that records host and port. Private-LAN hosts need the same explicit per-host consent. The metadata/link-local range is never allowed.
- Validate method, headers (deny `Host`, `Authorization` overrides from the renderer), body size, timeout and provider before executing. Never use `eval` or `new Function`.

## 10. EXTERNAL URLS, NAVIGATION, PROTOCOL, ROUTING
- `external.open` accepts `https://` URLs only, ideally restricted to hosts from the registry (provider website/key page/docs). Open with the system browser.
- Production loads the packaged frontend through a **custom protocol** (`app://`), registered as privileged and served by `protocol.handle` from the packaged `dist` with path-traversal protection and a fallback to `index.html` for client routes. Do not use `file://` and do not depend on `localhost` in production. Vite `base` must be relative/compatible; verify routes, refresh and deep links.
- Strict CSP in production: no `unsafe-eval`; avoid `unsafe-inline`. Because every provider request goes through the main process, the renderer's `connect-src` can be `'self'` only. A development-only relaxation (Vite HMR websocket) must exist only in development.
- Dev: DevTools allowed. Prod: not opened automatically; no debug output containing secrets.

## 11. REAL-API AND DYNAMIC-DISCOVERY RULES (unchanged, restated)
Real requests only. HTTP 200 alone never means WORKING. Model discovery stays live (`Provider /models → normalize → capability detection → UI`); never replace a live list with a bundled static one. New model IDs must appear without frontend changes. Gemini follows P2 §11 (live metadata, generateContent, excludeModelPatterns, header auth, tier from registry/user). Do not push Gemini logic into other adapters. The WORKING-state regression list in §20 is mandatory.

## 12. PACKAGING FOR macOS
- Tool: electron-builder (one packaging system only). Targets: `dmg` and `zip`, architecture **arm64** (state this explicitly; add `universal` or `x64` only if the user asks). `mac.category`: `public.app-category.developer-tools`.
- Identity: stable `appId` (e.g. `com.aiapikeylab.desktop`, fixed from now on), product name **AI API Key Lab**, version 1.0.0 shown in About, app metadata and installer.
- Signing policy for this phase: **local-use build**. Apple Silicon will not run an unsigned arm64 app, so the bundle must be at least ad-hoc signed. If the builder did not sign it, run `codesign --force --deep --sign - "<App>.app"`, then verify with `codesign --verify --deep --strict --verbose=2` and `codesign -dv`. Enable hardened runtime and prepare a minimal entitlements file (only what Electron requires, e.g. JIT); no App Sandbox/Mac App Store work. **Do not** do notarization, Developer ID signing or auto-update in this phase; keep versioning, packaging metadata and the stable appId ready for future update infrastructure, and never create a fake update mechanism. Never tell the user to disable Gatekeeper globally. Document: an ad-hoc-signed app copied from another Mac or downloaded is quarantined and must be approved in System Settings → Privacy & Security ("Open Anyway") on recent macOS versions.
- Do not commit binaries. Generate SHA-256 checksums with `shasum -a 256`.

## 13. macOS APP BEHAVIOR
- Lifecycle: on macOS keep the app running after the last window closes (standard), re-create the window on `activate`, quit with Cmd+Q; add a setting "Quit when the last window closes" (default off on macOS). Flush stores and cancel streams on `before-quit`.
- Menu (required, or standard shortcuts break): App menu (About AI API Key Lab, Settings… Cmd+,, Services, Hide, Quit); File (New API Key Cmd+N, Import, Export, Backup); **Edit with the standard roles (undo, redo, cut, copy, paste, selectAll)** — without it Cmd+C/V do not work in the renderer; View (Dashboard, Working Keys, Providers, Chat, reload only in dev); Tools (API Tester, Diagnostics); Window (role windowMenu); Help (Documentation, Shortcuts). Menu labels follow the app language (including Arabic) through the main-process i18n.
- Window: minimum size, resizing, full screen, restore; remember size/position/maximized state but **validate saved bounds against the currently connected displays** (an unplugged external monitor must not place the window off-screen). Native dialogs for open/save.
- Optional menu bar item (only if it adds value): show status, open dashboard, quit; use a monochrome template image. No hidden background behavior; scheduled health checks (master build prompt §5, Health monitoring) run only while the app is open and are off by default.
- Native About panel with version, Electron version, architecture.

## 14. ICON AND BRANDING (macOS)
Create an original icon, vector master `assets/icon.svg`: abstract key + network/connection motif with shield geometry, no generic robot, no provider logo, no resemblance to another company's mark. macOS icon style: 1024×1024 canvas with transparent margins and a rounded-square (squircle) body (artwork roughly 824 px inside the canvas) and a subtle shadow; legible at 16 px.
Generate from the vector, never by upscaling a small raster: `assets/icon.png` (1024), an `.iconset` with 16, 32, 128, 256, 512 and their @2x sizes, and `assets/icon.icns` built with `iconutil -c icns`. If a menu bar item is used, add `iconTemplate.png` and `iconTemplate@2x.png` (monochrome template images). Inspect the icon at 16/32/64/128/256/512 and in the Dock, Finder, Launchpad and the DMG window. Use the product name AI API Key Lab for the app name, window title, About page, DMG name and metadata.

## 15. DATA, PATHS, LOGS
- Data directory: `app.getPath('userData')` (`~/Library/Application Support/AI API Key Lab`); logs: `app.getPath('logs')` (`~/Library/Logs/AI API Key Lab`). Never rely on the working directory or hard-coded development paths; the app must run from `/Applications` and from the user's Applications folder. If the app is launched from the DMG or Downloads, macOS may run it from a read-only translocated location — tell the user to copy it to Applications before the persistence tests.
- Persistence: choose the simplest reliable store; prefer **no native module** (a schema-versioned JSON store with atomic writes and migration). If SQLite is chosen, handle Electron rebuilds and asar unpacking explicitly. Non-secret data only; separate from secrets (§6).
- Logging: timestamp, component, event, status, provider, model, latency, error category only. Never keys, Authorization headers, tokens, passwords, or clipboard contents. Provide "Clear logs".
- Errors from main to renderer are sanitized: category, message, statusCode, provider, model, technicalDetails — redact by exact stored secret and patterns.
- Chat history: optional disable setting, delete session, delete all, export; never contains keys.

## 16. LIFECYCLE, OFFLINE, FIRST RUN
- The app opens immediately and never depends on an API call at startup. Offline: metadata, settings, registry, history and chats stay accessible; tests report "Network unavailable" without crashing.
- Reasonable crash handling: user-friendly error, sanitized log, no secrets.
- First run: lightweight welcome ("Manage and test your AI API keys locally. Your credentials are stored using the macOS Keychain-backed secure storage.") with Get Started and "Import from the web version". No account, telemetry or analytics.

## 17. SCRIPTS AND WORKFLOWS
`electron:dev` — start the Vite dev server on its real port (do not hard-code a port), wait until it answers (e.g. wait-on), then start Electron with DevTools in development only. `electron:build` — build the frontend and the main/preload code. `electron:dist` — package (dmg + zip). Keep existing scripts working. Development and production configuration are clearly separated (dev: dev server URL, DevTools, dev logging; prod: packaged `app://` frontend, production CSP, no DevTools by default, secure storage and IPC only).

## 18. REAL TESTING ON THIS MAC
Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, then package, then **install the app to `/Applications` and launch the installed copy** — a successful package alone is not completion.
Verify native architecture: `file` on the main binary and `lipo -archs` report arm64; Activity Monitor shows the app as Apple (not Intel).
Installed-app QA: starts, Dock icon and name correct, window title, all routes (including refresh/deep link under `app://`), settings, language switching, Arabic RTL with bidi isolation of keys/URLs/code, dark/light, font scaling, key storage, API testing, model discovery, Playground (streaming and Stop), import/export, backup, Touch ID or confirmation gate, dialogs, external links, native menus (Edit shortcuts work), Cmd+, and the shortcut set.
Real Gemini test through the Electron executor with a legitimate key that the **user types into the app** (never pass the key to the agent, a script, a command line or a screenshot): add Gemini → discover live models → candidates filtered by generateContent and excludeModelPatterns → test with "Hi" → real response → WORKING → Playground with the discovered model: "Hi", then "Explain what an API is in one simple sentence." Also test at least one provider that was blocked or ambiguous in the browser (a "blocked-or-network" result) and report its real provider response; if the provider itself rejects the request, show that real error.

## 19. SECURITY AND PACKAGE AUDITS
- Review every IPC handler: who can call it, what it accepts, whether it validates, whether it can reach the filesystem, network, shell or secrets, whether it can be abused for SSRF. Remove anything unnecessary.
- Verify the renderer has no Node access and the preload exposes only §4. Verify no function returns a stored secret.
- Inspect the packaged app (extract the asar): search for `.env`, `API_KEY`, `SECRET`, `TOKEN`, `PASSWORD`, private credentials; ensure no source maps contain secrets, no demo seeds, no fake-provider test server, no development secrets. A clean source tree does not prove a clean package.
- Verify fuses with the fuses tool, verify code signature (§12), run the dependency audit again (Electron and packaging dependencies) and do not ignore Electron advisories; document genuine exceptions.
- Do not load remote JavaScript or remote pages in the renderer.

## 19A. FINAL SECURITY REVIEW (before declaring completion, with evidence)
Renderer: no Node access, no unrestricted IPC, no secret access. Preload: minimal typed bridge, explicit channels. Main: validates IPC input, secure storage, safe network requests, safe filesystem operations. Custom providers: SSRF protection, URL validation, no `eval`, no arbitrary commands. Storage: secrets only in the Keychain-backed encrypted store, metadata separate. Packaging: no secrets bundled, correct CSP, secure Electron settings. Development vs production configuration clearly separated: development may use the dev server and DevTools; production loads the packaged frontend, uses the production CSP, does not open DevTools automatically, and uses secure storage and secure IPC only.

## 20. WORKING-STATE REGRESSION (use the local fake provider server with the real executor)
Invalid key → NOT working (unauthorized). Valid key + unavailable model → NOT working (no-usable-model, then fallback). HTTP 200 + empty output → NOT working. HTTP 200 + error object → NOT working, classified by its code. HTTP 200 + reasoning-only → follows the canonical definitions. HTTP 200 + valid output → working. 429 → rate-limited (authVerified shown). Network failure → network-error. A request whose host differs from `boundHost` is refused and the secret is never sent. A redirect to another host is refused. Successful real response → working.

## 21. PERSISTENCE, UPGRADE AND REMOVAL
Restart test (mandatory): store a legitimate test key, quit completely (Cmd+Q), relaunch, verify metadata persists, the secret is usable (retest works) and nothing was stored in plaintext. Upgrade safety: data lives in `userData`, independent of the install location, so replacing the app keeps credentials, settings, metadata, history. Removal: macOS has no uninstaller; deleting the app leaves data and the Keychain-protected secret. Document this, and provide **Settings → Erase All Data…** (confirmation; deletes metadata, secrets, history, logs). Never delete the user's backup files automatically. Document the data and log locations.

## 22. DO NOT ADD
No cloud backend, accounts, analytics, telemetry, fake update mechanism, or unrelated features. Do not redesign the UI. Local-first and privacy-focused.

## 23. QA MATRIX (report format — do not pre-fill results)
Allowed statuses: PASS | FAIL | NOT RUN | MOCK ONLY. Each row needs Evidence.
Rows: Startup · Window creation · React renderer · Preload (minimal, no secret getters) · IPC validation · Secure storage (Keychain-backed) · Reveal/Copy gate · API requests · Streaming and abort · Dynamic models · Gemini · OpenAI-compatible · Anthropic-compatible · Cohere · Custom providers · Host binding · SSRF/redirect refusal · Playground · Working state · Diagnostics · Import · Export · Backup (encrypted) · Migration from web backup · Dark/Light · English/Arabic · RTL/LTR · Font scaling · Menus and shortcuts · Icon (.icns) · DMG · Installed app in /Applications · arm64 verified · Code signature verified · Restart persistence · Erase All Data.

## 24. ACCEPTANCE CRITERIA
Complete only if: the app launches from /Applications as a native arm64 macOS app; the DMG works; the icon is correct; the React UI is functional; the renderer has no Node access and never receives a stored secret; secure IPC works; secrets are Keychain-backed with fail-closed behavior; requests run through Electron with host binding, SSRF and redirect protection; dynamic discovery works and modern models are recognized; Gemini capability handling is correct; real API tests pass; "Hi" returns a real response; WORKING is assigned only after response validation; the Playground works with streaming and Stop; OpenAI-compatible, Anthropic-compatible and Cohere work where provider access allows (otherwise stated as NOT RUN); custom providers are secure; import/export/backup and migration from a web backup work; restart persistence works; dark/light, English/Arabic, RTL/LTR and font scaling work; existing and Electron-specific tests pass; security and dependency audits pass; the production build passes; no keys are bundled; no critical issue remains.

## 25. FINAL REPORT
```
AI API KEY LAB — macOS ELECTRON MIGRATION — FINAL REPORT
Status: PASS | PASS WITH LIMITATIONS | FAIL
Electron version / Node version / macOS version / Architecture (arm64 verified: yes/no, evidence)
Build / TypeScript / Lint / Automated Tests (passed, failed) / Electron Tests (passed, failed)
Security Audit / Dependency Audit / IPC Security / Secure Storage / Host Binding and SSRF
API Execution / CORS Migration / Dynamic Model Discovery / Modern Model Detection
Gemini / OpenAI-Compatible / Anthropic-Compatible / Cohere / Custom Providers (each: REAL or MOCK ONLY or NOT RUN)
Playground / Real API Test / Working-State Validation
Arabic / RTL / Dark Mode / Menus and Shortcuts / Icon
DMG path / ZIP path / .app path / Code signature result / SHA256 (shasum -a 256)
Known Limitations (genuine only) / Not Tested / Manual Verification (short checklist for the user)
```
Every line needs Evidence. Never print, store, commit, log, screenshot or include the test key in the report — mask it.

## 26. FINAL COMMAND
Begin the macOS Electron migration. Work methodically. Do not skip security. Do not skip real API testing. Do not replace real provider requests with mocks. Do not mark the migration complete just because a `.dmg` was generated. The final requirement is: a real, secure, installable native macOS application that preserves the existing AI API testing functionality, discovers current models dynamically, performs real provider requests, keeps credentials in Keychain-backed storage and out of the renderer, provides a working real-model Playground, and behaves correctly after installation and restart. Do NOT proceed to notarization, distribution or auto-update unless the application first passes all the validation above. When finished, stop and provide the complete final report.
