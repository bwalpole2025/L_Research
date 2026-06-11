import type { AiErrorKind, AiStatus } from '@latex-studio/shared';
import { aiErrorMessage } from '../providers/index.js';

/**
 * Process-global AI availability (single-user app). Updated by every AI call;
 * surfaced at GET /ai/status so the UI can show a banner and gate AI features.
 */
let status: AiStatus = { available: true };

export function getAiStatus(): AiStatus {
  return status;
}

export function markAiOk(): void {
  status = { available: true };
}

export function markAiError(kind: AiErrorKind): void {
  // Only blanket failures gate the whole UI. 'other'/'invalid' are per-call.
  if (kind === 'credit_exhausted' || kind === 'auth' || kind === 'unavailable') {
    status = { available: false, reason: kind, message: aiErrorMessage(kind) };
  }
}
