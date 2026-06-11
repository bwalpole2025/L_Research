import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ContextBundle, ModelProvider } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { extractPdfText } from '../src/coderive/pdf.js';
import { buildUserPrompt, parseProposals } from '../src/coderive/propose.js';
import { parseBib } from '../src/coderive/bib.js';
import { buildReferences, clearReferenceCache } from '../src/coderive/references.js';
import { exprAtLine, looksLikeMath, type ResolvedAnchors } from '../src/coderive/anchors.js';
import { runCoderive } from '../src/coderive/engine.js';

const MATHCHECK = process.env.MATHCHECK_URL ?? 'http://127.0.0.1:8000';
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

/** A mock ModelProvider that yields scripted JSON proposals, one per call. */
function mockProvider(responses: string[]): ModelProvider {
  let i = 0;
  return {
    async *chatStream() {
      const r = responses[Math.min(i, responses.length - 1)] ?? '[]';
      i += 1;
      yield { text: r };
    },
    async complete() {
      return '';
    },
    async editRegion() {
      return '';
    },
  };
}

const j = (arr: unknown): string => JSON.stringify(arr);
const cand = (latex: string, extra: Record<string, unknown> = {}) => ({
  latex,
  claimedEqualTo: '(x+1)^2',
  technique: 'expand',
  groundedIn: [],
  rationale: 'r',
  ...extra,
});

// ── Pure units ───────────────────────────────────────────────────────────────

describe('parseProposals', () => {
  it('extracts a JSON array, tolerating fences and prose', () => {
    const out = parseProposals('Sure:\n```json\n[{"latex":"x^2","claimedEqualTo":"x \\cdot x","technique":"sq","groundedIn":[],"rationale":"r"}]\n```');
    expect(out).toHaveLength(1);
    expect(out[0]!.latex).toBe('x^2');
  });
  it('returns [] when there is no array', () => {
    expect(parseProposals('I cannot help with that.')).toEqual([]);
  });
});

describe('parseBib', () => {
  it('parses entry fields', () => {
    const m = parseBib('@article{cornish2018, author = {A. Cornish}, title = {Multiple scales}, year = {2018}, abstract = {We expand.}}');
    const e = m.get('cornish2018');
    expect(e?.title).toBe('Multiple scales');
    expect(e?.year).toBe('2018');
    expect(e?.abstract).toBe('We expand.');
  });
});

describe('looksLikeMath (anchor guard)', () => {
  it('rejects structural / preamble LaTeX, accepts expressions', () => {
    expect(looksLikeMath('\\usepackage{tikz}')).toBe(false);
    expect(looksLikeMath('\\section{Introduction}')).toBe(false);
    expect(looksLikeMath('\\documentclass{article}')).toBe(false);
    expect(looksLikeMath('')).toBe(false);
    expect(looksLikeMath('x^2 + 2x + 1')).toBe(true);
    expect(looksLikeMath('\\nabla \\cdot \\vb{u} = 0')).toBe(true);
  });
});

describe('exprAtLine', () => {
  it('reads the display-math step at a line', () => {
    const content = 'text\n\\begin{align}\ny &= (x+1)^2 \\\\\ny &= x^2 + 2x + 1\n\\end{align}\n';
    expect(exprAtLine(content, 3)).toContain('(x+1)^2');
    expect(exprAtLine(content, 4)).toContain('x^2 + 2x + 1');
  });
});

