# AI API Key Lab — final package (macOS)

## Send these, in this order, each as ONE separate message to an agent running on your Mac
1. **05_MASTER_PROMPT_build.md** — builds the application (replaces the old P1; all fixes merged).
2. **06_P2_audit_prompt_FINAL.md** — audits, tests and secures what was built. Send only after step 1 finished.
3. **07_P3_macOS_prompt_FINAL.md** — converts the validated app into a macOS Electron app (.app / .dmg, Apple Silicon). Send only after step 2 produced a clean report.
4. **04_ideas_addon.md** — optional follow-up tasks (signed registry, Leak Hunter, Local Gateway). Only after step 3 passes.

## Rules for getting accurate results
- One prompt per message. Never send the whole package at once.
- Do not edit a prompt halfway through a run; if you change something, restart that step.
- Type your real test key yourself into the app when asked (Gemini first). Never paste it into the chat with the agent. Use a low-quota key and revoke it afterwards.
- Read the agent's final report: every line must have evidence. A line with PASS and no evidence counts as NOT RUN.
- If the agent says `NOT RUN`, that is honest, not a failure of the prompt: run that check yourself or send it to an agent that has a terminal.
- Bring the report back to me and I will review it against the prompts.

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
