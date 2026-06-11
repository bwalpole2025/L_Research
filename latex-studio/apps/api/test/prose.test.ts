import { describe, expect, it } from 'vitest';
import { stripLatex } from '../src/prose/strip.js';
import { DEFAULT_PROSE_RULES, checkProse } from '../src/prose/check.js';

const wrap = (body: string): string => `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`;

describe('stripLatex', () => {
  it('drops math, commands, comments, and cite args while keeping prose', () => {
    const src = wrap('The divergence $\\nabla \\cdot \\vb{u}$ is zero \\cite{cornish2018}. Teh end. % a comment word');
    const pm = stripLatex(src);
    expect(pm.prose).toContain('divergence');
    expect(pm.prose).toContain('Teh'); // misspelling preserved
    expect(pm.prose).not.toContain('nabla'); // math stripped
    expect(pm.prose).not.toContain('vb'); // macro inside math stripped
    expect(pm.prose).not.toContain('cornish'); // cite key stripped
    expect(pm.prose).not.toContain('comment'); // comment stripped
    expect(pm.prose).not.toContain('documentclass'); // preamble stripped
  });

  it('keeps the argument of a formatting command', () => {
    const pm = stripLatex(wrap('A \\textbf{bold mispeld word} here.'));
    expect(pm.prose).toContain('mispeld');
  });
});

describe('checkProse — LaTeX-aware, en-GB, fully local', () => {
  const rules = DEFAULT_PROSE_RULES;

  it('flags a misspelled English word but nothing on the maths, macro, or cite key', async () => {
    const files = [
      { path: 'a.tex', content: wrap('The result $\\nabla \\cdot \\vb{u} = 0$ follows \\cite{cornish2018}. This sentance is wrong.') },
    ];
    const report = await checkProse(files, { rules, customWords: [] });
    expect(report.diagnostics.map((d) => d.word)).toContain('sentance');
    expect(report.diagnostics.some((d) => /cornish|nabla|cdot|\bvb\b/i.test(`${d.word ?? ''} ${d.message}`))).toBe(false);
  }, 30000);

  it('stops flagging a term once it is in the custom dictionary', async () => {
    const content = wrap('We study a ferrofluid using the KdV equation.');
    const r1 = await checkProse([{ path: 'a.tex', content }], { rules, customWords: [] });
    expect(r1.diagnostics.some((d) => d.word === 'ferrofluid')).toBe(true);

    const r2 = await checkProse([{ path: 'a.tex', content }], { rules, customWords: ['ferrofluid', 'KdV'] });
    expect(r2.diagnostics.some((d) => d.word === 'ferrofluid')).toBe(false);
    expect(r2.diagnostics.some((d) => d.word === 'KdV')).toBe(false);
  }, 30000);

  it('enforces en-GB: "color" is flagged, "colour" is not', async () => {
    const r = await checkProse([{ path: 'a.tex', content: wrap('The color is red. The colour is blue.') }], {
      rules,
      customWords: [],
    });
    const flagged = r.diagnostics.map((d) => d.word);
    expect(flagged).toContain('color');
    expect(flagged).not.toContain('colour');
  }, 30000);

  it('runs a fully local engine — no external grammar service', async () => {
    const r = await checkProse([{ path: 'a.tex', content: wrap('Hello world.') }], { rules, customWords: [] });
    expect(r.engine.local).toBe(true);
    expect(r.engine.grammar).toBeNull();
    expect(r.engine.spelling).toContain('nspell');
  }, 30000);
});
