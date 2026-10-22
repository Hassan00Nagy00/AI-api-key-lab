# PROVIDERS.md — Provider Adapters & Catalog

## 1. Supported Protocols & Adapters

1. **Google Gemini (`google-gemini`)**
   - Protocol: Native Gemini REST API.
   - Headers: `x-goog-api-key: {{secret}}` (header authentication, not query parameter).
   - Endpoints: `GET /models` and `POST /models/{modelId}:generateContent`.
   - Filters: Model must support `generateContent` and pass `excludeModelPatterns` (filtering out embeddings, imagen, live/realtime, etc.).

2. **OpenAI-Compatible (`openai-compatible`)**
   - Protocol: Industry standard chat completions.
   - Headers: `Authorization: Bearer {{secret}}`.
   - Endpoints: `GET /models` and `POST /chat/completions`.
   - Used by Groq, OpenRouter, NVIDIA NIM, Mistral, Cerebras, SambaNova, DeepSeek, etc.

3. **Anthropic Compatible (`anthropic-compatible`)**
   - Protocol: Anthropic Messages API.
   - Headers: `x-api-key: {{secret}}`, `anthropic-version: 2023-06-01`, and `anthropic-dangerous-direct-browser-access: true` for browser calls.
   - Endpoints: `POST /v1/messages`.

4. **Cohere (`cohere`)**
   - Protocol: Native Cohere v2 format.
   - Headers: `Authorization: Bearer {{secret}}`.
   - Endpoints: `GET /v2/models` and `POST /v2/chat`.

5. **Generic REST (`generic-rest`)**
   - Configurable custom builder with safe template parsing without `eval`.

---

## 2. Free Tier Detection Hierarchy

To prevent false claims, free models are evaluated via a strict evidence ladder:
1. `provider-api`: Pricing metadata returned directly by the endpoint (e.g. OpenRouter pricing.prompt === 0).
2. `user`: Explicit user tier override.
3. `registry`: Bundled registry entry with `verifiedAt` timestamp (entries older than 90 days flagged as stale).
4. `naming-rule`: Provider-declared rule (e.g. `:free` suffix).
5. `none`: Tier remains `unknown` ("Tier unverified").

A key is considered `working` if generation succeeds on *any* non-paid model, regardless of whether free tier pricing is officially confirmed.
