# ELECTRON_MIGRATION.md — macOS Electron Architecture & Operations Guide

This document defines the implemented macOS Electron desktop architecture, security controls, update/rebuild procedure, proxy behavior, and operational rules for **AI API Key Lab** (`com.aiapikeylab.desktop`).

---

## 1. Process Separation & Late-Binding Security Architecture (`07_P3 §2–§5`)

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Electron Main Process (Node.js)                     │
│  - macOS Keychain encryption via `safeStorage` (`secrets.vault.json`)│
│  - Late secret binding (`{{secret}}` resolved ONLY in Main process)  │
│  - Native HTTP execution via pinned `undici` (`Agent` / `ProxyAgent`)│
│  - Connect-time DNS rebinding & SSRF guard (`src/electron/ssrfGuard`)│
│  - Schema-validated IPC handlers (`src/electron/ipcHandlers.ts`)     │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ Typed ContextBridge (`window.electronAPI`)
┌───────────────────────────────┴──────────────────────────────────────┐
│                   Electron Preload (`preload.ts`)                    │
│  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`│
│  - Exposes ONLY explicit, typed channels — NO generic `ipcRenderer`  │
│  - Never returns stored secrets (except gated 15s `revealSecret`)    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────┴──────────────────────────────────────┐
│                  React Renderer (`src/` via `app://`)                │
│  - Zero Node.js access, zero stored secrets in React state           │
│  - Builds `PreparedRequest` with `{{secret}}` placeholder            │
│  - Dispatches via `ElectronApiExecutor` -> Main Process `undici`     │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Keychain Storage, Signing Identities & Mandatory Update Procedure (`07_P3 §6 & §12`)

### 2.1 Fail-Closed Keychain Vault
- Raw API keys are encrypted using Electron's `safeStorage` (backed by the macOS Keychain) and stored in `~/Library/Application Support/AI API Key Lab/secrets.vault.json` via atomic temp-file + `fsync` + `rename` writes (`0o600`).
- Non-secret metadata lives separately in `keys_meta.json`.
- **Fail-Closed Rule**: Never fall back to plaintext. If `safeStorage.isEncryptionAvailable()` is `false` or decryption fails, `SecretStore` throws `ERR_KEYCHAIN_UNAVAILABLE` with instructions to restore from an encrypted backup.
- **Startup Reconciliation**: On startup, metadata entries without a corresponding secret in the vault are marked `status: "untested"` with `secretMissing: true`; orphan secrets without metadata are cleaned up.

### 2.2 Code-Signing Identities & Keychain Access Prompts
- macOS ties Keychain item access to the application's code-signing identity.
- With **ad-hoc signing** (`codesign --sign -`), the binary hash changes on every rebuild, which can cause macOS Keychain to prompt again or refuse automatic access to previously sealed items.
- **Mandatory Pre-Rebuild Backup Rule**:
  1. **Before ANY rebuild or replacement of the installed `.app`**, create an **Encrypted Backup with Secrets** (`Settings → Backup & Export`, gated by Touch ID / confirmation).
  2. Prefer a **stable signing identity** from the first desktop build:
     - **Option 1**: A free self-signed `"Code Signing"` certificate created by the user in macOS Keychain Access (*Certificate Assistant → Create a Certificate*, stable for your own Mac).
     - **Option 2**: An **Apple Development** certificate (via Xcode with a free or paid Apple ID).
     - **Option 3**: A **Developer ID Application** certificate (paid Apple Developer Program, required only for external distribution/notarization).
  3. Pass your signing identity name via the `CSC_NAME` environment variable during local builds (never commit certificates or identity names to Git).

### 2.3 Clipboard & Universal Clipboard Warning (`07_P3 §6`)
- `keys.copySecret(id)` writes the secret to the clipboard in the Main process after Touch ID / confirmation, marks the pasteboard item with `org.nspasteboard.ConcealedType` on macOS so compliant clipboard managers ignore it, and schedules an automatic clear after 30 seconds if the clipboard still holds that exact value.
- **Security Note**: Third-party clipboard managers that ignore `ConcealedType` and macOS **Universal Clipboard (Handoff)** across nearby Apple devices may still retain or sync copied secrets.

