export interface ParsedGenerateResponse {
  visibleText: string;
  reasoningText?: string;
  isReasoningOnly?: boolean;
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  hasErrorObject?: boolean;
  errorMessage?: string;
}

export interface ValidationSuccess {
  isValid: true;
  visibleText: string;
  reasoningText?: string;
  reasoningOnlyWarning?: boolean;
  usage?: ParsedGenerateResponse['usage'];
}

export interface ValidationFailure {
  isValid: false;
  category: 'malformed-response' | 'empty-response' | 'reasoning-retry-needed' | 'error-object';
  errorMessage: string;
  reasoningText?: string;
}

export type ValidationOutcome = ValidationSuccess | ValidationFailure;

/**
 * Validates a parsed generate response according to §2 Response Validation
 */
export function validateResponse(parsed: ParsedGenerateResponse): ValidationOutcome {
  if (parsed.hasErrorObject) {
    return {
      isValid: false,
      category: 'error-object',
      errorMessage: parsed.errorMessage || 'Response contains embedded error object',
    };
  }

  const hasVisibleText = Boolean(parsed.visibleText && parsed.visibleText.trim().length > 0);
  const hasReasoning = Boolean(parsed.reasoningText && parsed.reasoningText.trim().length > 0);

  // Normal success: non-empty visible text
  if (hasVisibleText) {
    return {
      isValid: true,
      visibleText: parsed.visibleText.trim(),
      reasoningText: parsed.reasoningText,
      usage: parsed.usage,
    };
  }

  // Special case: reasoning/thinking output with no visible text
  if (!hasVisibleText && hasReasoning) {
    const isLengthFinish = parsed.finishReason === 'length' || parsed.finishReason === 'MAX_TOKENS';
    if (isLengthFinish) {
      return {
        isValid: false,
        category: 'reasoning-retry-needed',
        errorMessage: 'Output truncated in reasoning phase. Retry with increased max tokens.',
        reasoningText: parsed.reasoningText,
      };
    }

    // Still reasoning-only after retry: working with warning
    return {
      isValid: true,
      visibleText: '(Model produced reasoning-only response without visible text)',
      reasoningText: parsed.reasoningText,
      reasoningOnlyWarning: true,
      usage: parsed.usage,
    };
  }

  // Neither visible text nor reasoning
  return {
    isValid: false,
    category: 'empty-response',
    errorMessage: 'Response returned HTTP 200 but contained no usable text or generation output.',
  };
}
