import { describe, expect, it } from 'vitest';
import { latexToBlocks } from '../components/editor/visualBlocks';
import { domToLatex, inlineToHtml } from '../components/editor/VisualView';

const DOC = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Setup}',
  'First paragraph with $a^2$ inline',
  'continuing on a second line.',
  '',
  '\\begin{align}',
  'x &= y \\\\',
  'z &= w',
  '\\end{align}',
  '\\begin{itemize}',
  '\\item one',
  '\\item two',
  '\\end{itemize}',
  '\\begin{figure}[h]',
  '\\includegraphics{figs/plot.png}',
  '\\caption{A plot}',
  '\\end{figure}',
  '\\end{document}',
].join('\n');

describe('latexToBlocks — structure with write-back line ranges', () => {
  const blocks = latexToBlocks(DOC);

  it('heading carries its command and exact line', () => {
    const h = blocks.find((b) => b.kind === 'heading');
    expect(h).toMatchObject({ kind: 'heading', text: 'Setup', line: 3, endLine: 3, cmd: 'section' });
  });

  it('multi-line paragraph spans its source lines', () => {
    const p = blocks.find((b) => b.kind === 'para');
    expect(p).toMatchObject({ kind: 'para', line: 4, endLine: 5 });
    expect((p as { text: string }).text).toContain('continuing');
  });

  it('math env keeps its env name and full range', () => {
    const m = blocks.find((b) => b.kind === 'math');
    expect(m).toMatchObject({ kind: 'math', env: 'align', line: 7, endLine: 10 });
    expect((m as { latex: string }).latex).toContain('x &= y');
  });

  it('list items carry per-item lines; figure has path + caption', () => {
    const l = blocks.find((b) => b.kind === 'list') as Extract<ReturnType<typeof latexToBlocks>[number], { kind: 'list' }>;
    expect(l.items.map((i) => i.line)).toEqual([12, 13]);
    const f = blocks.find((b) => b.kind === 'figure');
    expect(f).toMatchObject({ kind: 'figure', path: 'figs/plot.png', caption: 'A plot' });
  });
});

describe('inlineToHtml ⇄ domToLatex — LaTeX survives the editable DOM round-trip', () => {
  const roundTrip = (src: string): string => {
    const el = document.createElement('div');
    el.innerHTML = inlineToHtml(src);
    return domToLatex(el);
  };

  it('plain text, inline maths, cites, refs, bold/emph, unknown commands — verbatim', () => {
    for (const src of [
      'Plain prose only.',
      'Euler: $e^{i\\pi} = -1$ holds.',
      'As shown by \\citep{basset1888} earlier.',
      'See \\eqref{eq:euler} for details.',
      'Some \\textbf{bold} and \\emph{emphasised} words.',
      'A custom \\Bo macro and \\textcolor{red}{note}.',
    ]) {
      expect(roundTrip(src)).toBe(src);
    }
  });

  it('edits to surrounding text preserve chips exactly', () => {
    const el = document.createElement('div');
    el.innerHTML = inlineToHtml('Before $a+b$ after \\citep{key}.');
    // Simulate the user editing the leading text node.
    el.childNodes[0]!.textContent = 'REWRITTEN ';
    expect(domToLatex(el)).toBe('REWRITTEN $a+b$ after \\citep{key}.');
  });

  it('edits inside a styled wrapper keep the command', () => {
    const el = document.createElement('div');
    el.innerHTML = inlineToHtml('A \\textbf{bold} word.');
    const strong = el.querySelector('strong')!;
    strong.textContent = 'bolder';
    expect(domToLatex(el)).toBe('A \\textbf{bolder} word.');
  });
});

