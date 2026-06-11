import type { CoderiveAnchorRange, CoderiveIntent } from '@latex-studio/shared';
import { bareMath, extractMathBlocks } from '../audit/extract.js';

export interface ResolvedAnchors {
  from?: string;
  to?: string;
  goal?: string;
  fromLine: number;
  toLine?: number;
}

/** Structural / preamble LaTeX commands — never a mathematical anchor. */
const STRUCTURAL_CMD =
  /^\\(usepackage|RequirePackage|documentclass|begin|end|section|subsection|subsubsection|chapter|part|paragraph|input|include|newcommand|renewcommand|providecommand|def|DeclareMathOperator|label|ref|eqref|cref|Cref|pageref|cite\w*|parencite|textcite|bibliography\w*|addbibresource|title|author|date|maketitle|tableofcontents|newpage|clearpage|usetikzlibrary|hypersetup|setlength|pagestyle|thispagestyle|bibliographystyle|caption|footnote|item|hline|centering|noindent)\b/;

/** Heuristic: does this anchor look like a mathematical expression (vs LaTeX structure)? */
export function looksLikeMath(expr: string | undefined): boolean {
  if (!expr) return false;
  const e = expr.trim();
  if (!e) return false;
  if (STRUCTURAL_CMD.test(e)) return false;
  // A bare word / prose line with no math operators, braces, or LaTeX command is unlikely to be math.
  return /[=+\-*/^_\\{}<>]|\\[a-zA-Z]+|[0-9]/.test(e) || e.length <= 24;
}

/** The display-math expression at (or nearest above) a 1-based line, else the bare line. */
export function exprAtLine(content: string, line: number): string | undefined {
  const blocks = extractMathBlocks('anchor', content);
  let best: { latex: string; line: number } | undefined;
  for (const b of blocks) {
    for (const s of b.steps) {
      if (s.line === line) return bareMath(s.latex);
      if (s.line <= line && (!best || s.line > best.line)) best = s;
    }
  }
  if (best && best.line >= line - 2) return bareMath(best.latex);
  const raw = content.split('\n')[line - 1];
  if (raw && bareMath(raw)) return bareMath(raw);
  return best ? bareMath(best.latex) : undefined;
}

export function resolveAnchors(
  content: string,
  intent: CoderiveIntent,
  range: CoderiveAnchorRange,
  target?: string,
): ResolvedAnchors {
  const anchors: ResolvedAnchors = { fromLine: range.fromLine };
  const from = exprAtLine(content, range.fromLine);
  if (from !== undefined) anchors.from = from;
  if ((intent === 'fill-gap' || intent === 'justify') && range.toLine) {
    anchors.toLine = range.toLine;
    const to = exprAtLine(content, range.toLine);
    if (to !== undefined) anchors.to = to;
  }
  if (intent === 'reach-goal' && target) {
    const goal = bareMath(target);
    if (goal) anchors.goal = goal;
  }
  return anchors;
}
