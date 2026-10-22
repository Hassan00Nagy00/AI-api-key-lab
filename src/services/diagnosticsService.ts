import { ErrorCategory } from '../types/test';
import { KeyStatus } from '../types/key';
import { DiagnosticInfo } from '../types/diagnostics';

export class DiagnosticsService {
  static getDiagnostic(category: ErrorCategory, status: KeyStatus, httpStatus?: number): DiagnosticInfo {
    switch (category) {
      case 'auth':
        return {
          category,
          status,
          httpStatus,
          title: 'Unauthorized / Invalid Key (401)',
          explanation: 'The provider rejected your API key. The key was either entered incorrectly, has expired, or is revoked.',
          possibleCauses: [
            'API key contains extra whitespace or missing characters.',
            'API key was revoked or deleted in the provider console.',
            'Provider uses a different authorization header or prefix.',
          ],
          recommendedActions: [
            'Visit the provider console and generate a fresh API key.',
            'Check that no leading or trailing spaces exist.',
            'Verify you selected the matching provider profile.',
          ],
          isRecoverable: true,
        };

      case 'forbidden':
        return {
          category,
          status,
          httpStatus,
          title: 'Access Forbidden (403)',
          explanation: 'The API key is authenticated, but your account lacks permission to access the requested model or feature.',
          possibleCauses: [
            'Your account requires phone verification or identity completion.',
            'The selected model is restricted to a private beta or specific tier.',
            'Geographic IP restrictions or regional embargo.',
          ],
          recommendedActions: [
            'Log into your provider console and verify your account status.',
            'Check if access request is required for this model family.',
            'Try selecting a standard open weights model.',
          ],
          isRecoverable: true,
        };

      case 'insufficient-credit':
        return {
          category,
          status,
          httpStatus,
          title: 'Payment Required / Insufficient Credit (402)',
          explanation: 'The provider requires a prepaid balance, or your initial trial credits have expired.',
          possibleCauses: [
            'Trial credits expired or reached $0 balance.',
            'Provider does not offer a permanent zero-cost free tier.',
          ],
          recommendedActions: [
            'Check your balance in the provider billing dashboard.',
            'Switch to a provider offering permanent free tier (e.g. Gemini or Groq).',
          ],
          isRecoverable: true,
        };

      case 'rate-limit':
      case 'quota-exhausted':
        return {
          category,
          status,
          httpStatus,
          title: 'Rate Limit / Quota Exhausted (429)',
          explanation: 'You exceeded the allowable requests per minute (RPM) or tokens per day (TPD) on this key.',
          possibleCauses: [
            'Free tier rate limit reached due to multiple rapid tests.',
            'Daily request ceiling reached.',
            'Shared IP rate limits on free cloud endpoints.',
          ],
          recommendedActions: [
            'Wait 60 seconds and test again (your key is valid).',
            'Avoid parallel mass-testing on free tier keys.',
          ],
          isRecoverable: true,
        };

      case 'cors-or-network':
        return {
          category,
          status,
          httpStatus,
          title: 'Blocked / Network Failure (Browser CORS)',
          explanation: 'The browser blocked or could not complete the request. This can be CORS or a network problem. It does NOT prove the key is invalid.',
          possibleCauses: [
            'The provider does not include Cross-Origin Resource Sharing (CORS) headers for browser origins.',
            'Network connectivity issue, firewall, or DNS resolution failure.',
            'Ad-blocker or privacy extension blocked third-party API fetch.',
          ],
          recommendedActions: [
            'Test this key via the macOS Desktop build (or curl) which operates outside browser CORS restrictions.',
            'Ensure your internet connection is active.',
            'Whitelist the domain in browser extensions.',
          ],
          isRecoverable: true,
          isBrowserLimitation: true,
        };

      case 'model-not-found':
        return {
          category,
          status,
          httpStatus,
          title: 'Model Not Found / Unsupported (404)',
          explanation: 'The requested model identifier was not found on this provider endpoint.',
          possibleCauses: [
            'The model was deprecated or renamed by the provider.',
            'Model ID format differs (e.g. prefix models/ vs clean ID).',
          ],
          recommendedActions: [
            'Click "Refresh Models" in the Models directory to get active live models.',
            'Select an alternative recommended model.',
          ],
          isRecoverable: true,
        };

      case 'endpoint-not-found':
        return {
          category,
          status,
          httpStatus,
          title: 'Endpoint URL Not Found (404)',
          explanation: 'The configured Base URL or endpoint path does not exist on this server.',
          possibleCauses: [
            'Missing /v1 suffix in custom base URL.',
            'Incorrect provider base URL configuration.',
          ],
          recommendedActions: [
            'Verify the base URL in provider documentation.',
            'Ensure the trailing path matches the protocol format.',
          ],
          isRecoverable: true,
        };

      case 'server-error':
      case 'bad-gateway':
      case 'service-unavailable':
        return {
          category,
          status,
          httpStatus,
          title: 'Provider Outage / Unavailable (5xx)',
          explanation: 'The provider server encountered an internal error or gateway outage.',
          possibleCauses: [
            'Temporary service downtime or maintenance on provider side.',
            'Overloaded inference cluster.',
          ],
          recommendedActions: [
            'Check provider status page.',
            'Try testing again in a few minutes.',
          ],
          isRecoverable: true,
        };

      default:
        return {
          category: 'unknown',
          status: 'unknown-error',
          httpStatus,
          title: 'Unexpected Test Error',
          explanation: 'An unexpected response was received during test execution.',
          possibleCauses: ['Unknown provider behavior or network interruption.'],
          recommendedActions: ['Review technical details below and retry.'],
          isRecoverable: true,
        };
    }
  }
}
