import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ContextBundle, ModelProvider, ReviewFinding } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { mathsFindings, spellingFindings } from '../src/review/axes.js';
import { normalizeFindings, parseReviewFindings } from '../src/review/llm.js';
import { clearReviewCache, runReview } from '../src/review/engine.js';
import { buildPopup } from '../src/review/annotate.js';

const MATHCHECK = process.env.MATHCHECK_URL ?? 'http://127.0.0.1:8000';
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

function mockProvider(json: string): ModelProvider {
  return {
    async *chatStream() {
      yield { text: json };
    },
    async complete() {
      return '';
    },
    async editRegion() {
      return '';
    },
  };
}

// ── Axis 1 (SymPy) + axis-4 spelling, deterministic ──────────────────────────

describe('deterministic axes', () => {
  const tex = [
    '\\section{R}',
    'A misspeld word.',
    '\\begin{align}',
    'x &= (y+1)^2 \\\\',
    'x &= y^2 + 2y + 2',
    '\\end{align}',
    '\\[ \\weirdmacro{q} \\]',
  ].join('\n');

  it('maths: planted error → refuted+counterexample; unparseable → unknown; passes omitted', async () => {
    const found = await mathsFindings([{ path: 'a.tex', content: tex }], { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' });
    const refuted = found.find((f) => f.confidence === 'refuted');
    expect(refuted?.axis).toBe('maths');
    expect(refuted?.severity).toBe('error');
    expect(refuted?.counterexample).toBeTruthy();
    expect(found.some((f) => f.confidence === 'unknown')).toBe(true);
    expect(found.every((f) => f.confidence !== 'verified')).toBe(true); // passes are not findings
  }, 30000);

  it('spelling: misspelling → verified-typo (blue)', async () => {
    const found = await spellingFindings([{ path: 'a.tex', content: tex }], []);
    const typo = found.find((f) => f.message.includes('misspeld'));
    expect(typo?.confidence).toBe('verified-typo');
    expect(typo?.axis).toBe('prose');
  }, 30000);
});

// ── LLM proposer: honesty + attribution enforcement (no model needed) ────────

describe('LLM finding normalisation (honesty)', () => {
  const raw = parseReviewFindings(
    JSON.stringify([
      { axis: 'literature', category: 'constant', severity: 'error', fromLine: 4, toLine: 4, message: 'c=3.0 contradicts the source value 2.5', reference: 'cornish2018', quotedSpan: 'value is 2.5' },
      { axis: 'literature', category: 'claim', severity: 'error', fromLine: 9, toLine: 9, message: 'contradicts ghostref', reference: 'ghostref' },
      { axis: 'background', category: 'identity', severity: 'warning', fromLine: 4, toLine: 4, message: 'contradicts sin^2+cos^2=1' },
      { axis: 'prose', category: 'wording', severity: 'info', fromLine: 3, toLine: 3, message: 'awkward' },
    ]),
  );
  const findings = normalizeFindings(raw, 'a.tex', 20, new Set(['cornish2018']));

  it('confidence is fixed by axis (LLM is never the arbiter)', () => {
    const by = (axis: string) => findings.find((f) => f.axis === axis);
    expect(by('literature')?.confidence).toBe('llm-judgement');
    expect(by('background')?.confidence).toBe('llm-judgement-low');
    expect(by('prose')?.confidence).toBe('llm-suggestion');
  });

  it('a literature claim citing a NON-provided source becomes attribution-unverified, never a contradiction', () => {
    const ghost = findings.find((f) => f.reference === 'ghostref' || /ghostref/.test(f.message));
    expect(ghost?.category).toBe('attribution-unverified');
    expect(ghost?.severity).toBe('info');
    expect(ghost?.message).toMatch(/attribution unverified/i);
    // the full-text one keeps the contradiction + quoted span
    const real = findings.find((f) => f.reference === 'cornish2018');
    expect(real?.category).toBe('constant');
    expect(real?.quotedSpan).toBe('value is 2.5');
  });
});

describe('buildPopup', () => {
  it('states the confidence in words and includes the counterexample', () => {
    const f: ReviewFinding = {
      id: 'x', axis: 'maths', category: 'algebra', severity: 'error', confidence: 'refuted', file: 'a.tex',
      lineSpan: { fromLine: 1, toLine: 1 }, message: 'wrong', counterexample: { values: { y: 1 }, lhsVal: 4, rhsVal: 5 },
    };
    const popup = buildPopup(f, false);
    expect(popup).toMatch(/SymPy-verified algebra error/);
    expect(popup).toMatch(/counterexample/i);
  });
});

// ── Engine: compose axes, deterministic-only stops the LLM ───────────────────

describe('runReview composition (mock LLM + live SymPy)', () => {
  const bundle: ContextBundle = {
    macros: {}, assumptions: '', documentWindow: '', intent: 'next-step', anchors: {},
    references: [{ key: 'cornish2018', provenance: 'full-text', passages: ['the value is 2.5'], sourceFile: 'cornish2018.tex' }],
  };
  const texFiles = [{ path: 'a.tex', content: 'A misspeld word.\n\\begin{align}\nx &= (y+1)^2 \\\\\nx &= y^2 + 2y + 2\n\\end{align}\n' }];
  const llmJson = JSON.stringify([{ axis: 'background', category: 'id', severity: 'warning', fromLine: 1, toLine: 1, message: 'contradicts a known identity' }]);

  it('composes maths + spelling + LLM axes', async () => {
    clearReviewCache();
    const { findings, aiError } = await runReview({
      texFiles, bundle, customWords: [], mathcheckUrl: MATHCHECK, modelProvider: mockProvider(llmJson), model: 'mock', deterministicOnly: false,
    });
    expect(aiError).toBeNull();
    expect(findings.some((f) => f.axis === 'maths' && f.confidence === 'refuted')).toBe(true);
    expect(findings.some((f) => f.confidence === 'verified-typo')).toBe(true);
    expect(findings.some((f) => f.axis === 'background')).toBe(true);
  }, 30000);

  it('deterministicOnly stops all model calls', async () => {
    clearReviewCache();
    let called = false;
    const spy: ModelProvider = { async *chatStream() { called = true; yield { text: '[]' }; }, async complete() { return ''; }, async editRegion() { return ''; } };
    const { findings } = await runReview({
      texFiles, bundle, customWords: [], mathcheckUrl: MATHCHECK, modelProvider: spy, model: 'mock', deterministicOnly: true,
    });
    expect(called).toBe(false);
    expect(findings.every((f) => f.confidence === 'verified-typo' || f.confidence === 'refuted' || f.confidence === 'unknown')).toBe(true);
  }, 30000);
});

// ── Full pipeline: compile → review → annotated PDF (texlive + PyMuPDF) ───────

describe('POST /projects/:id/review (compile → coords → annotated PDF)', () => {
  let app: FastifyInstance;
  let projectId: string;
  const doc = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\section{Results}',
    'The constant is reported as $c = 3$ here.',
    '\\begin{align}',
    'x &= (y+1)^2 \\\\',
    'x &= y^2 + 2y + 2',
    '\\end{align}',
    'A misspeld word here.',
    'We cite the constant from \\cite{cornish2018} and \\cite{ghostref}.',
    '\\end{document}',
  ].join('\n');
  const llmJson = JSON.stringify([
    { axis: 'literature', category: 'constant', severity: 'error', fromLine: 4, toLine: 4, message: 'The constant 3 contradicts the value in the source.', reference: 'cornish2018', quotedSpan: 'the value is 2.5' },
    { axis: 'literature', category: 'claim', severity: 'warning', fromLine: 10, toLine: 10, message: 'contradicts ghostref', reference: 'ghostref' },
    { axis: 'background', category: 'identity', severity: 'warning', fromLine: 4, toLine: 4, message: 'This contradicts a standard identity.' },
    { axis: 'prose', category: 'wording', severity: 'info', fromLine: 3, toLine: 3, message: 'Awkward section title.' },
  ]);

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: mockProvider(llmJson) });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `review ${Date.now()}` } });
    projectId = p.json().id;
    const main = (await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth }).then((r) => r.json() as Array<{ id: string; path: string }>)).find((f) => f.path === 'main.tex')!;
    await app.inject({ method: 'PATCH', url: `/files/${main.id}`, headers: auth, payload: { content: doc } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'cornish2018.tex', content: 'We report the constant value 2.5 for the experiment.' } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'refs.bib', content: '@article{cornish2018, title={Constant measurement}, year={2018}}' } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/compile`, headers: auth, payload: {} });
    clearReviewCache();
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('produces findings across all four axes and writes an annotated review PDF', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/review`, headers: auth, payload: { scope: 'project' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { findings: ReviewFinding[]; annotated: boolean; reviewPdfUrl?: string; totals: { refutedMaths: number } };

    // (i) algebra error: red, refuted, counterexample.
    const maths = body.findings.find((f) => f.axis === 'maths' && f.confidence === 'refuted');
    expect(maths?.counterexample).toBeTruthy();
    expect(body.totals.refutedMaths).toBeGreaterThanOrEqual(1);
    // (iv) spelling: blue verified-typo.
    expect(body.findings.some((f) => f.confidence === 'verified-typo')).toBe(true);
    // (ii) literature against an in-project source: orange, names ref + quoted span.
    const lit = body.findings.find((f) => f.reference === 'cornish2018');
    expect(lit?.confidence).toBe('llm-judgement');
    expect(lit?.quotedSpan).toBeTruthy();
    // attribution unverified for the absent reference.
    expect(body.findings.some((f) => f.category === 'attribution-unverified')).toBe(true);
    // (iii) background: purple low-confidence.
    expect(body.findings.some((f) => f.confidence === 'llm-judgement-low')).toBe(true);

    // Annotated review PDF written + served.
    expect(body.annotated).toBe(true);
    expect(body.reviewPdfUrl).toBeTruthy();
    const pdf = await app.inject({ method: 'GET', url: `/projects/${projectId}/review-pdf`, headers: auth });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.length).toBeGreaterThan(1000);
  }, 90000);
});
