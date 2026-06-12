import type {
  DocAuditComment,
  DocumentVerification,
  MathAuditBlock,
  MathAuditReport,
  ModelProvider,
} from '@latex-studio/shared';
import { auditMaths, type AuditInputFile } from '../audit/service.js';
import { windowAroundLine } from '../ai/context.js';

/** Rendered text of the freshly compiled PDF (mathcheck /extract-pdf). */
export interface PdfContext {
  text: string;
  pageOffsets: { page: number; charStart: number }[];
  pageCount: number;
}

/** Extract the compiled PDF's rendered text + page map via mathcheck (PyMuPDF). */
export async function extractPdfContext(mathcheckUrl: string, pdfBase64: string, timeoutMs = 60000): Promise<PdfContext | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${mathcheckUrl}/extract-pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdf_base64: pdfBase64 }),
      signal: ac.signal,
    });
    const data = (await res.json()) as {
      text?: string;
      pageCount?: number;
      pageOffsets?: { page: number; charStart: number }[];
      error?: string;
    };
    if (data.error || typeof data.text !== 'string') return null;
    return { text: data.text, pageCount: data.pageCount ?? 0, pageOffsets: data.pageOffsets ?? [] };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface DocumentVerifyDeps {
  mathcheckUrl: string;
  macros: Record<string, string>;
  assumptions: string;
  /** Optional — when present, the AI adds context (never a verdict) for non-passing equations. */
  modelProvider?: ModelProvider;
  model?: string;
  /** Max equations sent for AI commentary (bounded cost). */
  maxComment?: number;
  /** The compiled PDF's rendered text — when present, the AI reads the PDF, not just the source. */
  pdf?: PdfContext;
  /** SyncTeX forward: locate a source line's page in the compiled PDF. */
  locatePage?: (file: string, line: number) => Promise<number | null>;
  onProgress?: (stage: string) => void;
}

/** Equations SymPy could not pass — the ones worth AI context, worst first. */
function nonPassing(report: MathAuditReport): MathAuditBlock[] {
  const rank: Record<string, number> = { failing: 0, unknown: 1, passed: 2 };
  return report.blocks
    .filter((b) => b.verdict !== 'passed')
    .sort((a, b) => (rank[a.verdict] ?? 9) - (rank[b.verdict] ?? 9));
}

