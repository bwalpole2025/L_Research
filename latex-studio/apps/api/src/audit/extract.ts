export interface MathStep {
  latex: string;
  line: number;
  /** 'matrix' = contains a matrix/array/cases/piecewise construct: NOT a scalar
   *  identity, so it must never be split into rows or refuted — only skipped. */
  kind?: 'matrix';
}

export interface MathBlock {
  file: string;
  env: string;
  startLine: number;
  endLine: number;
  steps: MathStep[];
}

const DISPLAY_ENVS = [
  'equation',
  'align',
  'gather',
  'multline',
  'displaymath',
  'eqnarray',
  'flalign',
  'alignat',
  'aligned',
  'dmath',
];

/** A row has math content once labels, breaks, alignment and whitespace are removed. */
function rowHasContent(text: string): boolean {
  const t = text
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/\\\\\*?/g, '')
    .replace(/[&\s]/g, '');
  return t.length > 0;
}

function stripBreak(text: string): string {
  return text.replace(/\\\\\*?(?:\s*\[[^\]]*\])?\s*$/, '').trim();
}

// A nested matrix / array / cases / piecewise construct. Content containing one of
// these is not a scalar identity and must never be torn into rows or refuted.
const MATRIX_CONSTRUCT_RE =
  /\\begin\s*\{(?:array|[bBpvV]?matrix|smallmatrix|cases|subarray|gathered)\}|\\left\s*\\?\{|\\(?:cases|substack)\b/;

export function hasMatrixConstruct(text: string): boolean {
  return MATRIX_CONSTRUCT_RE.test(text);
}

/** Math content of a step with alignment/labels/spacing/text removed, for splitting. */
export function bareMath(text: string): string {
  return stripBreak(text)
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\tag\s*\*?\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    // Unwrap \ensuremath{X} → X (macro bodies like \p = \ensuremath{\partial}).
    .replace(/\\ensuremath\s*\{([^{}]*)\}/g, '$1')
    // Drop typeset-text runs that are prose, not maths: \mbox{for } / \text{…}.
    .replace(/\\(?:mbox|text|textrm|textsf|textit|textbf|hbox)\s*\{[^{}]*\}/g, ' ')
    // Drop spacing commands that carry no mathematical meaning.
    .replace(/\\(?:vspace|hspace)\s*\*?\s*\{[^{}]*\}/g, '')
    .replace(/\\(?:quad|qquad|,|;|!|:|>)(?![a-zA-Z])/g, ' ')
    .replace(/&/g, '')
    .trim();
}

/** Split a single equation on its top-level relation `=`, or null. */
export function splitEquation(latex: string): { lhs: string; rhs: string } | null {
  const s = bareMath(latex);
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '=' && depth === 0) {
      const prev = s[i - 1];
      const next = s[i + 1];
      // skip <= >= == != := and \neq-style by checking neighbours
      if (prev && '<>=!:'.includes(prev)) continue;
      if (next === '=') continue;
      const lhs = s.slice(0, i).trim();
      const rhs = s.slice(i + 1).trim();
      if (lhs && rhs) return { lhs, rhs };
      return null;
    }
  }
  return null;
}

function lineStartsOf(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) if (content[i] === '\n') starts.push(i + 1);
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1; // 1-based
}

/**
 * Split a display block's inner LaTeX into steps on TOP-LEVEL `\\` row breaks —
 * i.e. `\\` that are NOT inside braces or a nested environment (array, matrix,
 * cases, …). This keeps a matrix or piecewise definition together as ONE step
 * instead of shredding it into rows and comparing its cells as bogus identities.
 * A step containing such a construct is flagged kind:'matrix' so the auditor
 * skips it rather than ever refuting it.
 */
