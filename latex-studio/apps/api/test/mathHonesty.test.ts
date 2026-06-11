import { describe, expect, it, beforeEach } from 'vitest';
import { extractMathBlocks, hasMatrixConstruct } from '../src/audit/extract.js';
import { auditMaths, clearAuditCache } from '../src/audit/service.js';
import { collectMacros } from '../src/docmodel/build.js';

const MATHCHECK = process.env.MATHCHECK_URL ?? 'http://127.0.0.1:8000';

// A Jacobian matrix + a piecewise definition inside an align — the constructs that
// used to be torn into rows and falsely refuted.
const MATRIX_DOC = [
  '\\begin{align}',
  '    \\mathsfbi{J}=\\left( \\begin{array}{ccc}',
  '       \\cos\\theta & -\\frac{\\sin\\theta}{r} & 0 \\\\',
  '        -\\sin\\theta & -\\frac{\\cos\\theta}{r} & 0 \\\\',
  '        a & b & 1',
  '   \\end{array}  \\right), \\label{1.9b}',
  '\\end{align}',
].join('\n');

describe('extractor keeps matrices/piecewise whole (never torn into rows)', () => {
  it('a matrix-bearing align yields ONE step flagged kind:matrix, not one per row', () => {
    const blocks = extractMathBlocks('main.tex', MATRIX_DOC);
    const steps = blocks.flatMap((b) => b.steps);
    expect(steps.length).toBe(1);
    expect(steps[0]!.kind).toBe('matrix');
    expect(hasMatrixConstruct(steps[0]!.latex)).toBe(true);
  });

  it('a genuine align chain still splits into its rows', () => {
    const chain = '\\begin{align}\ny &= (x+1)^2 \\\\\ny &= x^2 + 2x + 1\n\\end{align}';
    const steps = extractMathBlocks('main.tex', chain).flatMap((b) => b.steps);
    expect(steps.length).toBe(2);
    expect(steps.every((s) => s.kind === undefined)).toBe(true);
  });
});

describe('collectMacros expands & normalises class-file macros', () => {
  it('\\newcommand\\p{\\ensuremath{\\partial}} → \\p = \\partial (no \\ensuremath)', () => {
    const m = collectMacros([{ path: 'jfm.cls', content: '\\newcommand\\p{\\ensuremath{\\partial}}' }], {});
    expect(m['\\p']).toBe('\\partial');
  });
});

describe('auditMaths verdict honesty (live SymPy)', () => {
  beforeEach(() => clearAuditCache());

  it('a matrix is SKIPPED (never refuted), with an honest reason', async () => {
    const report = await auditMaths([{ path: 'main.tex', content: MATRIX_DOC }], { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' });
    expect(report.totals.failing).toBe(0);
    expect(report.blocks.every((b) => b.method === 'matrix-or-piecewise')).toBe(true);
  }, 30000);

  it('a standalone DEFINITION (sides not equal) is unknown, NOT a ✗', async () => {
    const def = '\\begin{equation}\nx = r\\cos\\theta\n\\end{equation}';
    const report = await auditMaths([{ path: 'main.tex', content: def }], { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' });
    expect(report.totals.failing).toBe(0);
    const block = report.blocks[0]!;
    expect(block.verdict).toBe('unknown');
    expect(block.method).toBe('not-an-identity');
  }, 30000);

  it('a domain / inequality line is skipped as not-an-identity', async () => {
    const dom = '\\begin{equation}\n0 \\leq \\theta \\leq \\pi\n\\end{equation}';
    const report = await auditMaths([{ path: 'main.tex', content: dom }], { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' });
    expect(report.totals.failing).toBe(0);
    expect(report.blocks[0]!.method).toBe('not-an-identity');
  }, 30000);

  it('a true standalone identity passes; a WRONG derivation chain step is the only ✗', async () => {
    const good = '\\begin{equation}\n(x+1)^2 = x^2 + 2x + 1\n\\end{equation}';
    const goodReport = await auditMaths([{ path: 'g.tex', content: good }], { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' });
    expect(goodReport.blocks[0]!.verdict).toBe('passed');

    const badChain = '\\begin{align}\nq &= (x+1)^2 \\\\\nq &= x^2 + 2x + 2\n\\end{align}';
    const badReport = await auditMaths([{ path: 'b.tex', content: badChain }], { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' });
    expect(badReport.totals.failing).toBe(1);
    expect(badReport.blocks.find((b) => b.verdict === 'failing')?.counterexample).toBeTruthy();
  }, 45000);
});
