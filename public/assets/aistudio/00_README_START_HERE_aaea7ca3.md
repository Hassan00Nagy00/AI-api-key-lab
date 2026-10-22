# AI API Key Lab — final package (macOS)

## Before anything: drop these files in the project folder
`project_files/AGENTS.md`, `project_files/CLAUDE.md`, `project_files/docs/CANONICAL.md` → copy them into the root of the project (keep the `docs/` folder). The agent reads them at the start of every session, so it does not forget the rules in long runs.

## Order (each prompt = ONE separate message)
1. **05_MASTER_PROMPT_build.md** — builds the app in 4 phases (A Foundation, B Storage & safety, C Core UI, D Remaining). It stops after each phase; you answer "continue".
   - After phase A it stops: in your own Terminal run `npm run fixtures:record`, type the key when asked (hidden input), then say "continue". This records real provider answers so error handling is tested against reality, not imagination.
2. **06_P2_audit_prompt_FINAL.md** — audit. Use a DIFFERENT agent/model than the one that built the code if you can. Send only after the build finished.
3. **07_P3_macOS_prompt_FINAL.md** — macOS app. Send only after P2's report has no FAIL and the Gemini adapter is a REAL PASS (other adapters may be MOCK ONLY / NOT RUN).
4. **04_ideas_addon.md** — optional Phase 4 tasks, one at a time, starting with Add-on 1.

## Rules for getting accurate results
- One prompt per message. Do not edit a prompt mid-run.
- Type real keys yourself, only in the app or in the fixture recorder. Never paste them to the agent. Use a low-quota key and revoke it afterwards.
- Every line of an agent report needs evidence. PASS without evidence = NOT RUN. `NOT RUN` is honest, not a failure.
- Before rebuilding the desktop app, always make an encrypted backup (the app can lose Keychain access to its secrets after a rebuild with a different signature).
- Bring each report back to me and I will review it against the prompts.

## What is in `reference/`
The patch-style versions of the fixes (`01`–`03`) and the change map (`00_CHANGE_MAP.md`). They are superseded by the final files above and are kept only so you can see exactly what changed from your original file.

## Decisions I made (change them if you disagree)
- Target: macOS, Apple Silicon (arm64) only. Intel/universal only on request.
- Signing: ad-hoc, local use. Notarization and Developer ID come later.
- Secret storage: Electron `safeStorage` (Keychain-backed). No `keytar`.
- Product name: AI API Key Lab.
- "The key works" and "a free model is confirmed" are two separate facts.
- The Chat Playground no longer auto-sends "Hi" when opened (it needs one click), so it does not burn free quota without your action.

## Not verified by me
- Provider base URLs and free-tier details (they change often); uncertain ones are marked `needsVerification` in the prompts instead of guessed.
- macOS/Electron behavior on your machine (Keychain prompts after ad-hoc rebuilds, Gatekeeper wording on newer macOS). The desktop prompt makes the agent test these.
- Whether your agent can run `npm` and a browser; if not, it will report `NOT RUN`.
