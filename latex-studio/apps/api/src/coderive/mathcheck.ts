import type { DerivationResult, EquivalenceResult, MathParseResult, VerificationCandidate } from '@latex-studio/shared';

/**
 * The mathcheck client accepts ONLY VerificationCandidate — the branded type
 * whose sole constructor (makeVerificationCandidate) runs the maths guard.
 * LLM-context material (reference text, prose, …) is plain string/LlmContextChunk
 * and is not structurally passable here.
 */

/** POST to the internal mathcheck service with a per-call timeout. */
async function postMathcheck<T>(url: string, path: string, body: unknown, timeoutMs = 8000): Promise<T> {
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
  lhs: VerificationCandidate,
  rhs: VerificationCandidate,
  assumptions: string,
  macros: Record<string, string>,
  timeoutMs?: number,
): Promise<EquivalenceResult> {
  return postMathcheck<EquivalenceResult>(url, '/equivalent', { lhs: lhs.latex, rhs: rhs.latex, assumptions, macros }, timeoutMs);
}

export function checkDerivation(
  url: string,
  steps: VerificationCandidate[],
  assumptions: string,
  macros: Record<string, string>,
  timeoutMs?: number,
): Promise<DerivationResult> {
  return postMathcheck<DerivationResult>(url, '/check-derivation', { steps: steps.map((s) => s.latex), assumptions, macros }, timeoutMs);
}

export function parseExpression(
  url: string,
  latex: VerificationCandidate,
  macros: Record<string, string>,
  timeoutMs?: number,
): Promise<MathParseResult> {
  return postMathcheck<MathParseResult>(url, '/parse', { latex: latex.latex, macros }, timeoutMs);
}
