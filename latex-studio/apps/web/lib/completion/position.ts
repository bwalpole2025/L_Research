import type { EditorView } from '@codemirror/view';

const MATH_OPEN = /\\begin\{(?:align|equation|gather|multline|eqnarray|flalign|alignat)\*?\}/g;
const MATH_CLOSE = /\\end\{(?:align|equation|gather|multline|eqnarray|flalign|alignat)\*?\}/g;

/** A short description of where the cursor sits, to shape document-aware prediction. */
export function computePosition(view: EditorView): string | undefined {
  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const before = doc.sliceString(Math.max(0, pos - 6000), pos);

  const absOpen = before.lastIndexOf('\\begin{abstract}');
  if (absOpen !== -1 && absOpen > before.lastIndexOf('\\end{abstract}')) return 'in the abstract';

  const proof = doc.sliceString(Math.max(0, pos - 200), pos);
  if (/\\begin\{proof\}\s*$/.test(proof)) return 'just after \\begin{proof}';

  const opens = (before.match(MATH_OPEN) ?? []).length;
  const closes = (before.match(MATH_CLOSE) ?? []).length;
  if (opens > closes) return 'mid-derivation, inside a display-math environment';

  // Start of a section: nearest non-empty line above is a heading.
  const line = doc.lineAt(pos);
  for (let n = line.number; n >= Math.max(1, line.number - 3); n--) {
    const t = doc.line(n).text.trim();
    if (n === line.number && t.length > 2) break;
    if (t && /^\\(?:sub)*section\*?\s*\{/.test(t)) return 'at the start of a section';
    if (t && n < line.number) break;
  }
  return undefined;
}