/** Rendered text of one 1-based PDF page (from the concatenated extract + offsets). */
function pageText(pdf: PdfContext, page: number, maxChars = 700): string {
  const idx = pdf.pageOffsets.findIndex((p) => p.page === page);
  if (idx === -1) return '';
  const start = pdf.pageOffsets[idx]!.charStart;
  const end = idx + 1 < pdf.pageOffsets.length ? pdf.pageOffsets[idx + 1]!.charStart : pdf.text.length;
  return pdf.text.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

const COMMENT_SYSTEM_PROMPT =
  'You are assisting a mathematician auditing a compiled document. A computer algebra system (SymPy) has ALREADY ' +
  'ruled on each equation — its verdict is final and you cannot change it. You are given the LaTeX source of each ' +
  'equation AND the rendered text of the compiled PDF around it. ' +
  'Produce two things:\n' +
  '1. "comments": for each equation id, ONE sentence of context — the most likely reason it failed or could not be ' +
  'verified (a dropped term, a sign error, an undefined macro, a non-algebraic/asymptotic step, a definition rather ' +
  'than an identity, etc.), or what the author should check. A hypothesis to guide the human — NOT a correctness verdict.\n' +
  '2. "feedback": 2–4 paragraphs of mathematical feedback on the document as compiled — what the derivations do, ' +
  'where the mathematical risk concentrates, which steps deserve hand-checking, and any structural observations ' +
  '(e.g. assumptions used but not stated). Ground every remark in the equations and rendered text provided. ' +
  'State plainly that machine verdicts come from SymPy and your remarks are commentary. Never declare an equation ' +
  'correct or wrong yourself.\n' +
  'Output ONLY a JSON object {"feedback": string, "comments": [{"id": string, "comment": string}]}. No prose, no fences.';

function buildCommentPrompt(
  blocks: MathAuditBlock[],
  report: MathAuditReport,
  fileText: Map<string, string>,
  macros: Record<string, string>,
  assumptions: string,
  pdf?: PdfContext,
): string {
  const parts: string[] = [];
  const macroList = Object.entries(macros);
  parts.push(macroList.length ? `Macros in force (sample):\n${macroList.slice(0, 40).map(([k, v]) => `${k} = ${v}`).join('\n')}` : 'Macros: (none)');
  if (assumptions.trim()) parts.push(`Assumptions: ${assumptions.trim()}`);
  parts.push(
    `SymPy report over the whole document: ${report.totals.passed} verified, ${report.totals.failing} refuted, ` +
      `${report.totals.unknown} undecided/unparsed (these counts are machine facts).`,
  );
  if (pdf) {
    parts.push(`Compiled PDF: ${pdf.pageCount} pages. Opening of the rendered document:\n${pdf.text.replace(/\s+/g, ' ').trim().slice(0, 1500)}`);
  }
  parts.push('Equations SymPy did not pass (give CONTEXT; do not re-judge correctness):');
  for (const b of blocks) {
    const around = windowAroundLine(fileText.get(b.file) ?? '', b.lineStart, 600).replace(/\s+/g, ' ').trim().slice(0, 450);
    const cx = b.counterexample
      ? ` SymPy counterexample: ${Object.entries(b.counterexample.values).map(([k, v]) => `${k}=${v}`).join(', ')} ⇒ lhs=${b.counterexample.lhsVal}, rhs=${b.counterexample.rhsVal}.`
      : '';
    const rendered = pdf && b.pdfPage ? `\n  Rendered PDF (p.${b.pdfPage}): ${pageText(pdf, b.pdfPage, 500)}` : '';
    parts.push(
      `\n[id ${b.id}] (${b.file}:${b.lineStart}${b.pdfPage ? ` → PDF p.${b.pdfPage}` : ''}) verdict=${b.verdict} (${b.method ?? 'n/a'}).${cx}\n` +
        `  LaTeX: ${b.latex.slice(0, 300)}\n  Source context: ${around}${rendered}`,
    );
  }
  parts.push('\nReturn the JSON object now.');
  return parts.join('\n');
}

interface ParsedCommentary {
  feedback: string;
  comments: DocAuditComment[];
}

function parseCommentary(text: string): ParsedCommentary {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  const empty: ParsedCommentary = { feedback: '', comments: [] };
  if (start === -1 || end === -1 || end < start) return empty;
  let obj: unknown;
  try {
    obj = JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (!obj || typeof obj !== 'object') return empty;
  const o = obj as Record<string, unknown>;
  const comments: DocAuditComment[] = [];
  if (Array.isArray(o.comments)) {
    for (const item of o.comments) {
      if (!item || typeof item !== 'object') continue;
      const c = item as Record<string, unknown>;
      if (typeof c.id === 'string' && typeof c.comment === 'string' && c.comment.trim()) {
        comments.push({ id: c.id, comment: c.comment.trim() });
      }
    }
  }
  return { feedback: typeof o.feedback === 'string' ? o.feedback.trim() : '', comments };
}

/**
 * Verify the algebra across the whole document and give feedback on the maths as
 * COMPILED. SymPy (via the guarded auditMaths) is the sole arbiter of every
 * verdict; the AI reads the rendered PDF + the SymPy report and writes feedback
 * and per-equation context — commentary, never verdicts. Bibliography is never
 * scanned and the maths guard gates every mathcheck call.
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

  // Anchor each equation to its page in the compiled PDF (SyncTeX forward).
  if (deps.locatePage && report.blocks.length > 0) {
    deps.onProgress?.('locating equations in the compiled PDF');
    const toLocate = report.blocks.slice(0, 250);
    for (const b of toLocate) {
      try {
        const page = await deps.locatePage(b.file, b.lineStart);
        if (page && page > 0) b.pdfPage = page;
      } catch {
        /* leave unlocated */
      }
    }
  }

  const candidates = nonPassing(report);
  const maxComment = deps.maxComment ?? 12;
  const toComment = candidates.slice(0, maxComment);

  let comments: DocAuditComment[] = [];
  let feedback = '';
  let commentaryProvided = false;
  if (deps.modelProvider && deps.model && report.blocks.length > 0) {
    deps.onProgress?.(
      deps.pdf
        ? `reading the compiled PDF (${deps.pdf.pageCount} pages) and writing mathematical feedback`
        : `asking the AI for context on ${toComment.length} equation(s)`,
    );
    const fileText = new Map(files.map((f) => [f.path, f.content]));
    const user = buildCommentPrompt(toComment, report, fileText, deps.macros, deps.assumptions, deps.pdf);
    try {
      let text = '';
      for await (const delta of deps.modelProvider.chatStream(
        { system: COMMENT_SYSTEM_PROMPT, messages: [{ role: 'user', content: user }], model: deps.model },
        signal,
      )) {
        text += delta.text;
      }
      const parsed = parseCommentary(text);
      const validIds = new Set(toComment.map((b) => b.id));
      comments = parsed.comments.filter((c) => validIds.has(c.id)); // AI cannot invent ids
      feedback = parsed.feedback;
      commentaryProvided = true;
    } catch {
      // AI commentary is best-effort; SymPy verdicts stand on their own.
      comments = [];
      feedback = '';
      commentaryProvided = false;
    }
  }

  return {
    report,
    comments,
    commentaryProvided,
    commentedCount: toComment.length,
    ...(feedback ? { feedback } : {}),
    pdfScanned: Boolean(deps.pdf),
    ...(deps.pdf ? { pdfPageCount: deps.pdf.pageCount } : {}),
  };
}
