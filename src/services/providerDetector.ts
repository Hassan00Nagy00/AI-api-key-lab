import { ProviderConfig, KeyShapeCharset } from '../types/provider';
import { ProviderRegistry } from './providerRegistry';

export interface ProviderDetectionCandidate {
  provider: ProviderConfig;
  matchedPrefix: string;
  needsVerification: boolean;
  description?: string;
}

export interface ProviderDetectionResult {
  candidates: ProviderDetectionCandidate[];
  isAmbiguous: boolean;
  suggestionText: string | null;
}

/**
 * ReDoS-safe Provider Detection from Key Shape (§13A).
 * Uses strict prefix, length, and character-code checks — NEVER arbitrary regex.
 * Key shape is a hint/suggestion only, never validation, and never triggers network traffic before user confirmation.
 */
export class ProviderDetector {
  private static matchesCharset(value: string, charset: KeyShapeCharset): boolean {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      const isDigit = code >= 48 && code <= 57;
      const isUpper = code >= 65 && code <= 90;
      const isLower = code >= 97 && code <= 122;

      if (charset === 'alphanumeric') {
        if (!isDigit && !isUpper && !isLower) return false;
      } else if (charset === 'alphanumeric-dash-underscore') {
        const isDash = code === 45;       // '-'
        const isUnderscore = code === 95; // '_'
        const isColon = code === 58;      // ':'
        const isDot = code === 46;        // '.'
        if (!isDigit && !isUpper && !isLower && !isDash && !isUnderscore && !isColon && !isDot) {
          return false;
        }
      } else if (charset === 'ascii-printable') {
        if (code < 33 || code > 126) return false;
      }
    }
    return true;
  }

  static detect(rawKey: string, providers?: ProviderConfig[]): ProviderDetectionResult {
    const trimmed = (rawKey || '').trim();
    if (trimmed.length < 10) {
      return {
        candidates: [],
        isAmbiguous: false,
        suggestionText: null,
      };
    }

    const catalog = providers || ProviderRegistry.getAll();
    const matched: ProviderDetectionCandidate[] = [];

    for (const provider of catalog) {
      const shapes = provider.keyShape || [];
      for (const shape of shapes) {
        if (!shape.prefix) continue;
        if (!trimmed.startsWith(shape.prefix)) continue;
        if (trimmed.length < shape.minLength || trimmed.length > shape.maxLength) continue;
        if (!this.matchesCharset(trimmed, shape.charset)) continue;

        // Avoid duplicate provider entry if it matches multiple shapes
        if (!matched.some(m => m.provider.id === provider.id)) {
          matched.push({
            provider,
            matchedPrefix: shape.prefix,
            needsVerification: shape.needsVerification ?? true,
            description: shape.description,
          });
        }
      }
    }

    // Sort candidates so longer/more specific prefix matches come first (e.g. 'sk-or-v1-' or 'sk-proj-' before 'sk-')
    matched.sort((a, b) => b.matchedPrefix.length - a.matchedPrefix.length);

    // If a specific prefix (e.g. 'sk-or-v1-' or 'sk-ant-' or 'sk-proj-') matched, filter out generic 'sk-' matches
    // unless all matches have the same prefix length
    if (matched.length > 1 && matched[0].matchedPrefix.length > matched[matched.length - 1].matchedPrefix.length) {
      const maxPrefixLen = matched[0].matchedPrefix.length;
      const specificMatches = matched.filter(m => m.matchedPrefix.length === maxPrefixLen);
      const isAmbiguous = specificMatches.length > 1;
      return {
        candidates: specificMatches,
        isAmbiguous,
        suggestionText: isAmbiguous
          ? `Ambiguous key prefix (${specificMatches[0].matchedPrefix}): Looks like ${specificMatches.map(c => c.provider.name).join(' or ')} — confirm provider`
          : `Looks like ${specificMatches[0].provider.name} — confirm`,
      };
    }

    const isAmbiguous = matched.length > 1;
    const suggestionText =
      matched.length === 0
        ? null
        : isAmbiguous
        ? `Ambiguous prefix (${matched[0].matchedPrefix}): Looks like ${matched.map(c => c.provider.name).join(', ')} — confirm`
        : `Looks like ${matched[0].provider.name} — confirm`;

    return {
      candidates: matched,
      isAmbiguous,
      suggestionText,
    };
  }
}
