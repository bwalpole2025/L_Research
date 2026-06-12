import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ModelProvider, RetrievedPassage, ReviewFinding } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { indexLibraryItem, libraryIndexStatus } from '../src/rag/indexer.js';
import { retrievePassages } from '../src/rag/retrieve.js';
import { embeddingAvailable } from '../src/rag/embeddings.js';
import { citationContentFindings, judgeClaims, makeRagFinding, physicsFindings, type RagDeps } from '../src/review/rag.js';

const MATHCHECK = process.env.MATHCHECK_URL ?? 'http://127.0.0.1:8000';
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

const PASSAGE =
  'The Basset history force always opposes the unsteady relative acceleration of a sphere moving through a viscous fluid. ' +
  'This memory force decays with the inverse square root of elapsed time and is significant whenever the particle ' +
  'acceleration timescale is comparable to the viscous diffusion timescale. '.repeat(3);

const CLAIM = 'The Basset history force enhances the unsteady acceleration of a sphere in viscous fluid.';

/** Mock LLM routed by system prompt: claim extraction, judging, or review axes. */
function scriptedProvider(judgeVerdict: 'contradicts' | 'supports' | 'omit-passage-index'): ModelProvider {
  return {
    async *chatStream(req) {
      const sys = req.system ?? '';
      const user = req.messages.map((m) => m.content).join('\n');
      if (sys.includes('Extract CHECKABLE assertions')) {
        const m = /^(\d+): .*Basset history force/m.exec(user);
        yield { text: m ? JSON.stringify([{ line: Number(m[1]), claim: CLAIM }]) : '[]' };
        return;
      }
      if (sys.includes('judge claims ONLY against')) {
        const ids = [...user.matchAll(/claim id=(\S+)/g)].map((x) => x[1]);
        yield {
          text: JSON.stringify(
            ids.map((id) =>
              judgeVerdict === 'omit-passage-index'
                ? { id, verdict: 'contradicts', quote: 'no index supplied' } // tries to flag WITHOUT pointing at evidence
                : { id, verdict: judgeVerdict, passageIndex: 0, quote: 'always opposes the unsteady relative acceleration', reason: 'sign disagrees' },
            ),
          ),
        };
        return;
      }
      yield { text: '[]' }; // literature/background/prose LLM axes: nothing
    },
    async complete() {
      return '';
    },
    async editRegion() {
      return '';
    },
  };
}

