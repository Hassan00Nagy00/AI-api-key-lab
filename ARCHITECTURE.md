# ARCHITECTURE.md — System Architecture & Design

## 1. System Layers

```
┌────────────────────────────────────────────────────────┐
│                   UI Presentation Layer                │
│    (React 19 + Tailwind CSS + Lucide Icons + RTL)      │
├────────────────────────────────────────────────────────┤
│                      Hooks Layer                       │
│      (useKeys, useProviders, useSettings, etc.)        │
├────────────────────────────────────────────────────────┤
│                     Service Layer                      │
│   (ApiTestService, ModelService, ChatService, etc.)    │
├──────────────────────────┬─────────────────────────────┤
│    Provider Adapters     │      Storage & Vault        │
│  (Gemini, OpenAI, etc.)  │ (WebCrypto AES-256-GCM +    │
│  Output: PreparedRequest │  PBKDF2 600,000 rounds)     │
├──────────────────────────┴─────────────────────────────┤
│                ApiExecutor (Late Binding)              │
│       - Validates host against key.boundHost           │
│       - Injects secret into placeholder {{secret}}     │
│       - Performs network fetch & captures CORS opacity │
└────────────────────────────────────────────────────────┘
```

## 2. Late Secret Binding

Adapters build the HTTP request description without ever accessing the stored secret:
```typescript
interface PreparedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}
```
The secret value is represented by the placeholder `{{secret}}`. The `ApiExecutor` verifies host binding and substitutes the placeholder right before the fetch.

## 3. Host Binding Security

Every key has a `boundHost` property. Requests are only dispatched if:
1. `new URL(request.url).hostname === key.boundHost`
2. URL protocol is HTTPS (or local HTTP for localhost)
3. No credentials embedded in the URL (`username`/`password`)
Changing a base URL host requires confirmation and immediately resets the key status to `untested`.

## 4. Extensibility

Adding a new provider requires only ONE registration call:
```typescript
ProviderRegistry.registerProvider({
  id: "example-ai",
  name: "Example AI",
  protocol: "openai-compatible",
  baseUrl: "https://api.example.com/v1",
  allowedHosts: ["api.example.com"],
  supportsModelListing: true,
  supportsChat: true,
  source: "bundled"
});
```
No edits to UI components, schemas, or unrelated files are needed.