---

## 3. Proxy / VPN Behavior & Connect-Time SSRF Guard (`07_P3 §0A.2, §5, §9`)

- **Default Mode (Direct Connection with Connect-Time Guarded `lookup`)**:
  - `MainProcessExecutor` uses an explicitly installed, pinned `undici` package (`Agent` + `undiciFetch`) with a custom connect-time `lookup` callback that validates every resolved IPv4/IPv6 address against private RFC 1918, loopback, link-local / cloud metadata (`169.254.0.0/16`), CGNAT, multicast, and IPv4-mapped IPv6 ranges at socket connect time, defeating DNS rebinding.
- **Startup & Per-Host System Proxy Detection**:
  - At startup and before requests, the app calls `session.defaultSession.resolveProxy(url)`. If the PAC result is not `DIRECT`, it logs and attaches the diagnostic: `"A system proxy is configured; direct connections may fail"`.
- **Optional Setting ("Use system proxy")**:
  - When enabled in `Settings`, `MainProcessExecutor` routes requests through `undici`'s `ProxyAgent`.
  - **Weaker Guarantee Warning**: Because the upstream proxy resolves the final destination IP address, the local connect-time IP check cannot inspect the proxy's outbound socket. In this mode, `MainProcessExecutor` enforces literal-host checks, a local pre-resolution DNS check on this Mac, `https:`-only transport, and approved provider hosts only (`boundHost` / `allowedHosts`), and marks responses with `x-keylab-proxy-mode: system-proxy-weaker-connect-ip-guarantee`.
  - Full-tunnel VPNs operating at the macOS network interface level work transparently in default direct mode.

---

## 4. Notifications & Unified Scheduler (`07_P3 §0A.3 & §0A.4`)

- **Main-Process Notifications**:
  - Key expiry alerts and Model Watch daily digests use the Electron main-process `Notification` class (`src/electron/notificationService.ts`).
  - Because macOS may suppress notifications for ad-hoc-signed bundles, any unsupported or failed native notification automatically falls back to the in-app banner (`in-app-banner-fallback`).
  - The renderer's `session.defaultSession.setPermissionRequestHandler` remains **deny-all** (`callback(false)`).
  - No notification fires while the app is closed; there is no login item, launch agent, or background daemon.
- **Unified Scheduler (`src/services/schedulerService.ts`)**:
  - Health checks and opt-in scheduled Model Watch (Tier 0 only, at most 1 key per provider, default 24 h, minimum 6 h) share one in-memory scheduler that runs only while the app is open and is **off by default**.
  - Both obey the Budget Guard and automatically skip expired (`expiresAt`) and `unauthorized` keys.

---

## 5. Data Locations, App Translocation & Gatekeeper (`07_P3 §12, §15, §21`)

- **Data Directory**: `~/Library/Application Support/AI API Key Lab` (`app.getPath('userData')`)
- **Logs Directory**: `~/Library/Logs/AI API Key Lab/app.log` (`app.getPath('logs')`)
- **App Translocation Note**: If you launch `AI API Key Lab.app` directly from the mounted `.dmg` or from `~/Downloads`, macOS Gatekeeper may run it from a read-only translocated path. Always drag `AI API Key Lab.app` into `/Applications` before running persistence tests.
- **Gatekeeper Approval for Local Ad-Hoc Builds**: An ad-hoc-signed `.app` copied from another Mac or downloaded from a browser is quarantined by macOS and must be approved via **System Settings → Privacy & Security → "Open Anyway"**. Never disable Gatekeeper globally.
- **Uninstallation & Data Removal**: Deleting `AI API Key Lab.app` from `/Applications` does not automatically delete `~/Library/Application Support/AI API Key Lab` or Keychain items. Use **Settings → Erase All Data…** before uninstalling to wipe all metadata, Keychain secrets, history, and logs (user backup files are never deleted automatically).
