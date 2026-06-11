import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  isPlausibleMathExpression,
  makeVerificationCandidate,
  type ContextBundle,
  type ModelProvider,
} from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { extractMathBlocks, stripBibliographyRegions } from '../src/audit/extract.js';
import { auditMaths } from '../src/audit/service.js';
import { clearAuditCache } from '../src/audit/service.js';
import { exprAtLine, looksLikeMath } from '../src/coderive/anchors.js';
import { runCoderive } from '../src/coderive/engine.js';

const MATHCHECK = process.env.MATHCHECK_URL ?? 'http://127.0.0.1:8000';
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

/** The REAL failing input — the basset1888treatise entry from the user's ref2-3-4.bib. */
const BASSET_BIB = [
  '@article{basset1888treatise,',
  '\tauthor = {Basset, AB},',
  '\tdate-added = {2024-05-27 16:47:26 +0100},',
  '\tdate-modified = {2024-05-27 16:47:26 +0100},',
  '\tjournal = {Deighton Bell},',
  '\tpages = {285},',
  '\ttitle = {Treatise on Hydrodynamics, vol. 2, chap. 22},',
  '\tyear = {1888}}',
].join('\n');
const AUTHOR_LINE = 'author = {Basset, AB},';

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

/** Record every body that reaches the mathcheck boundary, forwarding to the live service. */
function recordMathcheck(): { bodies: string[]; restore: () => void } {
  const realFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof realFetch>[0], init?: Parameters<typeof realFetch>[1]) => {
    bodies.push(String(init?.body ?? ''));
    return realFetch(input, init);
  }) as typeof fetch;
  return { bodies, restore: () => void (globalThis.fetch = realFetch) };
}

// ── 1. The guard, unit-tested on a table ─────────────────────────────────────

