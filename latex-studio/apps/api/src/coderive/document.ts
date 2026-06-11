import type {
  DocAuditComment,
  DocumentVerification,
  MathAuditBlock,
  MathAuditReport,
  ModelProvider,
} from '@latex-studio/shared';
import { auditMaths, type AuditInputFile } from '../audit/service.js';
import { windowAroundLine } from '../ai/context.js';

export interface DocumentVerifyDeps {
  mathcheckUrl: string;
  macros: Record<string, string>;
  assumptions: string;
  /** Optional — when present, the AI adds context (never a verdict) for non-passing equations. */
  modelProvider?: ModelProvider;
  model?: string;
  /** Max equations sent for AI commentary (bounded cost). */
  maxComment?: number;
  onProgress?: (stage: string) => void;
}

/** Equations SymPy could not pass — the ones worth AI context, worst first. */
function nonPassing(report: MathAuditReport): MathAuditBlock[] {
  const rank: Record<string, number> = { failing: 0, unknown: 1, passed: 2 };
  return report.blocks
    .filter((b) => b.verdict !== 'passed')
    .sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9));
}

const COMMENT_SYSTEM_PROMPT =
  'You are assisting a mathematician auditing a document. A computer algebra system (SymPy) has ALREADY ' +
  'ruled on each equation below — its verdict is final and you cannot change it. ' +
  'For each equation id, write ONE sentence of context: the most likely reason it failed or could not be ' +
  'verified (a dropped term, a sign error, an undefined macro, a non-algebraic/asymptotic step, a definition ' +
  'rather than an identity, etc.), or what the author should check. ' +
  'This is a hypothesis to guide the human — NOT a correctness verdict. Never say an equation is correct or wrong. ' +
  'Output ONLY a JSON array of {"id": string, "comment": string}. No prose, no fences.';

function buildCommentPrompt(blocks: MathAuditBlock[], fileText: Map<string, string>, macros: Record<string, string>, assumptions: string): string {
  const parts: string[] = [];
  const macroList = Object.entries(macros);
  parts.push(macroList.length ? `Macros in force:\n${macroList.map(([k, v]) => `${k} = ${v}`).join('\n')}` : 'Macros: (none)');
  if (assumptions.trim()) parts.push(`Assumptions: ${assumptions.trim()}`);
  parts.push('Equations SymPy did not pass (verify the CONTEXT, do not re-judge correctness):');
  for (const b of blocks) {
    const around = windowAroundLine(fileText.get(b.file) ?? '', b.lineStart, 600).replace(/\s+/g, ' ').trim().slice(0, 500);
    const cx = b.counterexample
      ? ` SymPy counterexample: ${Object.entries(b.counterexample.values).map(([k, v]) => `${k}=${v}`).join(', ')} ⇒ lhs=${b.counterexample.lhsVal}, rhs=${b.counterexample.rhsVal}.`
      : '';
    parts.push(
      `\n[id ${b.id}] (${b.file}:${b.lineStart}) verdict=${b.verdict} (${b.method ?? 'n/a'}).${cx}\n` +
        `  LaTeX: ${b.latex}\n  Surrounding text: ${around}`,
    );
  }
  parts.push('\nReturn the JSON array now.');
  return parts.join('\n');
}

function parseComments(text: string): DocAuditComment[] {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: DocAuditComment[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id === 'string' && typeof o.comment === 'string' && o.comment.trim()) {
      out.push({ id: o.id, comment: o.comment.trim() });
    }
  }
  return out;
}

/**
 * Verify the algebra across the whole document. SymPy (via the guarded auditMaths)
 * is the sole arbiter of every verdict; the AI only annotates the equations SymPy
 * could not pass, as context. Bibliography is never scanned (auditMaths excludes
 * .bib/.bst and blanks bibliography environments) and the maths guard gates every
 * mathcheck call, so reference text can never reach the verifier.
 */
export async function runDocumentVerification(
  files: AuditInputFile[],
  deps: DocumentVerifyDeps,
  signal?: AbortSignal,
): Promise<DocumentVerification> {
  deps.onProgress?.('verifying equations with SymPy');
  const report = await auditMaths(files, {
    mathcheckUrl: deps.mathcheckUrl,
    macros: deps.macros,
    assumptions: deps.assumptions,
  });

  const candidates = nonPassing(report);
  const maxComment = deps.maxComment ?? 12;
  const toComment = candidates.slice(0, maxComment);

  let comments: DocAuditComment[] = [];
  let commentaryProvided = false;
  if (deps.modelProvider && deps.model && toComment.length > 0) {
    deps.onProgress?.(`asking the AI for context on ${toComment.length} equation(s)`);
    const fileText = new Map(files.map((f) => [f.path, f.content]));
    const user = buildCommentPrompt(toComment, fileText, deps.macros, deps.assumptions);
    try {
      let text = '';
      for await (const delta of deps.modelProvider.chatStream(
        { system: COMMENT_SYSTEM_PROMPT, messages: [{ role: 'user', content: user }], model: deps.model },
        signal,
      )) {
        text += delta.text;
      }
      const validIds = new Set(toComment.map((b) => b.id));
      comments = parseComments(text).filter((c) => validIds.has(c.id)); // AI cannot invent ids
      commentaryProvided = true;
    } catch {
      // AI commentary is best-effort; SymPy verdicts stand on their own.
      comments = [];
      commentaryProvided = false;
    }
  }

  return { report, comments, commentaryProvided, commentedCount: toComment.length };
}
