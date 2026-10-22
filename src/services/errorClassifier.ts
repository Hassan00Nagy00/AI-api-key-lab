import { ErrorCategory, ERROR_CATEGORY_TO_KEY_STATUS } from '../types/test';
import { KeyStatus, AuthVerified } from '../types/key';
import { ProviderConfig, ProviderErrorSignal } from '../types/provider';
import { RedactorService } from './redactor';

export interface ClassificationResult {
  category: ErrorCategory;
  status: KeyStatus;
  authVerified: AuthVerified;
  message: string;
  isFallbackWorthy: boolean;
  matchedSignal?: string;
}

const DEFAULT_FALLBACK_SIGNALS: ProviderErrorSignal[] = [
  { httpStatus: 400, match: 'api_key_invalid', category: 'auth', needsVerification: true },
  { httpStatus: 400, match: 'api key not valid', category: 'auth', needsVerification: true },
  { httpStatus: 400, match: 'invalid_api_key', category: 'auth', needsVerification: true },
  { httpStatus: 401, match: 'invalid_api_key', category: 'auth', needsVerification: true },
  { httpStatus: 404, match: 'model_not_found', category: 'model-not-found', needsVerification: true },
  { httpStatus: 404, match: 'does not exist', category: 'model-not-found', needsVerification: true },
  { httpStatus: 404, match: 'is not found for api version', category: 'model-not-found', needsVerification: true },
  { httpStatus: 404, match: 'model not found', category: 'model-not-found', needsVerification: true },
  { httpStatus: 404, match: 'is not found', category: 'model-not-found', needsVerification: true },
  { httpStatus: 400, match: 'model_not_found', category: 'model-not-found', needsVerification: true },
  { httpStatus: 400, match: 'model not found', category: 'model-not-found', needsVerification: true },
  { httpStatus: 400, match: 'invalid model', category: 'model-not-found', needsVerification: true },
  { httpStatus: 400, match: 'does not exist', category: 'model-not-found', needsVerification: true },
];

/**
 * Canonical error classifier adhering strictly to §2 Canonical Definitions & Provider Signal Priority
 */
