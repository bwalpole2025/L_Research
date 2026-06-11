import type { CompletionMode } from '../types';

export interface ModeInfo {
  mode: CompletionMode;
  inComment: boolean;
  midWord: boolean;
}

const DISPLAY_ENV =
  /\\(begin|end)\{(align\*?|aligned|gather\*?|gathered|multline\*?|eqnarray\*?|equation\*?|flalign\*?|split|dmath\*?)\}/g;

/**
 * Heuristic mode detection around the cursor. The editor uses the legacy stream
 * `stex` mode (no Lezer tree), so we read the surrounding text directly
 * (ADR-006): preamble vs display-align vs inline-math vs prose.
 */
export function detectMode(doc: string, pos: number): ModeInfo {
  const p = Math.max(0, Math.min(doc.length, pos));
  const before = doc.slice(0, p);
  const after = doc.slice(p);
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineBefore = before.slice(lineStart);

  const charBefore = before.slice(-1);
  const charAfter = after.slice(0, 1);
  const midWord = /\w/.test(charBefore) && /\w/.test(charAfter);
  const inComment = hasUnescapedPercent(lineBefore);

  const docBegin = doc.indexOf('\\begin{document}');
  if (docBegin === -1 || p <= docBegin) {
    return { mode: 'preamble', inComment, midWord };
  }
  if (insideDisplayEnv(doc, p)) {
    return { mode: 'display-align', inComment, midWord };
  }
  if (inInlineMath(before)) {
    return { mode: 'inline-math', inComment, midWord };
  }
  return { mode: 'prose', inComment, midWord };
}

function hasUnescapedPercent(line: string): boolean {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) return true;
  }
  return false;
}

function insideDisplayEnv(doc: string, pos: number): boolean {
  const re = new RegExp(DISPLAY_ENV);
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    if (m.index >= pos) break;
    if (m[1] === 'begin') depth += 1;
    else depth = Math.max(0, depth - 1);
  }
  // Also count \[ ... \] display math.
  const open = countUnescaped(doc.slice(0, pos), '\\[');
  const close = countUnescaped(doc.slice(0, pos), '\\]');
  return depth > 0 || open > close;
}

function countUnescaped(s: string, token: string): number {
  let count = 0;
  let i = s.indexOf(token);
  while (i !== -1) {
    count += 1;
    i = s.indexOf(token, i + token.length);
  }
  return count;
}

function inInlineMath(before: string): boolean {
  const open = (before.match(/\\\(/g) ?? []).length;
  const close = (before.match(/\\\)/g) ?? []).length;
  if (open > close) return true;
  let count = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === '$' && before[i - 1] !== '\\') {
      if (before[i + 1] === '$') {
        i += 1; // skip $$ (display)
        continue;
      }
      count += 1;
    }
  }
  return count % 2 === 1;
}
