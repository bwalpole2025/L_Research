import type { CandidateProposal, ContextBundle, ReferenceContext } from '@latex-studio/shared';

/** System prompt — states plainly that the LLM does NOT decide correctness. */
export const CODERIVE_SYSTEM_PROMPT =
  'Propose mathematical steps. Each step must be a precise LaTeX expression. ' +
  'State which prior expression each step should be algebraically equal to. ' +
  'Do NOT assert correctness — your proposal will be checked by a computer algebra system. ' +
  'Use ONLY the macros and assumptions provided. If you are drawing on a referenced technique, name the cite key.\n\n' +
  'Output ONLY a JSON array (no prose, no markdown fences) of candidate steps. Each element is an object with exactly:\n' +
  '  "latex": string — the proposed LaTeX expression,\n' +
  '  "claimedEqualTo": string — the prior expression (or anchor label) this step is algebraically equal to,\n' +
  '  "technique": string — a short name for the manipulation used,\n' +
  '  "groundedIn": string[] — \\cite keys you drew on (may be empty),\n' +
  '  "rationale": string — one sentence.\n' +
  'For any cite key whose source text is marked "content NOT provided", do NOT fabricate what it says; ' +
  'attribute only at the level of a named technique. Citation accuracy will be checked by the user, not by you.';

function renderReferences(refs: ReferenceContext[]): string {
  if (refs.length === 0) return 'References cited in this chapter: (none)';
  const lines = ['References cited in this chapter:'];
  for (const r of refs) {
    const head = [r.author, r.year ? `(${r.year})` : '', r.title].filter(Boolean).join(' ');
    lines.push(`\n[${r.key}] ${head || '(no bibliography metadata)'}`);
    if (r.abstract) lines.push(`  Abstract: ${r.abstract.slice(0, 600)}`);
    if (r.provenance === 'full-text' && r.passages?.length) {
      lines.push(`  Relevant passages from the source (${r.sourceFile}):`);
      for (const p of r.passages) lines.push(`  • ${p}`);
    } else if (r.provenance === 'not-found') {
      lines.push('  (No bibliography entry found for this key — treat as unknown; do not fabricate.)');
    } else {
      lines.push('  (Source text NOT provided — do not fabricate its contents; name a technique only.)');
    }
  }
  return lines.join('\n');
}

function intentInstruction(b: ContextBundle): string {
  const a = b.anchors;
  switch (b.intent) {
    case 'fill-gap':
      return (
        `Intent: FILL-GAP. Anchor A: $${a.from ?? '?'}$. Anchor C: $${a.to ?? '?'}$.\n` +
        'Propose intermediate step(s) B such that A is algebraically equal to B AND B is algebraically equal to C. ' +
        'Set "claimedEqualTo" to anchor A. Prefer ONE clean intermediate expression; you may offer a few alternatives as separate array elements.'
      );
    case 'next-step':
      return (
        `Intent: NEXT-STEP. Current expression: $${a.from ?? '?'}$.\n` +
        'Propose the next line of the derivation — an expression algebraically equal to the current one. Set "claimedEqualTo" to the current expression. Offer a few distinct candidates.'
      );
    case 'reach-goal':
      return (
        `Intent: REACH-GOAL. Start: $${a.from ?? '?'}$. Target: $${a.goal ?? '?'}$.\n` +
        'Propose a chain of steps (ONE step per array element, in order) transforming the start into the target. ' +
        'Each element must be algebraically equal to the previous element (the first to the start, the last to the target). Set each "claimedEqualTo" to the previous expression.'
      );
    case 'justify':
      return (
        `Intent: JUSTIFY. An existing transition goes from $${a.from ?? '?'}$ to $${a.to ?? '?'}$.\n` +
        'Do NOT propose new mathematics. Set "latex" to the existing target expression, set "claimedEqualTo" to the from-expression, and set "technique" to the named algebraic manipulation that connects them. Return a single element.'
      );
  }
}

export function buildUserPrompt(b: ContextBundle): string {
  const parts: string[] = [];
  const macros = Object.entries(b.macros);
  parts.push(
    macros.length > 0
      ? `Macros (use ONLY these; do not invent notation):\n${macros.map(([k, v]) => `${k} = ${v}`).join('\n')}`
      : 'Macros: (none provided)',
  );
  if (b.assumptions.trim()) parts.push(`Assumptions in force: ${b.assumptions.trim()}`);
  parts.push(`Surrounding document (read-only context for what is being derived):\n${b.documentWindow.trim()}`);
  parts.push(renderReferences(b.references));
  parts.push(intentInstruction(b));
  parts.push('Return the JSON array now.');
  return parts.join('\n\n');
}

export interface Refutation {
  latex: string;
  claimedEqualTo: string;
  reason: string;
}

export function buildCorrectionPrompt(refutations: Refutation[]): string {
  const lines = ['The computer algebra system REFUTED these proposals (they are not algebraically equal as claimed):'];
  for (const r of refutations) {
    lines.push(`- $${r.latex}$ was claimed equal to $${r.claimedEqualTo}$. ${r.reason}`);
  }
  lines.push('\nRevise. Propose corrected step(s) as a fresh JSON array in the same schema. Do not repeat a refuted expression unchanged.');
  return lines.join('\n');
}

/**
 * Repair lone backslashes that LaTeX-in-JSON routinely produces (e.g. "\cdot",
 * "\frac") — these are invalid JSON escapes that would break JSON.parse. Any
 * backslash not introducing a valid JSON escape is doubled.
 */
function repairJsonBackslashes(s: string): string {
  return s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

/** Robustly extract the JSON array of proposals from the model's output. */
export function parseProposals(text: string): CandidateProposal[] {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  const slice = stripped.slice(start, end + 1);
  let arr: unknown;
  try {
    arr = JSON.parse(slice);
  } catch {
    try {
      arr = JSON.parse(repairJsonBackslashes(slice));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const out: CandidateProposal[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const latex = typeof o.latex === 'string' ? o.latex.trim() : '';
    if (!latex) continue;
    out.push({
      latex,
      claimedEqualTo: typeof o.claimedEqualTo === 'string' ? o.claimedEqualTo : '',
      technique: typeof o.technique === 'string' ? o.technique : '',
      groundedIn: Array.isArray(o.groundedIn) ? o.groundedIn.filter((x): x is string => typeof x === 'string') : [],
      rationale: typeof o.rationale === 'string' ? o.rationale : '',
    });
  }
  return out;
}
