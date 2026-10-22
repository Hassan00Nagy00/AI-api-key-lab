import { ErrorCategory } from './test';
import { KeyStatus } from './key';

export interface DiagnosticInfo {
  category: ErrorCategory;
  status: KeyStatus;
  httpStatus?: number;
  title: string;
  explanation: string;
  possibleCauses: string[];
  recommendedActions: string[];
  isRecoverable: boolean;
  isBrowserLimitation?: boolean;
}
