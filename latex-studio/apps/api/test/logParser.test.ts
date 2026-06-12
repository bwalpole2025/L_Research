import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '@latex-studio/shared';
import { parseLatexLog } from '../src/compile/logParser.js';
import { OVERFULL_IMPORTANT_PT } from '../src/compile/severityTable.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

const errors = (d: Diagnostic[]) => d.filter((x) => x.severity === 'error');
const important = (d: Diagnostic[]) => d.filter((x) => x.severity === 'warning-important');
const minor = (d: Diagnostic[]) => d.filter((x) => x.severity === 'warning-minor');

describe('parseLatexLog — structure', () => {
  it('success: no errors, the small overfull collapses into ONE minor grouped entry', () => {
    const d = parseLatexLog(fixture('success.log'));
    expect(errors(d)).toHaveLength(0);
    expect(important(d)).toHaveLength(0);
    const boxes = minor(d).filter((x) => x.category === 'overfull-box');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ count: 1, line: 8 });
  });

  it('undefined control sequence: one clickable RED error at main.tex:7 with a raw excerpt', () => {
    const d = parseLatexLog(fixture('undefined-control-sequence.log'));
    const e = errors(d);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: 'main.tex', line: 7, category: 'undefined-control-sequence' });
    expect(e[0]?.message).toContain('Undefined control sequence');
    expect(e[0]?.rawExcerpt).toContain('Undefined control sequence');
    expect(d.some((x) => x.message.includes('Emergency stop'))).toBe(false);
  });

  it('errors sort before orange before yellow', () => {
    const d = parseLatexLog([fixture('logs/overfull-minor.log'), fixture('logs/rerun-needed.log'), fixture('syntax-error.log')].join('\n'));
    const tiers = d.map((x) => x.severity);
    const firstOrange = tiers.indexOf('warning-important');
    const firstYellow = tiers.indexOf('warning-minor');
    expect(tiers[0]).toBe('error');
    expect(firstOrange).toBeGreaterThan(0);
    expect(firstYellow).toBeGreaterThan(firstOrange);
  });
});

describe('SEVERITY TAXONOMY — each fixture lands in the documented tier with file:line', () => {
  it('hard error (Missing $): RED at main.tex:10', () => {
    const e = errors(parseLatexLog(fixture('syntax-error.log')));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: 'main.tex', line: 10, category: 'missing-math' });
  });

  it('missing package (.sty not found): RED at main.tex:2', () => {
    const e = errors(parseLatexLog(fixture('missing-package.log')));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ file: 'main.tex', line: 2, category: 'missing-file' });
  });

  it('runaway argument: RED, line recovered from l.NN', () => {
    const d = parseLatexLog(fixture('logs/runaway-argument.log'));
    const e = errors(d);
    expect(e.length).toBeGreaterThanOrEqual(1);
    expect(e[0]?.line).toBe(22);
    expect(e[0]?.file).toBe('main.tex');
    expect(e[0]?.rawExcerpt).toContain('l.22');
  });

  it('undefined reference & citation: ORANGE with file:line', () => {
    const d = parseLatexLog(fixture('bib-warnings.log'));
    expect(errors(d)).toHaveLength(0);
    const w = important(d);
    expect(w.find((x) => x.message.includes('smith2020'))).toMatchObject({ file: 'main.tex', line: 12, category: 'undefined-citation' });
    expect(w.find((x) => x.message.includes('sec:intro'))).toMatchObject({ file: 'main.tex', line: 14, category: 'undefined-reference' });
    expect(w.find((x) => x.message.includes('jones2019'))?.message).toContain('[natbib]');
    expect(w.some((x) => x.category === 'undefined-references-summary')).toBe(true);
    // hyperref package notice is YELLOW (cosmetic), not orange.
    const hyperref = minor(d).find((x) => x.message.includes('breaklinks'));
    expect(hyperref).toBeDefined();
    expect(hyperref?.line).toBe(5);
  });

  it('rerun-needed (labels may have changed): ORANGE with rerunHint', () => {
    const d = parseLatexLog(fixture('logs/rerun-needed.log'));
    const rerun = d.find((x) => x.category === 'labels-changed-rerun');
    expect(rerun).toMatchObject({ severity: 'warning-important', rerunHint: true });
    expect(d.find((x) => x.category === 'undefined-references-summary')?.severity).toBe('warning-important');
  });

  it('multiply-defined labels: ORANGE', () => {
    const d = parseLatexLog(fixture('logs/multiply-defined.log'));
    const m = d.filter((x) => x.category === 'multiply-defined-label');
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m.every((x) => x.severity === 'warning-important')).toBe(true);
  });

  it(`overfull \\hbox by 0.5pt: YELLOW (within tolerance, threshold ${OVERFULL_IMPORTANT_PT}pt)`, () => {
    const d = parseLatexLog(fixture('logs/overfull-minor.log'));
    const box = d.find((x) => x.category === 'overfull-box');
    expect(box).toMatchObject({ severity: 'warning-minor', line: 12, count: 1 });
  });

  it('badly overfull boxes (page overflow): ORANGE, grouped with count + worst measure', () => {
    const d = parseLatexLog(fixture('logs/overfull-severe.log'));
    const box = d.find((x) => x.category === 'overfull-box-severe');
    expect(box).toMatchObject({ severity: 'warning-important', count: 2, line: 30 });
    expect(box?.message).toContain('145.4');
  });

  it('underfull boxes: YELLOW, grouped', () => {
    const d = parseLatexLog(fixture('logs/underfull.log'));
    const box = d.find((x) => x.category === 'underfull-box');
    expect(box).toMatchObject({ severity: 'warning-minor', count: 2, line: 5 });
    expect(errors(d)).toHaveLength(0);
    expect(important(d)).toHaveLength(0);
  });

  it('dropped glyphs / undefined font shape: ORANGE', () => {
    const d = parseLatexLog(fixture('logs/missing-character.log'));
    expect(d.find((x) => x.message.includes('Font shape'))?.severity).toBe('warning-important');
  });

  it('float placement + marginpar moved: YELLOW', () => {
    const d = parseLatexLog(fixture('logs/float-marginpar.log'));
    expect(d.find((x) => x.category === 'float-placement')?.severity).toBe('warning-minor');
    expect(d.find((x) => x.category === 'marginpar-moved')?.severity).toBe('warning-minor');
    expect(important(d)).toHaveLength(0);
  });
});