describe('RAG index + retrieval (live pgvector + local embeddings)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let itemId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    expect(await embeddingAvailable(MATHCHECK)).toBe(true);
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `rag ${Date.now()}` } });
    projectId = p.json().id;
    const item = await app.prisma.literatureItem.create({
      data: { projectId, title: 'Basset 1888 — Treatise', citeKey: 'basset1888', extractedText: PASSAGE, extractedAt: new Date() },
    });
    itemId = item.id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('indexes an item into LibraryChunk rows and reports coverage', async () => {
    const n = await indexLibraryItem(app.prisma, MATHCHECK, { id: itemId, projectId, extractedText: PASSAGE }, [
      { page: 7, charStart: 0 },
    ]);
    expect(n).toBeGreaterThan(0);
    const status = await libraryIndexStatus(app.prisma, projectId);
    expect(status.indexedItems).toBe(1);
    expect(status.chunks).toBe(n);
    expect(status.model).toContain('bge-small');
  }, 60000);

  it('retrieves the planted passage for a related claim, with page provenance + score', async () => {
    const hits = await retrievePassages(app.prisma, MATHCHECK, projectId, CLAIM, { k: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain('Basset history force');
    expect(hits[0]!.page).toBe(7);
    expect(hits[0]!.score).toBeGreaterThan(0.45);
    expect(hits[0]!.sourceTitle).toContain('Basset');

    // Scoped retrieval (citation-content) returns the same item's chunks only.
    const scoped = await retrievePassages(app.prisma, MATHCHECK, projectId, CLAIM, { literatureItemId: itemId, k: 3 });
    expect(scoped.every((h) => h.literatureItemId === itemId)).toBe(true);
  }, 60000);

  it('re-indexing replaces chunks idempotently (text change → fresh index)', async () => {
    const n1 = await indexLibraryItem(app.prisma, MATHCHECK, { id: itemId, projectId, extractedText: PASSAGE }, []);
    const n2 = await indexLibraryItem(app.prisma, MATHCHECK, { id: itemId, projectId, extractedText: PASSAGE }, []);
    expect(n2).toBe(n1);
    const status = await libraryIndexStatus(app.prisma, projectId);
    expect(status.chunks).toBe(n2); // replaced, not appended
  }, 60000);

  // ── The honesty invariant: no retrieval → no contradiction ────────────────

  it('makeRagFinding REFUSES to construct a rag finding without passages', () => {
    expect(() =>
      makeRagFinding(
        { id: 'x', axis: 'background', category: 'physics', severity: 'warning', file: 'a.tex', lineSpan: { fromLine: 1, toLine: 1 }, message: 'm' },
        'contradiction',
        [],
      ),
    ).toThrow(/requires at least one retrieved passage/);
  });

  it('a judge "contradicts" WITHOUT a valid passage index degrades to not-addressed', async () => {
    const deps = depsFor(app, projectId, scriptedProvider('omit-passage-index'));
    const passages: RetrievedPassage[] = [{ literatureItemId: itemId, page: 1, text: PASSAGE.slice(0, 200), score: 0.9 }];
    const judged = await judgeClaims(deps, [{ id: 'c1', claim: CLAIM, passages }]);
    expect(judged.get('c1')?.verdict).toBe('not-addressed');
  });

  it('AXIS C: a claim contradicting an indexed passage → rag-contradiction WITH evidence', async () => {
    const deps = depsFor(app, projectId, scriptedProvider('contradicts'));
    const tex = [{ path: 'main.tex', content: `Intro.\n${CLAIM}\nMore prose.` }];
    const findings = await physicsFindings(deps, tex);
    const contra = findings.find((f) => f.confidence === 'rag-contradiction');
    expect(contra).toBeTruthy();
    expect(contra!.retrievedPassages!.length).toBeGreaterThan(0);
    expect(contra!.retrievedPassages![0]!.text).toContain('Basset');
    expect(contra!.quotedSpan).toContain('opposes');
    assertRagInvariant(findings);
  }, 60000);

  it('AXIS C: with an EMPTY library index, the same claim is "no source in library" — never an error', async () => {
    // A separate project with no indexed chunks at all.
    const p2 = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `rag-empty ${Date.now()}` } });
    const emptyProjectId = p2.json().id as string;
    try {
      const deps = depsFor(app, emptyProjectId, scriptedProvider('contradicts')); // even a malicious judge cannot help
      const findings = await physicsFindings(deps, [{ path: 'main.tex', content: `Intro.\n${CLAIM}\n` }]);
      expect(findings.every((f) => f.confidence === 'no-library-source')).toBe(true);
      expect(findings.every((f) => f.severity === 'info')).toBe(true);
      expect(findings.every((f) => !f.retrievedPassages)).toBe(true);
      assertRagInvariant(findings);
    } finally {
      await app.prisma.project.delete({ where: { id: emptyProjectId } }).catch(() => undefined);
    }
  }, 60000);

  it('AXIS B2: a claim citing an indexed source is judged against THAT source and quotes the passage', async () => {
    const deps = depsFor(app, projectId, scriptedProvider('contradicts'), new Map([['basset1888', libRef(itemId, PASSAGE)]]));
    const tex = [{ path: 'main.tex', content: `${CLAIM} \\citep{basset1888}.\n` }];
    const findings = await citationContentFindings(deps, tex);
    const contra = findings.find((f) => f.confidence === 'rag-contradiction');
    expect(contra).toBeTruthy();
    expect(contra!.reference).toBe('basset1888');
    expect(contra!.retrievedPassages![0]!.literatureItemId).toBe(itemId);
    assertRagInvariant(findings);
  }, 60000);

  it('AXIS B2: a cited item with NO indexed text → "attribution unverified", never a contradiction', async () => {
    const bare = await app.prisma.literatureItem.create({
      data: { projectId, title: 'No-text item', citeKey: 'notext2020' },
    });
    try {
      const deps = depsFor(app, projectId, scriptedProvider('contradicts'), new Map([['notext2020', libRef(bare.id, null)]]));
      const findings = await citationContentFindings(deps, [{ path: 'main.tex', content: `${CLAIM} \\citep{notext2020}.\n` }]);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.confidence === 'attribution-unverified')).toBe(true);
      expect(findings.every((f) => f.confidence !== 'rag-contradiction')).toBe(true);
      assertRagInvariant(findings);
    } finally {
      await app.prisma.literatureItem.delete({ where: { id: bare.id } }).catch(() => undefined);
    }
  }, 60000);
});