describe('buildReferences — provenance grading', () => {
  it('full-text when a source file matches the key; metadata-only / not-found otherwise', async () => {
    clearReferenceCache();
    const files = [
      { path: 'refs.bib', encoding: 'utf8', content: '@article{cornish2018, title={Multiple scales expansion}, year={2018}, abstract={a}}\n@book{nobody2000, title={Other work}, year={2000}}' },
      { path: 'cornish2018.tex', encoding: 'utf8', content: '\\section{Method}\nThe multiple scales method introduces slow and fast variables for the asymptotic expansion of the solution.' },
    ];
    const refs = await buildReferences(['cornish2018', 'nobody2000', 'ghostkey'], files, 'multiple scales expansion method');
    const byKey = Object.fromEntries(refs.map((r) => [r.key, r]));
    expect(byKey['cornish2018']!.provenance).toBe('full-text');
    expect((byKey['cornish2018']!.passages ?? []).length).toBeGreaterThan(0);
    expect(byKey['nobody2000']!.provenance).toBe('metadata-only');
    expect(byKey['ghostkey']!.provenance).toBe('not-found');
  });
});

describe('PDF reference extraction (local, no network)', () => {
  const PDF_B64 = readFileSync(fileURLToPath(new URL('./fixtures/cornish2018.pdf.b64', import.meta.url)), 'utf8').trim();

  it('extracts text from a project PDF and grades the reference full-text with passages', async () => {
    expect(await extractPdfText(PDF_B64)).toMatch(/multiple scales/i);

    clearReferenceCache();
    const refs = await buildReferences(
      ['cornish2018'],
      [
        { path: 'refs.bib', encoding: 'utf8', content: '@article{cornish2018, title={Multiple scales}, year={2018}}' },
        { path: 'refs/cornish2018.pdf', encoding: 'base64', content: PDF_B64 },
      ],
      'multiple scales method asymptotic expansion',
    );
    expect(refs[0]!.provenance).toBe('full-text');
    expect(refs[0]!.sourceFile).toBe('refs/cornish2018.pdf');
    expect((refs[0]!.passages ?? []).join(' ')).toMatch(/multiple scales/i);
  }, 30000);
});

// ── The seam: mock LLM PROPOSES, live SymPy VERIFIES ─────────────────────────

