import { describe, expect, it } from 'vitest';
import { detectAcContext } from '../components/editor/latexAutocomplete';
import { extractBibEntries, extractEnvs, extractLabels, extractMacros, extractPackages } from '../lib/latexIndex';
import { CLASSES, COMMANDS, ENVIRONMENTS, PACKAGES, PACKAGE_COMMANDS, WORD_SNIPPETS } from '../components/editor/latexData';

describe('detectAcContext — each source fires ONLY in its context', () => {
  const at = (before: string) => detectAcContext(before, 100);

  it('backslash command prefix', () => {
    expect(at('text \\inc')).toEqual({ kind: 'command', query: 'inc', from: 100 + 5 });
    expect(at('\\')).toEqual({ kind: 'command', query: '', from: 100 });
  });

  it('includegraphics (with and without optional arg) → graphics', () => {
    expect(at('\\includegraphics{fi')?.kind).toBe('graphics');
    expect(at('\\includegraphics[width=0.8\\textwidth]{')?.kind).toBe('graphics');
  });

  it('input/include → input', () => {
    expect(at('\\input{chap')?.kind).toBe('input');
    expect(at('\\include{')?.kind).toBe('input');
  });

  it('cite family → cite, completing after the last comma', () => {
    expect(at('\\cite{')?.kind).toBe('cite');
    expect(at('\\citep{a1')?.kind).toBe('cite');
    const multi = at('\\citet{first2020, sec');
    expect(multi?.kind).toBe('cite');
    expect(multi?.query).toBe('sec'); // multiple comma-separated keys supported
    expect(at('\\autocite{x')?.kind).toBe('cite');
  });

  it('ref family → ref', () => {
    for (const c of ['ref', 'eqref', 'pageref', 'cref']) expect(at(`\\${c}{eq`)?.kind).toBe('ref');
  });

  it('begin/end → environments; usepackage/documentclass → packages', () => {
    expect(at('\\begin{ali')?.kind).toBe('begin');
    expect(at('\\end{')?.kind).toBe('end');
    expect(at('\\usepackage{gra')?.kind).toBe('usepackage');
    expect(at('\\documentclass{art')?.kind).toBe('documentclass');
  });

  it('label → label; plain prose → nothing', () => {
    expect(at('\\label{')?.kind).toBe('label');
    expect(at('plain prose here')).toBeNull();
    expect(at('ends with backslash-backslash \\\\')).toBeNull(); // a line break, not a command
  });

  it('NO cross-context leakage: a cite context is not graphics, etc.', () => {
    expect(at('\\cite{')?.kind).not.toBe('graphics');
    expect(at('\\includegraphics{')?.kind).not.toBe('cite');
    expect(at('\\begin{')?.kind).not.toBe('ref');
  });
});

describe('index parsers (deterministic, offline)', () => {
  it('extracts \\newcommand/\\def/\\DeclareMathOperator macros with bodies', () => {
    const src = '\\newcommand{\\Bo}{\\mathrm{Bo}}\n\\def\\pd{\\partial}\n\\DeclareMathOperator{\\sech}{sech}';
    const macros = extractMacros('main.tex', src);
    expect(macros.map((m) => m.name)).toEqual(['Bo', 'pd', 'sech']);
    expect(macros[0]!.body).toContain('\\mathrm{Bo}');
  });

  it('extracts labels with heading/equation context', () => {
    const src = '\\section{Setup}\nx\n\\begin{equation}\\label{eq:euler}\ne\n\\end{equation}\n\\label{sec:setup}';
    const labels = extractLabels('main.tex', src);
    expect(labels.map((l) => l.name)).toEqual(['eq:euler', 'sec:setup']);
    expect(labels[0]!.context).toContain('equation');
    expect(labels[0]!.context).toContain('Setup');
  });

  it('extracts custom environments and loaded packages', () => {
    expect(extractEnvs('\\newenvironment{prop}{..}{..}\n\\newtheorem{thm}{Theorem}')).toEqual(['prop', 'thm']);
    expect(extractPackages('\\usepackage[utf8]{inputenc}\n\\usepackage{amsmath, graphicx}')).toEqual([
      'inputenc',
      'amsmath',
      'graphicx',
    ]);
  });

  it('extracts bib entries with author/year/title (and skips @string)', () => {
    const bib =
      '@string{x = {y}}\n@article{cornish2018,\n  author = {Cornish, A. and Brown, B.},\n  title = {Multiple scales},\n  year = {2018}\n}';
    const entries = extractBibEntries(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ key: 'cornish2018', year: '2018', title: 'Multiple scales' });
    expect(entries[0]!.author).toContain('Cornish');
  });
});

describe('static data integrity', () => {
  it('every command has a detail; snippets contain tab stops', () => {
    for (const c of COMMANDS) {
      expect(c.detail.length).toBeGreaterThan(0);
      if (c.snippet) expect(c.snippet).toContain('${');
    }
    for (const list of Object.values(PACKAGE_COMMANDS)) for (const c of list) expect(c.detail.length).toBeGreaterThan(0);
  });

  it('tab stops are empty — no placeholder words left in the document on Tab-past', () => {
    // Only real defaults worth keeping as-is may pre-fill a stop (see the
    // latexData.ts header). Descriptive words (num, den, key, caption, …) would
    // be inserted literally and become junk the user has to delete.
    const ALLOWED_DEFAULTS = new Set(['', 'htbp', '0.8', '0.9', 'lcc']);
    const check = (template: string): void => {
      for (const m of template.matchAll(/\$\{([^}]*)\}/g)) {
        expect(ALLOWED_DEFAULTS.has(m[1]!), `placeholder "\${${m[1]}}" in ${JSON.stringify(template)}`).toBe(true);
      }
    };
    for (const c of COMMANDS) if (c.snippet) check(c.snippet);
    for (const list of Object.values(PACKAGE_COMMANDS)) for (const c of list) if (c.snippet) check(c.snippet);
    for (const s of WORD_SNIPPETS) check(s.template);
  });

  it('info doc strings are prose, not pseudo-templates like \\frac{numerator}{denominator}', () => {
    // A {word} in the info panel reads as "this junk will be inserted".
    for (const c of [...COMMANDS, ...Object.values(PACKAGE_COMMANDS).flat()]) {
      if (c.info) expect(c.info, `info of \\${c.name}`).not.toMatch(/\{[a-z…]+\}/i);
    }
  });

  it('the snippet set covers the required templates, each with ≥1 placeholder', () => {
    const labels = WORD_SNIPPETS.map((s) => s.label);
    for (const required of ['figure', 'table', 'equation', 'align', 'gather', 'multline', 'itemize', 'enumerate', 'theorem', 'lemma', 'proof']) {
      expect(labels).toContain(required);
    }
    for (const s of WORD_SNIPPETS) expect(s.template).toContain('${');
    // align respects & alignment and \\ row breaks.
    const align = WORD_SNIPPETS.find((s) => s.label === 'align')!;
    expect(align.template).toContain('&=');
    expect(align.template).toContain('\\\\');
  });

  it('environment/package/class lists carry descriptions', () => {
    for (const e of [...ENVIRONMENTS, ...PACKAGES, ...CLASSES]) expect(e.detail.length).toBeGreaterThan(0);
  });
});
