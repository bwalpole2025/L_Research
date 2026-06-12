import type { DiagnosticSeverity } from '@latex-studio/shared';

/**
 * THE SEVERITY TAXONOMY — Overleaf-style three-tier classification of LaTeX
 * log entries, maintained as ONE documented table (fixtures in
 * test/fixtures/logs + logParser tests assert every row).
 *
 *  ERROR (red)               the run produced NO PDF. A `!` line classifies as
 *                            an error here, but the compile service demotes it
 *                            to ORANGE when the run still emitted a fresh PDF
 *                            (nonstop mode often recovers) — red strictly means
 *                            "nothing came out to look at".
 *  WARNING-IMPORTANT (orange) compiles, but the OUTPUT IS WRONG and misleads:
 *                            ?? references, [?] citations, duplicated labels,
 *                            page-overflowing boxes, dropped glyphs.
 *  WARNING-MINOR (yellow)    compiles, output essentially fine: under/overfull
 *                            within tolerance, float placement, package notices.
 *  INFO (grey)               purely informational chatter.
 *
 * When unsure, prefer the LOWER alarm (yellow over orange, orange over red) —
 * the catch-all rows at the bottom of each table encode that.
 */

export interface SeverityRule {
  /** Stable category key carried on the diagnostic. */
  category: string;
  severity: DiagnosticSeverity;
  /** Tested against the cleaned message text. First match wins (ordered). */
  test: RegExp;
  /** A rerun (not an edit) would likely resolve it. */
  rerunHint?: boolean;
}

/** Tier-1 table: `!` / file:line ERRORS. Category refinement only — every
 *  entry here is red by definition; the catch-all keeps unknown errors red. */
export const ERROR_RULES: SeverityRule[] = [
  { category: 'undefined-control-sequence', severity: 'error', test: /Undefined control sequence/i },
  { category: 'missing-math', severity: 'error', test: /Missing \$ inserted/i },
  { category: 'missing-begin-document', severity: 'error', test: /Missing \\begin\{document\}/i },
  { category: 'missing-delimiter', severity: 'error', test: /Missing (?:\\right|\\end|[{}] inserted)/i },
  { category: 'runaway-argument', severity: 'error', test: /Runaway argument/i },
  { category: 'emergency-stop', severity: 'error', test: /Emergency stop|==> Fatal error/i },
  { category: 'missing-file', severity: 'error', test: /File `[^']+' not found/i },
  { category: 'undefined-environment', severity: 'error', test: /Environment .+ undefined/i },
  { category: 'undefined-color', severity: 'error', test: /Undefined color/i },
  { category: 'capacity-exceeded', severity: 'error', test: /TeX capacity exceeded/i },
  { category: 'package-error', severity: 'error', test: /^(?:\[?[\w-]+\]? )?(?:Package|Class) [\w-]+ Error|LaTeX Error/i },
  { category: 'error', severity: 'error', test: /./ }, // catch-all: a `!` is always red
];

/** Tier-2/3 table: WARNINGS. Orange = output is visibly wrong; yellow =
 *  cosmetic. The catch-all keeps unknown warnings yellow (lower alarm). */
export const WARNING_RULES: SeverityRule[] = [
  // ORANGE — wrong output (?? / [?] / dropped glyphs / duplicated targets)
  { category: 'undefined-reference', severity: 'warning-important', test: /Reference `[^']+' .*undefined/i },
  { category: 'undefined-citation', severity: 'warning-important', test: /Citation [`'"]?[^'" ]+[`'"]? .*undefined/i },
  { category: 'labels-changed-rerun', severity: 'warning-important', test: /Label\(s\) may have changed/i, rerunHint: true },
  { category: 'rerun-needed', severity: 'warning-important', test: /Rerun to get|rerun (?:LaTeX|to)/i, rerunHint: true },
  { category: 'multiply-defined-label', severity: 'warning-important', test: /multiply[- ]defined|There were multiply-defined labels/i },
  { category: 'undefined-references-summary', severity: 'warning-important', test: /There were undefined (?:references|citations)/i },
  { category: 'duplicate-bibitem', severity: 'warning-important', test: /(?:duplicate|repeated) (?:entry|\\bibitem)|\\bibitem.*(?:duplicate|repeated)/i },
  { category: 'font-unavailable', severity: 'warning-important', test: /Font shape .+ undefined|Some font shapes were not available|No file .*\.fd/i },
  { category: 'missing-character', severity: 'warning-important', test: /Missing character/i },

  // YELLOW — cosmetic / typesetting
  { category: 'float-placement', severity: 'warning-minor', test: /float specifier changed|Float too large|`!?h' float/i },
  { category: 'marginpar-moved', severity: 'warning-minor', test: /marginpar on page .+ moved/i },
  { category: 'warning', severity: 'warning-minor', test: /./ }, // catch-all: unsure → lower alarm
];

/** An Overfull box deeper than this protrudes visibly into the margin /
 *  overflows the page → orange. At or below it (e.g. 0.5pt) → yellow. */
export const OVERFULL_IMPORTANT_PT = 30;

export function classifyError(message: string): SeverityRule {
  return ERROR_RULES.find((r) => r.test.test(message)) ?? ERROR_RULES[ERROR_RULES.length - 1]!;
}

export function classifyWarning(message: string): SeverityRule {
  return WARNING_RULES.find((r) => r.test.test(message)) ?? WARNING_RULES[WARNING_RULES.length - 1]!;
}

/** Box warnings are classified by kind + measured overflow, not by table. */
export function classifyBox(kind: 'overfull' | 'underfull', pt: number | null): { category: string; severity: DiagnosticSeverity } {
  if (kind === 'underfull') return { category: 'underfull-box', severity: 'warning-minor' };
  if (pt !== null && pt > OVERFULL_IMPORTANT_PT) return { category: 'overfull-box-severe', severity: 'warning-important' };
  return { category: 'overfull-box', severity: 'warning-minor' };
}
