export interface MathStep {
  latex: string;
  line: number;
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

function isContentLine(text: string): boolean {
  let t = text.trim();
  if (!t) return false;
  if (/^\\(?:begin|end)\b/.test(t)) return false;
  t = t
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/\\\\\*?/g, '')
    .replace(/&/g, '')
    .trim();
  return t.length > 0;
}

function stripBreak(text: string): string {
  return text.replace(/\\\\\*?(?:\s*\[[^\]]*\])?\s*$/, '').trim();
}

/** Math content of a step with alignment/labels removed, for equation splitting. */
export function bareMath(text: string): string {
  return stripBreak(text)
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\tag\s*\*?\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
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

function collectSteps(inner: string, innerStartOffset: number, lineStarts: number[]): MathStep[] {
  const steps: MathStep[] = [];
  const lines = inner.split('\n');
  let off = innerStartOffset;
  for (const line of lines) {
    if (isContentLine(line)) {
      steps.push({ latex: stripBreak(line.trim()), line: offsetToLine(lineStarts, off) });
    }
    off += line.length + 1;
  }
  return steps;
}

/** Extract every display-math block (env or \[..\]) with line spans + steps. */
export function extractMathBlocks(file: string, content: string): MathBlock[] {
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