describe('isPlausibleMathExpression — rejects BibTeX/prose, accepts real maths', () => {
  const rejected: Array<[string, string]> = [
    [AUTHOR_LINE, 'bibtex-field'],
    ['title = {Treatise on Hydrodynamics, vol. 2, chap. 22},', 'bibtex-field'],
    ['journal = {Deighton Bell},', 'bibtex-field'],
    ['pages = {285},', 'bibtex-field'],
    ['date-added = {2024-05-27 16:47:26 +0100},', 'bibtex-field'],
    ['publisher = "Cambridge university press"', 'bibtex-field'],
    ['@article{basset1888treatise,', 'bibtex-entry'],
    ['@book{lighthill2001waves, title={Waves in fluids}}', 'bibtex-entry'],
    ['@inproceedings{x, year={2001}}', 'bibtex-entry'],
    ['readinglist = {summer},', 'bibtex-field-shaped'],
    ['The drag on the sphere follows from the boundary layer', 'prose'],
    ['Treatise on Hydrodynamics', 'prose'],
    ['We expand the square and collect terms', 'prose'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['{} , ; :', 'no-content'],
    ['\\label{eq:euler}', 'structural-latex'],
    ['%% Created using BibDesk', 'latex-comment'],
    ['\\cite{basset1888treatise}', 'structural-latex'],
    ['\\usepackage{tikz}', 'structural-latex'],
    ['\\section{Introduction}', 'structural-latex'],
  ];
  const accepted = [
    '(x+1)^2',
    'x^2 + 2x + 1',
    '\\nabla \\cdot \\vb{u} = 0',
    'E = m c^2',
    'e^{i\\pi} = -1',
    'a = b',
    'x',
    '\\Bo^{-1} \\eta_{xx}',
    '\\frac{\\partial u}{\\partial t} + u \\cdot \\nabla u = -\\nabla p',
    'y &= (x+1)^2 \\\\',
  ];

  it.each(rejected)('rejects %j (%s)', (input, reason) => {
    const v = isPlausibleMathExpression(input);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe(reason);
  });

  it.each(accepted.map((a) => [a]))('accepts %j', (input) => {
    expect(isPlausibleMathExpression(input).ok).toBe(true);
  });

  it('makeVerificationCandidate is the only door and it refuses the basset field', () => {
    const made = makeVerificationCandidate(AUTHOR_LINE, 'llm-step');
    expect(made.rejected).toBe('bibtex-field');
    expect(made.candidate).toBeUndefined();
  });
});

// ── 2. Anchors: no bare-line fallback; bib lines can never anchor ────────────

describe('anchor resolution — a .bib line can never become a verification expression', () => {
  it('exprAtLine on the basset author line returns undefined (no raw-line fallback)', () => {
    expect(exprAtLine(BASSET_BIB, 2)).toBeUndefined();
  });
  it('looksLikeMath rejects the basset field (it used to accept it via "= and braces")', () => {
    expect(looksLikeMath(AUTHOR_LINE)).toBe(false);
    expect(looksLikeMath('pages = {285},')).toBe(false);
  });
  it('display math and explicitly selected inline $…$ still anchor', () => {
    const doc = 'intro text\n\\begin{equation}\ny = (x+1)^2\n\\end{equation}\nwhere $z = x^2$ holds\n';
    expect(exprAtLine(doc, 3)).toContain('(x+1)^2');
    expect(exprAtLine(doc, 5)).toBe('z = x^2'); // inline $…$ on the cursor line
  });
});

// ── 3. Extraction: bibliography is invisible to the math scanner ─────────────

describe('math extraction excludes bibliography', () => {
  it('a .bib file yields ZERO math candidates, even with an embedded equation env', () => {
    const sneaky = `${BASSET_BIB}\n@misc{weird, abstract={\\begin{equation} x = 1 \\end{equation}}}\n`;
    expect(extractMathBlocks('ref2-3-4.bib', sneaky)).toEqual([]);
    expect(extractMathBlocks('style.bst', '\\begin{equation} x=1 \\end{equation}')).toEqual([]);
  });

  it('thebibliography and BibTeX blocks inside a .tex are blanked; real equations survive with correct lines', () => {
    const tex = [
      '\\begin{thebibliography}{9}',
      '\\bibitem{b} Basset, AB. \\begin{equation} fake = {x} \\end{equation}',
      '\\end{thebibliography}',
      BASSET_BIB,
      '\\begin{equation}',
      'y = (x+1)^2',
      '\\end{equation}',
    ].join('\n');
    const blocks = extractMathBlocks('main.tex', tex);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.steps[0]!.latex).toBe('y = (x+1)^2');
    expect(blocks[0]!.steps[0]!.line).toBe(13); // offsets preserved by blanking
    expect(stripBibliographyRegions(tex)).not.toContain('Basset');
  });

  it('auditMaths sends NOTHING to mathcheck for a project that is only bibliography', async () => {
    clearAuditCache();
    const rec = recordMathcheck();
    try {
      const report = await auditMaths(
        [
          { path: 'refs.bib', content: BASSET_BIB },
          { path: 'main.tex', content: `\\begin{filecontents}{refs.bib}\n${BASSET_BIB}\n\\end{filecontents}\nprose only` },
        ],
        { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' },
      );
      expect(report.blocks).toEqual([]);
      expect(rec.bodies.filter((b) => b.includes('Basset'))).toEqual([]);
      expect(rec.bodies).toEqual([]); // no candidates ⇒ no calls at all
    } finally {
      rec.restore();
    }
  });
});

// ── 4 + 5. The engine seam: bib text never reaches mathcheck; maths still verified ──

describe('co-derive engine — reference text is LLM context only (live SymPy)', () => {
  const bundle = (): ContextBundle => ({
    macros: {},
    assumptions: '',
    documentWindow: 'We expand the square.',
    references: [
      { key: 'basset1888treatise', author: 'Basset, AB', title: 'Treatise on Hydrodynamics', year: '1888', provenance: 'metadata-only' },
    ],
    intent: 'fill-gap',
    anchors: { from: '(x+1)^2', to: 'x^2 + 2x + 1' },
  });
  const anchors = { fromLine: 2, toLine: 3, from: '(x+1)^2', to: 'x^2 + 2x + 1' };
  const proposal = (latex: string) => ({ latex, claimedEqualTo: '(x+1)^2', technique: 't', groundedIn: [], rationale: 'r' });

  it('an LLM proposal echoing the basset field is SKIPPED — mathcheck never receives it; the real maths is still SymPy-verified', async () => {
    const rec = recordMathcheck();
    try {
      const res = await runCoderive(bundle(), anchors, {
        modelProvider: mockProvider([JSON.stringify([proposal(AUTHOR_LINE), proposal('x^2 + 2x + 1')])]),
        mathcheckUrl: MATHCHECK,
        model: 'mock',
      });
      // The citation line was discarded with a reason — NOT an insertable candidate.
      expect(res.skipped).toEqual([{ latex: AUTHOR_LINE, reason: 'bibtex-field' }]);
      expect(res.candidates.map((c) => c.latex)).toEqual(['x^2 + 2x + 1']);
      expect(res.candidates[0]!.status).toBe('verified'); // genuine maths still verified by SymPy
      // PROOF: no body that reached the mathcheck boundary contains the bib text.
      expect(rec.bodies.filter((b) => b.includes('Basset'))).toEqual([]);
      expect(rec.bodies.length).toBeGreaterThan(0); // the real maths WAS verified
    } finally {
      rec.restore();
    }
  }, 30000);

  it('a genuine derivation is still extracted and verified ✓ end to end', async () => {
    const res = await runCoderive(bundle(), anchors, {
      modelProvider: mockProvider([JSON.stringify([proposal('x^2 + 2x + 1')])]),
      mathcheckUrl: MATHCHECK,
      model: 'mock',
    });
    expect(res.candidates[0]!.status).toBe('verified');
    expect(res.skipped).toEqual([]);
  }, 30000);

  it('when EVERY proposal is non-math, nothing reaches mathcheck and no candidate is insertable', async () => {
    const rec = recordMathcheck();
    try {
      const res = await runCoderive(bundle(), anchors, {
        modelProvider: mockProvider([
          JSON.stringify([proposal(AUTHOR_LINE), proposal('@article{basset1888treatise,'), proposal('Treatise on Hydrodynamics')]),
        ]),
        mathcheckUrl: MATHCHECK,
        model: 'mock',
      });
      expect(res.candidates).toEqual([]); // nothing insertable
      expect(res.skipped.map((s) => s.reason)).toEqual(['bibtex-field', 'bibtex-entry', 'prose']);
      expect(res.rounds[0]!.skippedCount).toBe(3);
      expect(rec.bodies).toEqual([]); // mathcheck never called
    } finally {
      rec.restore();
    }
  }, 30000);
});

// ── 6. Route level: .bib targets + the proxy guard ───────────────────────────

describe('route-level enforcement', () => {
  let app: FastifyInstance;
  let projectId: string;
  let bibFileId: string;
  let llmCalls = 0;

  beforeAll(async () => {
    const provider: ModelProvider = {
      async *chatStream() {
        llmCalls += 1;
        yield { text: '[]' };
      },
      async complete() {
        return '';
      },
      async editRegion() {
        return '';
      },
    };
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: provider });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `guard ${Date.now()}` } });
    projectId = p.json().id;
    const f = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'ref2-3-4.bib', content: BASSET_BIB },
    });
    bibFileId = f.json().id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('co-derive on a .bib file is rejected 422 without spending an LLM call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/coderive`,
      headers: auth,
      payload: { fileId: bibFileId, intent: 'next-step', anchorRange: { fromLine: 2 } }, // the author line
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/\.tex documents/);
    expect(llmCalls).toBe(0);
  });

  it('the mathcheck proxy refuses a BibTeX field before it can reach the verifier', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mathcheck/equivalent',
      headers: auth,
      payload: { lhs: AUTHOR_LINE, rhs: 'x^2', assumptions: '', macros: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().reason).toBe('bibtex-field');
  });

  it('the mathcheck proxy still forwards genuine maths', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mathcheck/equivalent',
      headers: auth,
      payload: { lhs: '(x+1)^2', rhs: 'x^2 + 2x + 1', assumptions: '', macros: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().equivalent).toBe(true);
  }, 30000);
});