describe('semi-compiled rendering support', () => {
  it('parses standalone tikzpicture and figure-wrapped tikz as diagram blocks', () => {
    const doc = [
      '\\begin{document}',
      '\\begin{tikzpicture}',
      '\\draw (0,0) -- (1,1);',
      '\\end{tikzpicture}',
      '\\begin{figure}[h]',
      '\\begin{tikzpicture}\\draw (0,0) circle (1);\\end{tikzpicture}',
      '\\caption{A circle}',
      '\\end{figure}',
      '\\end{document}',
    ].join('\n');
    const blocks = latexToBlocks(doc);
    const tikz = blocks.filter((b) => b.kind === 'tikz');
    expect(tikz).toHaveLength(2);
    expect((tikz[0] as { latex: string }).latex).toContain('\\draw (0,0) -- (1,1);');
    expect((tikz[1] as { caption: string }).caption).toBe('A circle');
  });

  it('normalises macro bodies for KaTeX (\\ensuremath unwrapped, \\mbox → \\text)', async () => {
    const { normalizeKatexBody } = await import('../components/editor/mathPreview');
    expect(normalizeKatexBody('\\ensuremath{\\partial}')).toBe('\\partial');
    expect(normalizeKatexBody('\\mbox{Bo}\\xspace')).toBe('\\text{Bo}');
  });
});

describe('latexAroundCaret — the ghost context split (chips verbatim, ghost excluded)', () => {
  async function splitAt(html: string, place: (root: HTMLElement) => { node: Node; offset: number }) {
    const { latexAroundCaret } = await import('../components/editor/visualGhost');
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    const { node, offset } = place(el);
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    const out = latexAroundCaret(el);
    el.remove();
    return out;
  }

  it('splits plain text at the caret', async () => {
    const out = await splitAt('hello world', (el) => ({ node: el.firstChild!, offset: 5 }));
    expect(out).toEqual({ before: 'hello', after: ' world' });
  });

  it('keeps maths chips verbatim on the correct side', async () => {
    const out = await splitAt(
      'sum <span data-tex="$a+b$" contenteditable="false">ab</span> end',
      (el) => ({ node: el.lastChild!, offset: 2 }),
    );
    expect(out!.before).toBe('sum $a+b$ e');
    expect(out!.after).toBe('nd');
  });

  it('a wrapper opens on the before side and closes on the after side around the caret', async () => {
    const out = await splitAt('A <strong data-wrap="textbf">bold</strong> B', (el) => {
      const strong = el.querySelector('strong')!;
      return { node: strong.firstChild!, offset: 2 };
    });
    expect(out!.before).toBe('A \\textbf{bo');
    expect(out!.after).toBe('ld} B');
  });

  it('NEVER includes the ghost span itself', async () => {
    const out = await splitAt(
      'typed<span data-ghost contenteditable="false" class="vv-ghost"> suggested rest</span> tail',
      (el) => ({ node: el.firstChild!, offset: 5 }),
    );
    expect(out!.before).toBe('typed');
    expect(out!.after).toBe(' tail');
  });
});

describe('visual autocomplete — pure helpers', () => {
  it('strips tab-stop placeholders and finds the caret brace', async () => {
    const { stripPlaceholders, caretAfterInsert } = await import('../components/editor/visualAutocomplete');
    expect(stripPlaceholders('frac{${}}{${}}')).toBe('frac{}{}');
    expect(stripPlaceholders('alpha')).toBe('alpha');
    expect(caretAfterInsert('\\frac{}{}')).toBe('\\frac{'.length); // inside the first {}
    expect(caretAfterInsert('\\alpha')).toBe('\\alpha'.length);
  });

  it('ranks prefix matches above substring matches and never includes non-matches', async () => {
    const { filterAndRank } = await import('../components/editor/visualAutocomplete');
    const opts = [
      { label: '\\section', detail: '', insert: '\\section{}' },
      { label: '\\subsection', detail: '', insert: '\\subsection{}' },
      { label: '\\alpha', detail: '', insert: '\\alpha' },
    ];
    const ranked = filterAndRank(opts, 'sec');
    expect(ranked.map((o) => o.label)).toEqual(['\\section', '\\subsection']); // prefix beats substring; alpha excluded
  });
});
