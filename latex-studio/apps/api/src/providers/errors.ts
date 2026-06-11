import type { AiErrorKind } from '@latex-studio/shared';

/** A provider failure tagged with a classified kind for the UI. */
export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export function errorText(input: unknown): string {
  if (input instanceof Error) return input.message;
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

// Heuristic classification of SDK/CLI failures. Centralised so it's easy to
// refine as we observe real error shapes. Credit is checked first because
// quota messages and auth messages can share words like "limit".
const CREDIT =
  /credit|usage limit|limit reached|quota|exhaust|429|too many requests|insufficient|billing cycle|monthly/i;
const AUTH =
  /not logged in|run .*login|please log ?in|authenticat|unauthorized|forbidden|401|403|invalid api key|missing api key|no api key|oauth|credential|token (?:expired|invalid)/i;
const UNAVAILABLE =
  /not found|enoent|spawn|executable|command not found|econnrefused|network|timed? ?out|unavailable|failed to start/i;

export function classifyAiError(input: unknown): AiErrorKind {
  if (input instanceof AiProviderError) return input.kind;
  const text = errorText(input);
  if (CREDIT.test(text)) return 'credit_exhausted';
  if (AUTH.test(text)) return 'auth';
  if (UNAVAILABLE.test(text)) return 'unavailable';
  return 'other';
}

/** A short, user-facing message per error kind (for the AI status banner). */
export function aiErrorMessage(kind: AiErrorKind): string {
  switch (kind) {
    case 'credit_exhausted':
      return 'Agent SDK credit exhausted — resets with your billing cycle.';
    case 'auth':
      return 'Claude sign-in required — run `claude login` on the host, then retry.';
    case 'unavailable':
      return 'AI backend unavailable — is the Claude Agent SDK installed and reachable?';
    case 'invalid':
      return 'AI provider is not configured.';
    default:
      return 'AI request failed.';
  }
}
