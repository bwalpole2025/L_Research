import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@latex-studio/shared';
import { parseLatexLog } from '../src/compile/logParser.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const errors = (d: Diagnostic[]) => d.filter((x) => x.severity === 'error');
const warnings = (d: Diagnostic[]) => d.filter((x) => x.severity === 'warning');
const infos = (d: Diagnostic[]) => d.filter((x) => x.severity === 'info');

describe('parseLatexLog', () => {
  it('success: no errors/warnings, collapses boxes into one info', () => {
    const d = parseLatexLog(fixture('success.log'));
    expect(errors(d)).toHaveLength(0);
    expect(warnings(d)).toHaveLength(0);
    expect(infos(d)).toHaveLength(1);
    expect(infos(d)[0]?.message).toBe('1 over/underfull box warning');
  });

  it('undefined control sequence: one clickable error at main.tex:7', () => {
    const d = parseLatexLog(fixture('undefined-control-sequence.log'));
    const e = errors(d);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: 'main.tex', line: 7 });
    expect(e[0]?.message).toContain('Undefined control sequence');
    // The `! Emergency stop.` summary line must be ignored.
    expect(d.some((x) => x.message.includes('Emergency stop'))).toBe(false);
  });

  it('missing package: file-not-found error at main.tex:2', () => {
    const d = parseLatexLog(fixture('missing-package.log'));
    const e = errors(d);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: 'main.tex', line: 2 });
    expect(e[0]?.message).toContain("File `nonexistent.sty' not found");
  });

  it('syntax error: missing $ at main.tex:10', () => {
    const d = parseLatexLog(fixture('syntax-error.log'));
    const e = errors(d);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: 'main.tex', line: 10 });
    expect(e[0]?.message).toContain('Missing $ inserted');
  });

  it('bib warnings: undefined citation + reference + package warnings, no errors', () => {
    const d = parseLatexLog(fixture('bib-warnings.log'));
    expect(errors(d)).toHaveLength(0);

    const w = warnings(d);
    const citation = w.find((x) => x.message.includes('smith2020'));
    expect(citation).toMatchObject({ file: 'main.tex', line: 12 });

    const reference = w.find((x) => x.message.includes('sec:intro'));
    expect(reference).toMatchObject({ file: 'main.tex', line: 14 });

    const natbib = w.find((x) => x.message.includes('jones2019'));
    expect(natbib?.line).toBe(16);
    expect(natbib?.message).toContain('[natbib]');

    expect(w.some((x) => x.message.includes('There were undefined references'))).toBe(true);

    // The hyperref package warning is captured across its two lines.
    const hyperref = w.find((x) => x.message.includes('breaklinks'));
    expect(hyperref?.line).toBe(5);
    expect(hyperref?.message).toContain('[hyperref]');
  });
});
