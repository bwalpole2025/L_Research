import type { MathCounterexample } from '../types';

/** Strip a LaTeX align/equation line down to its math content. */
export function mathContent(line: string): string | null {
  let t = line.trim();
  if (!t || /^\\(begin|end)\b/.test(t)) return null;
  t = t
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/\\\\\*?(?:\s*\[[^\]]*\])?/g, '')
    .replace(/&/g, '')
    .trim();
  return t.length > 0 ? t : null;
}

/** The right-hand side of an equation line ("x &= 2y" → "2y"), or null. */
export function rhsOf(line: string): string | null {
  const content = mathContent(line);
  if (!content) return null;
  const eq = content.indexOf('=');
  if (eq === -1) return null;
  const rhs = content.slice(eq + 1).trim();
  return rhs.length > 0 ? rhs : null;
}

export function formatCounterexample(c: MathCounterexample): string {
  const vals = Object.entries(c.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}${c.lhsVal} ≠ ${c.rhsVal}`;
}
