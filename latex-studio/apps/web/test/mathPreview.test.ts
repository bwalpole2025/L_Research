import { describe, expect, it } from 'vitest';
import { cleanForKatex, inlineEqnTags, mathSpanAt, renderPreview } from '../components/editor/mathPreview';

const DOC = [
  'Some prose here.', // 0-16
  '\\begin{equation}\\label{eq:euler}',
  'e^{i\\pi} = -1',
  '\\end{equation}',
  'Inline $a^2 + b^2$ and more prose.',
  '\\[ x = y \\]',
  'Inline paren \\(c+d\\) too.',
].join('\n');

const posOf = (needle: string) => DOC.indexOf(needle) + 2;

describe('mathSpanAt — locating the maths construct at the cursor', () => {
  it('finds a display environment and returns its inner LaTeX', () => {
    const span = mathSpanAt(DOC, posOf('e^{i\\pi}'));
    expect(span).toBeTruthy();
    expect(span!.display).toBe(true);
    expect(span!.latex).toContain('e^{i\\pi} = -1');
  });

  it('finds inline $…$ on the cursor line', () => {
    const span = mathSpanAt(DOC, posOf('a^2'));
    expect(span).toBeTruthy();
    expect(span!.display).toBe(false);
    expect(span!.latex).toBe('a^2 + b^2');
  });

  it('finds \\[…\\] and \\(…\\)', () => {
    expect(mathSpanAt(DOC, posOf('x = y'))!.display).toBe(true);
    expect(mathSpanAt(DOC, posOf('c+d'))!.latex).toBe('c+d');
  });

  it('returns null in prose (no preview outside maths)', () => {
    expect(mathSpanAt(DOC, 4)).toBeNull();
    expect(mathSpanAt(DOC, DOC.indexOf('more prose') + 2)).toBeNull();
  });
});

describe('cleanForKatex + renderPreview', () => {
  it('strips labels/spacing and renders KaTeX HTML with project macros', () => {
    expect(cleanForKatex('x = 1 \\label{eq:a} \\nonumber \\vspace{2em}')).toBe('x = 1');
    const el = renderPreview('\\frac{a}{b} + \\sqrt{c}', true);
    expect(el.querySelector('.katex')).toBeTruthy(); // really rendered
  });

  it('never throws on bad input (best-effort rendering)', () => {
    const el = renderPreview('\\thisisnotacommand{', false);
    expect(el).toBeTruthy(); // no exception; KaTeX renders best-effort or fallback text
  });

  it('wraps &/\\\\ rows so align bodies render', () => {
    const el = renderPreview('x &= y \\\\ z &= w', true);
    expect(el.querySelector('.katex')).toBeTruthy();
  });

  it('equation tags become a content-tight annotation (\\tag{1} → && (1)), rendering in aligned', () => {
    expect(inlineEqnTags('E &= mc^2 \\tag{1} \\\\ F &= ma \\tag{2}')).toBe('E &= mc^2  && (1) \\\\ F &= ma  && (2)');
    expect(inlineEqnTags('x = y \\tag*{$\\ast$}')).toBe('x = y  && \\ast'); // star = no parens, $ stripped
    // A tagged align body renders with no thrown KaTeX error (the tag shows).
    const el = renderPreview('E &= mc^2 \\tag{1} \\\\ F &= ma \\tag{2}', true);
    expect(el.querySelector('.katex')).toBeTruthy();
  });
});
