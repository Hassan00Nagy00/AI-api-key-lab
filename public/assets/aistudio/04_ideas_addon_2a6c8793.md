# Add-ons for the "devilish" ideas

Most of the ideas are already **built into the final prompts**, because the contradictions could not be fixed without them. Only the optional ones are left as separate blocks here.

| Idea | Status |
|---|---|
| Late secret binding + host allowlist (key can only go to its own host) | Built in: 05 §3 and §6, 06 §19 and §26, 07 §2 and §9 |
| Two-axis status (key works vs free model confirmed), "Observed working" vs declared free | Built in: 05 §2 |
| Cheap verification ladder (list models → optional token count → real "Hi") | Built in: 05 §2 |
| Learned/observed results (real rate-limit headers, last-working models) | Built in: 05 §5 |
| Fake local provider server + `npm run test:gate` | Built in: 05 §9, 06 §28 |
| Evidence pack + `verify:report` (reports backed by proof, not claims) | Built in: 06 §29 |
| Signed registry updates | Hook built in (05 §4); full block below |
| Leak Hunter | Optional Phase 4, block below |
| Local Gateway | Optional Phase 4, block below |

Send the blocks below as separate follow-up tasks, only after the macOS app has passed the desktop prompt (07).

---

## ADD-ON A — Signed registry updates (follow-up task)
```
SIGNED REGISTRY
Any registry loaded from a remote source must carry a detached Ed25519 signature over its canonical JSON. The application embeds the public key (never the private key) and verifies the signature BEFORE parsing or merging anything.
- Reject unsigned, badly signed or non-https registries and keep using the bundled one; show a non-blocking notice.
- The registry has a strictly increasing registryVersion; reject any version lower than the one already applied (rollback protection).
- A verified remote registry still cannot change allowedHosts of a provider that has stored keys without explicit user approval.
- Keep the last verified registry on disk so the app works offline.
- Document how the maintainer generates the key pair and signs a registry file. The private key is never committed.
- Tests: valid signature, bad signature, downgrade, tampered host list, offline fallback.
```

## ADD-ON B — Leak Hunter (find keys you left in plain text)
```
LEAK HUNTER (optional, explicit opt-in, desktop only)
Purpose: help the user find API keys left in plain text in their own projects and recommend rotating them.
- The user explicitly picks folders through a native folder dialog. Never scan anything else, never run silently, never scan the whole disk by default.
- Detection runs in the main process using provider key-format patterns from the registry (prefix and length rules). Skip node_modules, build output and binary files; cap file size.
- Results show provider, file path, line number and a masked fingerprint only. The full match is never displayed, logged, copied or stored; nothing is sent over the network.
- Per finding: reveal in Finder, mark as "rotated", and "Add this key to AI API Key Lab" (the user pastes it manually; the scanner never imports a secret by itself).
- If a scanned folder is a Git repository, warn that history may still contain the key and recommend rotation; never rewrite history automatically.
- Tests with fake keys matching the patterns; verify no secret ever reaches logs or renderer state.
```

## ADD-ON C — Local Gateway (one stable local endpoint for other tools)
It deliberately contradicts the "no local proxy" rule of the desktop prompt, so it must come after that prompt passes.
```
LOCAL GATEWAY (optional, off by default, desktop only)
Goal: other tools (Cursor, Aider, OpenCode, scripts) point to one local OpenAI-compatible endpoint instead of receiving raw provider keys.
- Bind to 127.0.0.1 only, on a user-visible port. Disabled by default; a clear on/off switch and a visible status indicator.
- Require a random bearer token generated per install (stored in the Keychain-backed store, shown only after the Touch ID/confirmation gate, rotatable). Reject requests without it.
- Validate the Host header (127.0.0.1 or localhost only) and reject browser-origin requests (check Origin) to defeat DNS rebinding and malicious web pages.
- Routing: choose among keys with status "working", honor the user's priority and fallback rules, respect per-key rate limits and the quota rules of multi-model testing and health checks. Never exceed the configured request budget.
- The gateway reuses the same main-process executor: late secret binding, host binding, SSRF and redirect protection all still apply; the secret never leaves the main process.
- Log only provider, model, latency, status and error category — never prompts, responses or secrets.
- Provide ready-to-copy tool configurations containing only the local URL and the gateway token.
- Tests: wrong token, wrong Host, browser Origin, key failover on 429, no secret in any response or log.
```
