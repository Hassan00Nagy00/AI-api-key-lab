# TESTING.md — Testing Strategy & Verification Gate

## 1. Automated Test Suite

Run all unit tests:
```bash
npm test
```
Tests cover:
- **Error Classification**: All mappings from §2 canonical status table.
- **Response Validation**: Valid text, empty text, reasoning retry, length limits.
- **Model Selection**: Exclusion patterns, candidate ranking, user overrides.
- **Host Binding**: Host mismatches, URL credentials, protocol checks.
- **Backup Cryptography**: PBKDF2/AES-GCM encryption, decryption, tampering rejection.

## 2. Real HTTP Fake Provider Gate (`test:gate`)

Run the live test gate:
```bash
npm run test:gate
```
Spawns a local HTTP mock server testing all network scenarios:
- `200` valid generation -> `working`
- `200` empty output -> `unknown-error` (`empty-response`)
- `401` Unauthorized -> `unauthorized` (`authVerified=no`)
- `402` Insufficient Credit -> `no-credit` (`authVerified=yes`)
- `403` Forbidden -> `forbidden` (`authVerified=yes`)
- `404` Model Not Found -> `no-usable-model` (triggers candidate fallback)
- `429` Rate Limit -> `rate-limited` (`authVerified=yes`, never unauthorized)
- `500` / `503` -> `provider-unavailable`
- Malformed response -> `unknown-error` / `config-error`
