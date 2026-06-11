import type { ReviewFinding } from '@latex-studio/shared';
import { auditMaths, type AuditInputFile } from '../audit/service.js';
import { checkProse, type ProseInputFile } from '../prose/check.js';

export interface MathsAxisOpts {
  mathcheckUrl: string;
  macros: Record<string, string>;
  assumptions: string;
}

/** Axis 1 — algebra. SymPy verdicts only. Passes are NOT findings. */
export async function mathsFindings(files: AuditInputFile[], opts: MathsAxisOpts): Promise<ReviewFinding[]> {
  const report = await auditMaths(files, opts);
  return report.blocks.flatMap((b) => {
    if (b.verdict === 'passed') return [];
    const refuted = b.verdict === 'failing';
    const finding: ReviewFinding = {
      id: `maths:${b.id}`,
      axis: 'maths',
      category: 'algebra',
      severity: refuted ? 'error' : 'info',
      confidence: refuted ? 'refuted' : 'unknown',
      file: b.file,
      lineSpan: { fromLine: b.lineStart, toLine: b.lineEnd },
      message: refuted
        ? `Algebra error: this step is not algebraically equal to the previous one (SymPy: ${b.method}).`
        : `SymPy could not parse or decide this equation (${b.method}) — reported as unknown, not as a pass.`,
    };
    if (b.counterexample) finding.counterexample = b.counterexample;
    return [finding];
  });
}

/** Axis 4 (deterministic part) — en-GB spelling only. Reliable; "verified-typo". */
export async function spellingFindings(files: ProseInputFile[], customWords: string[]): Promise<ReviewFinding[]> {
  const report = await checkProse(files, {
    rules: { spelling: true, enGbConsistency: false, hyphenation: false, doubleSpace: false, quotes: false, languageTool: false },
    customWords,
  });
  return report.diagnostics
    .filter((d) => d.rule === 'spelling')
    .map((d, i) => {
      const finding: ReviewFinding = {
        id: `spell:${d.file}:${d.line}:${d.column}:${i}`,
        axis: 'prose',
        category: 'spelling',
        severity: 'warning',
        confidence: 'verified-typo',
        file: d.file,
        lineSpan: { fromLine: d.line, toLine: d.line },
        message: d.message,
      };
      if (d.suggestions[0]) finding.suggestion = d.suggestions[0];
      return finding;
    });
}
