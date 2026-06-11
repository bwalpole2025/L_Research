import type { DerivationResult, EquivalenceResult, MathParseResult } from '@latex-studio/shared';

/** POST to the internal mathcheck service with a per-call timeout. */
export async function postMathcheck<T>(url: string, path: string, body: unknown, timeoutMs = 8000): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export function checkEquivalent(
  url: string,
  lhs: string,
  rhs: string,
  assumptions: string,
  macros: Record<string, string>,
  timeoutMs?: number,
): Promise<EquivalenceResult> {
  return postMathcheck<EquivalenceResult>(url, '/equivalent', { lhs, rhs, assumptions, macros }, timeoutMs);
}

export function checkDerivation(
  url: string,
  steps: string[],
  assumptions: string,
  macros: Record<string, string>,
  timeoutMs?: number,
): Promise<DerivationResult> {
  return postMathcheck<DerivationResult>(url, '/check-derivation', { steps, assumptions, macros }, timeoutMs);
}

export function parseExpression(
  url: string,
  latex: string,
  macros: Record<string, string>,
  timeoutMs?: number,
): Promise<MathParseResult> {
  return postMathcheck<MathParseResult>(url, '/parse', { latex, macros }, timeoutMs);
}
