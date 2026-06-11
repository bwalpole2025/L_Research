import type { ContextBundle, ModelProvider, ReviewAxis, ReviewConfidence, ReviewFinding, ReviewSeverity } from '@latex-studio/shared';

export const REVIEW_SYSTEM_PROMPT =
  'You are reviewing a LaTeX document on three axes: LITERATURE consistency (internal to this project), ' +
  "BACKGROUND-KNOWLEDGE consistency (your own knowledge of the field), and PROSE (wording, not spelling). " +
  'You are a PROPOSER, never an arbiter — every finding is an UNVERIFIED judgement the author must check.\n\n' +
  'Rules:\n' +
  '- Report ONLY issues you can tie to a specific line range in the numbered text provided.\n' +
  '- LITERATURE: flag a contradiction ONLY when the document disagrees with a reference whose SOURCE TEXT is provided below. ' +
  'Cite the reference key and quote the exact span you checked. If the cited source text is NOT provided, do NOT guess — ' +
  'never assert a contradiction; at most note attribution unverified.\n' +
  '- BACKGROUND: flag a contradiction with a well-established result you know (standard identity, definition, classical result). ' +
  'State what you believe the established result is and that the author must verify it against a real source. ' +
  'NEVER invent a citation. If unsure, OMIT it.\n' +
  '- PROSE: wrong word, broken sentence, inconsistently-defined notation. Do NOT report plain spelling (handled separately).\n' +
  '- Prefer OMISSION to a guess. Never fabricate a reference or a known result.\n\n' +
  'Output ONLY a JSON array (no prose, no fences). Each element: ' +
  '{"axis":"literature"|"background"|"prose","category":string,"severity":"error"|"warning"|"info",' +
  '"fromLine":number,"toLine":number,"message":string,"suggestion"?:string,"reference"?:string,"quotedSpan"?:string}. ' +
  'Line numbers refer to the numbered text. Return [] if you find nothing you can stand behind.';

const CONFIDENCE_BY_AXIS: Record<'literature' | 'background' | 'prose', ReviewConfidence> = {
  literature: 'llm-judgement',
  background: 'llm-judgement-low',
  prose: 'llm-suggestion',
};

/** Number the document's lines (real 1-based numbers), capped by character budget. */
export function numberLines(content: string, maxChars = 14000): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let size = 0;
  for (let i = 0; i < lines.length; i++) {
    const row = `${i + 1}: ${lines[i]}`;
    if (size + row.length > maxChars) {
      out.push('… [later lines truncated]');
      break;
    }
    out.push(row);
    size += row.length + 1;
  }
  return out.join('\n');
}

function renderReferences(bundle: ContextBundle): string {
  if (bundle.references.length === 0) return 'References cited: (none)';
  const lines = ['References cited in this document:'];
  for (const r of bundle.references) {
    const head = [r.author, r.year ? `(${r.year})` : '', r.title].filter(Boolean).join(' ');
    lines.push(`\n[${r.key}] ${head || '(no metadata)'}`);
    if (r.abstract) lines.push(`  Abstract: ${r.abstract.slice(0, 500)}`);
    if (r.provenance === 'full-text' && r.passages?.length) {
      lines.push('  Source passages (you MAY check literature claims against these):');
      for (const p of r.passages) lines.push(`  • ${p}`);
    } else {
      lines.push('  (Source text NOT provided — do not assert a contradiction against this reference.)');
    }
  }
  return lines.join('\n');
}

export function buildReviewUserPrompt(file: string, content: string, bundle: ContextBundle): string {
  const parts: string[] = [`File: ${file}`];
  const macros = Object.entries(bundle.macros);
  if (macros.length > 0) parts.push(`Macros: ${macros.map(([k, v]) => `${k}=${v}`).join('; ')}`);
  if (bundle.assumptions.trim()) parts.push(`Assumptions: ${bundle.assumptions.trim()}`);
  parts.push(`Numbered document text:\n${numberLines(content)}`);
  parts.push(renderReferences(bundle));
  parts.push('Report findings as a JSON array now.');
  return parts.join('\n\n');
}

interface RawFinding {
  axis?: string;
  category?: string;
  severity?: string;
  fromLine?: number;
  toLine?: number;
  message?: string;
  suggestion?: string;
  reference?: string;
  quotedSpan?: string;
}

function repairJsonBackslashes(s: string): string {
  return s.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
}

export function parseReviewFindings(text: string): RawFinding[] {
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
  return Array.isArray(arr) ? (arr as RawFinding[]) : [];
}

const AXES = new Set(['literature', 'background', 'prose']);
const SEVS = new Set(['error', 'warning', 'info']);

/** Coerce + enforce honesty: confidence is fixed by axis; literature against a
 *  non-provided source is downgraded to "attribution unverified", never a contradiction. */
export function normalizeFindings(
  raw: RawFinding[],
  file: string,
  maxLine: number,
  fullTextKeys: Set<string>,
): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  raw.forEach((r, i) => {
    const axis = (r.axis ?? '').toLowerCase();
    if (!AXES.has(axis)) return;
    const message = typeof r.message === 'string' ? r.message.trim() : '';
    if (!message) return;
    const from = Math.max(1, Math.min(maxLine, Math.round(Number(r.fromLine) || 1)));
    const to = Math.max(from, Math.min(maxLine, Math.round(Number(r.toLine) || from)));
    const severity = (SEVS.has(r.severity ?? '') ? r.severity : 'warning') as ReviewSeverity;

    const finding: ReviewFinding = {
      id: `llm:${axis}:${file}:${from}:${i}`,
      axis: axis as ReviewAxis,
      category: typeof r.category === 'string' && r.category ? r.category : axis,
      severity,
      confidence: CONFIDENCE_BY_AXIS[axis as 'literature' | 'background' | 'prose'],
      file,
      lineSpan: { fromLine: from, toLine: to },
      message,
    };
    if (typeof r.suggestion === 'string' && r.suggestion) finding.suggestion = r.suggestion;
    if (typeof r.quotedSpan === 'string' && r.quotedSpan) finding.quotedSpan = r.quotedSpan;

    if (axis === 'literature') {
      const ref = typeof r.reference === 'string' ? r.reference.trim() : '';
      if (!ref || !fullTextKeys.has(ref)) {
        // Source text was not provided — never assert a contradiction.
        finding.category = 'attribution-unverified';
        finding.severity = 'info';
        finding.message = ref
          ? `Attribution unverified: the source text for [${ref}] is not in the project, so this claim could not be checked.`
          : 'Attribution unverified: no in-project reference source to check this claim against.';
        if (ref) finding.reference = ref;
      } else {
        finding.reference = ref;
      }
    } else if (typeof r.reference === 'string' && r.reference) {
      finding.reference = r.reference.trim();
    }

    out.push(finding);
  });
  return out;
}

export async function llmReviewFindings(
  provider: ModelProvider,
  model: string,
  file: string,
  content: string,
  bundle: ContextBundle,
  signal?: AbortSignal,
): Promise<ReviewFinding[]> {
  const fullTextKeys = new Set(bundle.references.filter((r) => r.provenance === 'full-text').map((r) => r.key));
  let text = '';
  for await (const delta of provider.chatStream(
    { system: REVIEW_SYSTEM_PROMPT, messages: [{ role: 'user', content: buildReviewUserPrompt(file, content, bundle) }], model },
    signal,
  )) {
    text += delta.text;
  }
  return normalizeFindings(parseReviewFindings(text), file, content.split('\n').length, fullTextKeys);
}