describe('POST /projects/:id/check — the full pipeline (live SymPy + pgvector + mock LLM)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: scriptedProvider('contradicts') });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `check ${Date.now()}` } });
    projectId = p.json().id;

    // Planted: a wrong derivation chain, a missing cite key, a misspelling, a claim
    // contradicting the library, all in one document.
    const DOC = [
      '\\documentclass{article}',
      '\\begin{document}',
      `${CLAIM} \\citep{basset1888}.`,
      'A misspeld word and a missing citation \\citep{ghostkey2020}.',
      '\\begin{align}',
      'q &= (x+1)^2 \\\\',
      'q &= x^2 + 2x + 2',
      '\\end{align}',
      '\\end{document}',
    ].join('\n');
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    const main = (list.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!;
    await app.inject({ method: 'PATCH', url: `/files/${main.id}`, headers: auth, payload: { content: DOC } });
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'refs.bib', content: '@book{basset1888, title={Treatise}, author={Basset, AB}, year={1888}}' },
    });

    const item = await app.prisma.literatureItem.create({
      data: { projectId, title: 'Basset 1888 — Treatise', citeKey: 'basset1888', extractedText: PASSAGE, extractedAt: new Date() },
    });
    await indexLibraryItem(app.prisma, MATHCHECK, { id: item.id, projectId, extractedText: PASSAGE }, [{ page: 7, charStart: 0 }]);
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('one findings set: refuted algebra + structural cite + spelling + RAG contradiction with evidence', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/check`, headers: auth, payload: { scope: 'project' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { findings: ReviewFinding[] };
    const f = body.findings;

    // AXIS A — SymPy refutes the planted wrong step (machine-certain).
    const algebra = f.find((x) => x.axis === 'maths' && x.confidence === 'refuted');
    expect(algebra).toBeTruthy();
    expect(algebra!.counterexample).toBeTruthy();

    // AXIS B1 — the missing bib key is a deterministic structural finding.
    const structural = f.find((x) => x.confidence === 'verified' && x.reference === 'ghostkey2020');
    expect(structural).toBeTruthy();

    // AXIS D — deterministic spelling.
    expect(f.some((x) => x.confidence === 'verified-typo' && x.message.includes('misspeld'))).toBe(true);

    // AXES B2/C — RAG contradiction carries the retrieved passage + page + source.
    const rag = f.filter((x) => x.confidence === 'rag-contradiction');
    expect(rag.length).toBeGreaterThan(0);
    for (const r of rag) {
      expect(r.retrievedPassages!.length).toBeGreaterThan(0);
      expect(r.retrievedPassages![0]!.page).toBe(7);
      expect(r.retrievedPassages![0]!.text).toContain('Basset');
    }

    // THE INVARIANT, asserted over the whole set: no rag finding without evidence.
    assertRagInvariant(f);
  }, 120000);
});

// ── helpers ───────────────────────────────────────────────────────────────────

function depsFor(
  app: FastifyInstance,
  projectId: string,
  provider: ModelProvider,
  libraryItems: RagDeps['libraryItems'] = new Map(),
): RagDeps {
  return { prisma: app.prisma, projectId, mathcheckUrl: MATHCHECK, modelProvider: provider, model: 'mock', libraryItems };
}

function libRef(itemId: string, extractedText: string | null) {
  return { itemId, title: 'Basset 1888 — Treatise', authors: 'Basset', year: '1888', abstract: null, extractedText, fileName: 'b.pdf' };
}

/** A RAG finding with empty retrievedPassages is a bug — assert it cannot occur. */
function assertRagInvariant(findings: ReviewFinding[]): void {
  for (const f of findings) {
    if (f.confidence === 'rag-contradiction' || f.confidence === 'rag-supported') {
      expect(f.retrievedPassages && f.retrievedPassages.length > 0).toBe(true);
    }
  }
}