export function classifyError(
  httpStatus: number,
  bodyText: string,
  isOpaqueError: boolean = false,
  context: 'models' | 'generate' = 'generate',
  currentAuthVerified: AuthVerified = 'unknown',
  providerOrSignals?: ProviderConfig | ProviderErrorSignal[]
): ClassificationResult {
  const safeBodyText = RedactorService.redactString(bodyText || '');

  // 1. Browser opaque failure (CORS or network)
  if (isOpaqueError || httpStatus === 0) {
    return {
      category: 'cors-or-network',
      status: 'blocked-or-network',
      authVerified: currentAuthVerified,
      message: 'The browser blocked or could not complete the request. This can be CORS or a network problem. It does NOT prove the key is invalid.',
      isFallbackWorthy: false,
    };
  }

  // 2. Parse body for embedded error object if any
  let parsedErrorObject: any = null;
  try {
    const json = JSON.parse(safeBodyText);
    if (json.error) {
      parsedErrorObject = json.error;
    }
  } catch {
    // Not valid JSON
  }

  const lowerBody = safeBodyText.toLowerCase();
  const safeParsedMessage = parsedErrorObject?.message
    ? RedactorService.redactString(String(parsedErrorObject.message))
    : undefined;

  // 3. PROVIDER SIGNAL PRIORITY (§2):
  // The provider's own error signal in the response body overrides the HTTP-status table.
  const signals: ProviderErrorSignal[] = Array.isArray(providerOrSignals)
    ? [...providerOrSignals, ...DEFAULT_FALLBACK_SIGNALS]
    : providerOrSignals?.errorSignals
    ? [...providerOrSignals.errorSignals, ...DEFAULT_FALLBACK_SIGNALS]
    : DEFAULT_FALLBACK_SIGNALS;

  for (const sig of signals) {
    if (sig.httpStatus !== undefined && sig.httpStatus !== httpStatus) {
      continue;
    }
    if (lowerBody.includes(sig.match.toLowerCase())) {
      const category = sig.category;
      const status = ERROR_CATEGORY_TO_KEY_STATUS[category];
      const authVerified: AuthVerified =
        category === 'auth'
          ? 'no'
          : category === 'model-not-found' ||
            category === 'rate-limit' ||
            category === 'quota-exhausted' ||
            category === 'insufficient-credit' ||
            category === 'forbidden'
          ? 'yes'
          : currentAuthVerified;
      const isFallbackWorthy =
        category === 'model-not-found' ||
        category === 'rate-limit' ||
        category === 'quota-exhausted' ||
        category === 'empty-response';

      return {
        category,
        status,
        authVerified,
        message:
          safeParsedMessage ||
          `Provider error signal matched (${sig.match} -> ${category}, HTTP ${httpStatus})`,
        isFallbackWorthy,
        matchedSignal: sig.match,
      };
    }
  }

  // If 200 + error object, classify by the error's own code
  if (httpStatus === 200 && parsedErrorObject) {
    const errCode = parsedErrorObject.code || parsedErrorObject.status;
    const errMessage = safeParsedMessage || RedactorService.redactString(JSON.stringify(parsedErrorObject));

    if (errCode === 401 || errCode === 'invalid_api_key' || errCode === 'unauthenticated') {
      return {
        category: 'auth',
        status: 'unauthorized',
        authVerified: 'no',
        message: errMessage,
        isFallbackWorthy: false,
      };
    }
    if (errCode === 402 || errCode === 'insufficient_quota') {
      return {
        category: 'insufficient-credit',
        status: 'no-credit',
        authVerified: 'yes',
        message: errMessage,
        isFallbackWorthy: false,
      };
    }
    if (errCode === 403 || errCode === 'permission_denied') {
      return {
        category: 'forbidden',
        status: 'forbidden',
        authVerified: 'yes',
        message: errMessage,
        isFallbackWorthy: false,
      };
    }
    if (errCode === 429 || errCode === 'rate_limit_exceeded') {
      return {
        category: 'rate-limit',
        status: 'rate-limited',
        authVerified: 'yes',
        message: errMessage,
        isFallbackWorthy: true,
      };
    }
  }

  // 4. Default HTTP Status Mappings per §2
  switch (httpStatus) {
    case 401:
      return {
        category: 'auth',
        status: 'unauthorized',
        authVerified: 'no',
        message: safeParsedMessage || 'Invalid or expired API key (401 Unauthorized)',
        isFallbackWorthy: false,
      };

    case 403:
      return {
        category: 'forbidden',
        status: 'forbidden',
        authVerified: 'yes',
        message: safeParsedMessage || 'Access forbidden (403 Forbidden)',
        isFallbackWorthy: false,
      };

    case 402:
      return {
        category: 'insufficient-credit',
        status: 'no-credit',
        authVerified: 'yes',
        message: safeParsedMessage || 'Insufficient balance or credit (402 Payment Required)',
        isFallbackWorthy: false,
      };

    case 404:
      return {
        category: 'endpoint-not-found',
        status: 'config-error',
        authVerified: currentAuthVerified,
        message: `Endpoint URL not found (404): verify base URL and ${context} endpoint configuration`,
        isFallbackWorthy: false,
      };

    case 400:
    case 422:
      return {
        category: 'bad-request',
        status: 'config-error',
        authVerified: currentAuthVerified,
        message: safeParsedMessage || `Bad request (${httpStatus}): invalid request payload or parameters`,
        isFallbackWorthy: false,
      };

    case 408:
      return {
        category: 'timeout',
        status: 'network-error',
        authVerified: currentAuthVerified,
        message: 'Request timed out waiting for provider response (408)',
        isFallbackWorthy: false,
      };

    case 409:
      return {
        category: 'conflict',
        status: 'unknown-error',
        authVerified: currentAuthVerified,
        message: safeParsedMessage || 'Conflict occurred (409)',
        isFallbackWorthy: false,
      };

    case 429:
      return {
        category: lowerBody.includes('quota') ? 'quota-exhausted' : 'rate-limit',
        status: 'rate-limited',
        authVerified: 'yes',
        message: safeParsedMessage || 'Rate limit reached or quota exhausted (429)',
        isFallbackWorthy: true,
      };

    case 500:
      return {
        category: 'server-error',
        status: 'provider-unavailable',
        authVerified: currentAuthVerified,
        message: safeParsedMessage || 'Provider internal server error (500)',
        isFallbackWorthy: false,
      };

    case 502:
      return {
        category: 'bad-gateway',
        status: 'provider-unavailable',
        authVerified: currentAuthVerified,
        message: 'Provider bad gateway (502)',
        isFallbackWorthy: false,
      };

    case 503:
    case 504:
      return {
        category: 'service-unavailable',
        status: 'provider-unavailable',
        authVerified: currentAuthVerified,
        message: 'Provider service unavailable or gateway timeout (503/504)',
        isFallbackWorthy: false,
      };

    default:
      if (httpStatus >= 500) {
        return {
          category: 'server-error',
          status: 'provider-unavailable',
          authVerified: currentAuthVerified,
          message: `Provider server error (${httpStatus})`,
          isFallbackWorthy: false,
        };
      }
      return {
        category: 'unknown',
        status: 'unknown-error',
        authVerified: currentAuthVerified,
        message: safeParsedMessage || `Unexpected HTTP error (${httpStatus})`,
        isFallbackWorthy: false,
      };
  }
}