function collectSteps(inner: string, innerStartOffset: number, lineStarts: number[]): MathStep[] {
  const steps: MathStep[] = [];
  let depth = 0; // brace depth
  let envDepth = 0; // nested \begin..\end depth
  let start = 0;

  const flush = (endIdx: number): void => {
    const raw = inner.slice(start, endIdx);
    if (rowHasContent(raw)) {
      const lead = raw.length - raw.trimStart().length;
      const off = innerStartOffset + start + lead;
      const step: MathStep = { latex: stripBreak(raw.trim()), line: offsetToLine(lineStarts, off) };
      if (hasMatrixConstruct(raw)) step.kind = 'matrix';
      steps.push(step);
    }
  };

  let i = 0;
  while (i < inner.length) {
    if (inner.startsWith('\\begin{', i)) {
      envDepth += 1;
      i += 7;
      continue;
    }
    if (inner.startsWith('\\end{', i)) {
      envDepth = Math.max(0, envDepth - 1);
      i += 5;
      continue;
    }
    if (inner[i] === '\\' && inner[i + 1] === '\\') {
      if (depth === 0 && envDepth === 0) {
        flush(i);
        i += 2;
        start = i;
        continue;
      }
      i += 2;
      continue;
    }
    const c = inner[i];
    if (c === '{') depth += 1;
    else if (c === '}') depth = Math.max(0, depth - 1);
    i += 1;
  }
  flush(inner.length);
  return steps;
}

/** Replace a region with spaces, keeping newlines, so offsets/line numbers survive. */
function blank(content: string, from: number, to: number): string {
  const region = content.slice(from, to).replace(/[^\n]/g, ' ');
  return content.slice(0, from) + region + content.slice(to);
}

const BIB_ENV_RE = /\\begin\{(thebibliography|filecontents\*?)\}[\s\S]*?\\end\{\1\}/g;
const BIB_ENTRY_HEAD_RE = /@\s*[a-zA-Z]+\s*\{/g;

/**
 * Blank out bibliography content — thebibliography / filecontents environments
 * and raw BibTeX `@entry{…}` blocks — so the math scanner can never emit
 * `key = {value}` lines as expressions. Offsets are preserved.
 */
export function stripBibliographyRegions(content: string): string {
  let out = content;
  let m: RegExpExecArray | null;
  BIB_ENV_RE.lastIndex = 0;
  while ((m = BIB_ENV_RE.exec(out)) !== null) {
    out = blank(out, m.index, m.index + m[0].length);
  }
  // BibTeX entries: from `@type{` to the brace-balanced close.
  BIB_ENTRY_HEAD_RE.lastIndex = 0;
  while ((m = BIB_ENTRY_HEAD_RE.exec(out)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < out.length && depth > 0) {
      if (out[i] === '{') depth += 1;
      else if (out[i] === '}') depth -= 1;
      i += 1;
    }
    out = blank(out, m.index, i);
    BIB_ENTRY_HEAD_RE.lastIndex = m.index;
  }
  return out;
}

/** Files that are bibliography data — never scanned for maths. */
export function isBibliographyFile(path: string): boolean {
  return /\.(bib|bst)$/i.test(path);
}

/** Extract every display-math block (env or \[..\]) with line spans + steps. */
export function extractMathBlocks(file: string, content: string): MathBlock[] {
  if (isBibliographyFile(file)) return [];
  content = stripBibliographyRegions(content);
  const lineStarts = lineStartsOf(content);
  const blocks: MathBlock[] = [];

  const envRe = new RegExp(
    `(\\\\begin\\{(${DISPLAY_ENVS.join('|')})\\*?\\})([\\s\\S]*?)(\\\\end\\{\\2\\*?\\})`,
    'g',
  );
  let m: RegExpExecArray | null;
  while ((m = envRe.exec(content)) !== null) {
    const begin = m[1] ?? '';
    const env = m[2] ?? 'display';
    const inner = m[3] ?? '';
    const innerStart = m.index + begin.length;
    blocks.push({
      file,
      env,
      startLine: offsetToLine(lineStarts, m.index),
      endLine: offsetToLine(lineStarts, m.index + m[0].length - 1),
      steps: collectSteps(inner, innerStart, lineStarts),
    });
  }

  const dispRe = /(\\\[)([\s\S]*?)(\\\])/g;
  while ((m = dispRe.exec(content)) !== null) {
    const inner = m[2] ?? '';
    const innerStart = m.index + 2;
    blocks.push({
      file,
      env: 'display',
      startLine: offsetToLine(lineStarts, m.index),
      endLine: offsetToLine(lineStarts, m.index + m[0].length - 1),
      steps: collectSteps(inner, innerStart, lineStarts),
    });
  }

  return blocks.sort((a, b) => a.startLine - b.startLine);
}