describe('co-derivation seam (mock LLM + live SymPy)', () => {
  const anchors: ResolvedAnchors = { fromLine: 2, toLine: 3, from: '(x+1)^2', to: 'x^2 + 2x + 1' };
  const bundle = (): ContextBundle => ({
    macros: {},
    assumptions: '',
    documentWindow: 'We expand the square.',
    references: [],
    intent: 'fill-gap',
    anchors: { from: '(x+1)^2', to: 'x^2 + 2x + 1' },
  });
  const deps = (provider: ModelProvider) => ({ modelProvider: provider, mathcheckUrl: MATHCHECK, model: 'mock' });

  it('verifies the true intermediate (✓), retriesUsed 0', async () => {
    const res = await runCoderive(bundle(), anchors, deps(mockProvider([j([cand('x^2 + 2x + 1')])])));
    expect(res.candidates[0]!.status).toBe('verified');
    expect(res.candidates[0]!.retriesUsed).toBe(0);
  }, 30000);

  it('catches a wrong intermediate and corrects on retry (round 1 ✗ → round 2 ✓)', async () => {
    const res = await runCoderive(
      bundle(),
      anchors,
      deps(mockProvider([j([cand('x^2 + 2x + 2')]), j([cand('x^2 + 2x + 1')])])),
    );
    expect(res.candidates[0]!.status).toBe('verified');
    expect(res.candidates[0]!.retriesUsed).toBe(1);
    expect(res.rounds[0]!.verdicts[0]!.status).toBe('unverified');
    expect(res.rounds[1]!.verdicts[0]!.status).toBe('verified');
  }, 45000);

  it('NEVER marks a persistently wrong intermediate ✓ — 3 rounds → ✗ with counterexample', async () => {
    const res = await runCoderive(bundle(), anchors, deps(mockProvider([j([cand('x^2 + 2x + 2')])])));
    expect(res.candidates.every((c) => c.status !== 'verified')).toBe(true);
    expect(res.candidates[0]!.status).toBe('unverified');
    expect(res.candidates[0]!.counterexample).toBeTruthy();
    expect(res.rounds).toHaveLength(3);
  }, 60000);

  it('returns "unknown" (never verified) for unparseable notation', async () => {
    const res = await runCoderive(bundle(), anchors, deps(mockProvider([j([cand('\\weirdmacro{x} \\oplus \\sharp')])])));
    expect(res.candidates[0]!.status).toBe('unknown');
  }, 30000);

  it('makes no external web fetches — only localhost mathcheck', async () => {
    const realFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = ((input: Parameters<typeof realFetch>[0], init?: Parameters<typeof realFetch>[1]) => {
      urls.push(String(input));
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      await runCoderive(bundle(), anchors, deps(mockProvider([j([cand('x^2 + 2x + 1')])])));
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/127\.0\.0\.1|localhost/);
  }, 30000);
});

describe('honesty — attribution + the not-provided notice', () => {
  it('metadata-only refs carry the not-provided notice in the prompt; citing them flags attribution-unverified', async () => {
    clearReferenceCache();
    const refs = await buildReferences(
      ['cornish2018'],
      [{ path: 'refs.bib', encoding: 'utf8', content: '@article{cornish2018, title={Multiple scales}, year={2018}}' }],
      'multiple scales',
    );
    expect(refs[0]!.provenance).toBe('metadata-only');

    const bundle: ContextBundle = { macros: {}, assumptions: '', documentWindow: 'd', references: refs, intent: 'next-step', anchors: { from: 'x' } };
    expect(buildUserPrompt(bundle)).toContain('NOT provided');

    const res = await runCoderive(
      bundle,
      { fromLine: 1, from: 'x' },
      { modelProvider: mockProvider([j([{ latex: 'x', claimedEqualTo: 'x', technique: 't', groundedIn: ['cornish2018'], rationale: 'r' }])]), mathcheckUrl: MATHCHECK, model: 'mock' },
    );
    expect(res.candidates[0]!.status).toBe('verified'); // x ≡ x
    expect(res.candidates[0]!.attributionUnverified).toBe(true);
  }, 30000);
});

// ── Route + SSE + live SymPy ─────────────────────────────────────────────────

function parseSse(payload: string): Array<{ event: string; data: unknown }> {
  const out: Array<{ event: string; data: unknown }> = [];
  for (const block of payload.split('\n\n')) {
    const event = /event: (.*)/.exec(block)?.[1];
    const data = /data: (.*)/.exec(block)?.[1];
    if (event && data !== undefined) {
      try {
        out.push({ event, data: JSON.parse(data) });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

describe('POST /projects/:id/coderive (route + SSE)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let fileId: string;
  const doc = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\begin{align}',
    'y &= (x+1)^2 \\\\',
    'y &= x^2 + 2x + 1',
    '\\end{align}',
    '\\end{document}',
  ].join('\n');

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      config: { bearerToken: TOKEN },
      modelProvider: mockProvider([j([{ latex: 'y = x^2 + 2x + 1', claimedEqualTo: 'y = (x+1)^2', technique: 'expand', groundedIn: [], rationale: 'expand the square' }])]),
    });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `coderive ${Date.now()}` } });
    projectId = p.json().id;
    const f = await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'd.tex', content: doc } });
    fileId = f.json().id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('streams round progress then a result with a SymPy-verified candidate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/coderive`,
      headers: auth,
      payload: { fileId, intent: 'fill-gap', anchorRange: { fromLine: 4, toLine: 5 } },
    });
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    expect(events.some((e) => e.event === 'round')).toBe(true);
    const result = events.find((e) => e.event === 'result')?.data as { candidates: Array<{ status: string }>; context: unknown } | undefined;
    expect(result).toBeTruthy();
    expect(result!.candidates[0]!.status).toBe('verified');
    expect(result!.context).toBeTruthy();
  }, 30000);

  it('rejects a non-mathematical anchor (preamble line) without spending an LLM call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/coderive`,
      headers: auth,
      payload: { fileId, intent: 'next-step', anchorRange: { fromLine: 1 } }, // \documentclass — preamble
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/mathematical anchor/i);
  });
});
