import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { __test } from '../components/editor/latexFold';

const { latexFoldRange } = __test;
const state = (doc: string) => EditorState.create({ doc });
// Fold range for the line containing `marker` (first occurrence).
function foldAt(doc: string, marker: string) {
  const st = state(doc);
  const at = doc.indexOf(marker);
  const line = st.doc.lineAt(at);
  return latexFoldRange(st, line.from);
}
// The folded text (what gets hidden) for readability assertions.
function folded(doc: string, marker: string): string | null {
  const r = foldAt(doc, marker);
  return r ? doc.slice(r.from, r.to) : null;
}

describe('latex fold ranges', () => {
  it('folds a section body up to the next same-or-higher heading', () => {
    const doc = '\\section{A}\nbody a1\nbody a2\n\\section{B}\nbody b\n';
    const hidden = folded(doc, '\\section{A}');
    expect(hidden).toContain('body a1');
    expect(hidden).toContain('body a2');
    expect(hidden).not.toContain('\\section{B}'); // next section stays visible
  });

  it('a subsection folds inside a section; the section fold spans both', () => {
    const doc = '\\section{A}\nintro\n\\subsection{A1}\nsub body\n\\section{B}\n';
    expect(folded(doc, '\\subsection{A1}')).toContain('sub body');
    const sec = folded(doc, '\\section{A}');
    expect(sec).toContain('\\subsection{A1}'); // section spans its subsection
    expect(sec).not.toContain('\\section{B}');
  });

  it('folds a \\begin{env}…\\end{env} body, keeping begin/end visible', () => {
    const doc = '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}\n';
    const hidden = folded(doc, '\\begin{align}');
    expect(hidden).toContain('a &= b');
    expect(hidden).toContain('c &= d');
    expect(hidden).not.toContain('\\end{align}');
    expect(hidden).not.toContain('\\begin{align}');
  });

  it('depth-counts nested same-name environments', () => {
    const doc = '\\begin{itemize}\n\\item x\n\\begin{itemize}\n\\item y\n\\end{itemize}\n\\item z\n\\end{itemize}\n';
    const hidden = folded(doc, '\\begin{itemize}'); // outer
    expect(hidden).toContain('\\item z'); // must reach the OUTER \end, not the inner
    expect(hidden).toContain('\\end{itemize}'); // contains the inner close, not the outer
  });

  it('does not fold an empty / single-line environment', () => {
    expect(foldAt('\\begin{x}\n\\end{x}\n', '\\begin{x}')).toBeNull();
    expect(foldAt('\\begin{x}\\end{x}\n', '\\begin{x}')).toBeNull();
  });

  it('stops a section fold at \\end{document}', () => {
    const doc = '\\section{Last}\ntail\n\\end{document}\n';
    const hidden = folded(doc, '\\section{Last}');
    expect(hidden).toContain('tail');
    expect(hidden).not.toContain('\\end{document}');
  });

  it('returns null on a plain prose line', () => {
    expect(foldAt('just some text\nmore\n', 'just some text')).toBeNull();
  });
});
