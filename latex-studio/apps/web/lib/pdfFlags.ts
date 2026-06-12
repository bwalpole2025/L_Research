import type { Diagnostic, MathAuditBlock } from '@latex-studio/shared';

/**
 * PDF ISSUE HIGHLIGHTS — persistent overlays in the compiled PDF marking
 * everything that isn't right: ORANGE for important compile warnings,
 * YELLOW for minor ones (boxes etc.), VIOLET for equations the co-derive
 * verified maths checker (LLM proposes · SymPy verifies) could not pass.
 * Red never appears here: red strictly means "no PDF came out", so there is
 * nothing to highlight — the panel and pill own that state.
 *
 * Source locations (file:line) are mapped to PDF rectangles through SyncTeX
 * forward search; the pure candidate selection lives here so it is testable
 * without the network.
 */

export interface PdfFlagCandidate {
  severity: 'warning-important' | 'warning-minor' | 'checker';
  message: string;
  file: string;
  line: number;
}

export interface PdfFlag extends PdfFlagCandidate {
  id: string;
  source: 'compile' | 'checker';
  page: number;
  /** PDF points, top-left origin (SyncTeX box). */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** SyncTeX forward searches are one CLI run each — cap the fan-out. */
export const MAX_PDF_FLAGS = 60;

/** Orange/yellow diagnostics that point at a real source line, deduped by
 *  file:line (the first message wins — it is the highest-tier one, since
 *  diagnostics arrive tier-sorted). */
export function compileFlagCandidates(diagnostics: Diagnostic[]): PdfFlagCandidate[] {
  const seen = new Set<string>();
  const out: PdfFlagCandidate[] = [];
  for (const d of diagnostics) {
    if (d.severity !== 'warning-important' && d.severity !== 'warning-minor') continue;
    if (!d.file || !d.line) continue;
    const key = `${d.file}:${d.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ severity: d.severity, message: d.message, file: d.file, line: d.line });
    if (out.length >= MAX_PDF_FLAGS) break;
  }
  return out;
}

/** Audit blocks the verified checker could not pass — failing AND unknown
 *  (an unverifiable step needs eyes too). */
export function checkerFlagCandidates(blocks: MathAuditBlock[]): PdfFlagCandidate[] {
  const out: PdfFlagCandidate[] = [];
  for (const b of blocks) {
    if (b.verdict === 'passed') continue;
    if (!b.file || !b.lineStart) continue;
    const what = b.verdict === 'failing' ? 'failing' : 'unverified';
    out.push({
      severity: 'checker',
      message: `Maths checker (${what}): ${b.message ?? b.latex.slice(0, 120)}`,
      file: b.file,
      line: b.lineStart,
    });
    if (out.length >= MAX_PDF_FLAGS) break;
  }
  return out;
}
