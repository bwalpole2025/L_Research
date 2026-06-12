import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ModelProvider } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { runDocumentVerification } from '../src/coderive/document.js';
import { clearAuditCache } from '../src/audit/service.js';

const MATHCHECK = process.env.MATHCHECK_URL ?? 'http://127.0.0.1:8000';
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

// A document exercising the honest verdict policy:
//  · GOOD: a true standalone identity            → passed ✓
//  · BAD_CHAIN: a derivation chain with a wrong step → failing ✗ (the only place ✗ is emitted)
//  · DEF: a definition (sides not equal)         → unknown (NOT an error)
const GOOD = ['\\begin{equation}', '(x+1)^2 = x^2 + 2x + 1', '\\end{equation}'].join('\n');
const BAD_CHAIN = ['\\begin{align}', 'q &= (x+1)^2 \\\\', 'q &= x^2 + 2x + 2', '\\end{align}'].join('\n');
const DEF = ['\\begin{equation}', 'u = r \\cos\\theta', '\\end{equation}'].join('\n');
const BIB = '@article{basset1888treatise,\n\tauthor = {Basset, AB},\n\ttitle = {Treatise},\n\tyear = {1888}}';
const DOC = `\\documentclass{article}\n\\begin{document}\nText.\n${GOOD}\nMore.\n${BAD_CHAIN}\nMore.\n${DEF}\n\\end{document}\n`;

function recordMathcheck(): { bodies: string[]; restore: () => void } {
  const realFetch = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = (async (input: Parameters<typeof realFetch>[0], init?: Parameters<typeof realFetch>[1]) => {
    bodies.push(String(init?.body ?? ''));
    return realFetch(input, init);
  }) as typeof fetch;
  return { bodies, restore: () => void (globalThis.fetch = realFetch) };
}

/** Mock LLM that echoes equation ids back with a note + overall feedback. */
function commentaryProvider(capture: { prompts: string[] }): ModelProvider {
  return {
    async *chatStream(req) {
      const user = req.messages.map((m) => m.content).join('\n');
      capture.prompts.push(user);
      const ids = [...user.matchAll(/\[id ([^\]]+)\]/g)].map((m) => m[1]);
      yield {
        text: JSON.stringify({
          feedback: 'The derivation expands a binomial; the risk concentrates in the constant term. (Commentary, not a verdict.)',
          comments: ids.map((id) => ({ id, comment: 'check for a dropped constant term' })),
        }),
      };
    },
    async complete() {
      return '';
    },
    async editRegion() {
      return '';
    },
  };
}

describe('runDocumentVerification — SymPy is the arbiter, AI is context only', () => {
  it('verifies every equation, never sends bibliography, and AI commentary is not a verdict', async () => {
    clearAuditCache();
    const capture = { prompts: [] as string[] };
    const rec = recordMathcheck();
    let dv;
    try {
      dv = await runDocumentVerification(
        [
          { path: 'main.tex', content: DOC },
          { path: 'refs.bib', content: BIB },
        ],
        { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '', modelProvider: commentaryProvider(capture), model: 'mock' },
      );
    } finally {
      rec.restore();
    }

    // ✗ is emitted ONLY for the wrong step inside the derivation chain.
    const failing = dv.report.blocks.filter((b) => b.verdict === 'failing');
    expect(failing.length).toBe(1);
    expect(failing[0]!.latex).toContain('x^2 + 2x + 2');
    expect(failing[0]!.counterexample).toBeTruthy();

    // The true standalone identity passes; the DEFINITION (u = r cosθ) whose sides
    // are not equal is 'unknown' (not-an-identity), NEVER a false ✗.
    expect(dv.report.blocks.some((b) => b.verdict === 'passed' && b.latex.includes('2x + 1'))).toBe(true);
    const def = dv.report.blocks.find((b) => b.latex.includes('r \\cos'));
    expect(def?.verdict).toBe('unknown');
    expect(def?.method).toBe('not-an-identity');

    // The bibliography field NEVER reached mathcheck, and never reached the AI prompt as an equation.
    expect(rec.bodies.filter((b) => b.includes('Basset'))).toEqual([]);
    for (const p of capture.prompts) expect(p).not.toMatch(/author = \{Basset/);

    // AI commentary is attached BY ID to the failing equation — context, not a verdict.
    expect(dv.commentaryProvided).toBe(true);
    const comment = dv.comments.find((c) => c.id === failing[0]!.id);
    expect(comment?.comment).toContain('dropped constant');
    expect(failing[0]!.verdict).toBe('failing'); // the comment cannot change the SymPy verdict

    // Overall mathematical feedback is parsed; no PDF context here → pdfScanned false.
    expect(dv.feedback).toContain('Commentary, not a verdict');
    expect(dv.pdfScanned).toBe(false);
  }, 60000);

  it('works with no model provider — SymPy verdicts stand, zero AI commentary', async () => {
    clearAuditCache();
    const dv = await runDocumentVerification(
      [{ path: 'main.tex', content: DOC }],
      { mathcheckUrl: MATHCHECK, macros: {}, assumptions: '' },
    );
    expect(dv.report.totals.failing).toBe(1);
    expect(dv.commentaryProvided).toBe(false);
    expect(dv.comments).toEqual([]);
  }, 30000);

  it('a bibliography-only project yields no findings and makes no mathcheck calls', async () => {
    clearAuditCache();
    const rec = recordMathcheck();
    try {
      const dv = await runDocumentVerification([{ path: 'main.tex', content: `\\begin{filecontents}{r.bib}\n${BIB}\n\\end{filecontents}\nprose` }], {
        mathcheckUrl: MATHCHECK,
        macros: {},
        assumptions: '',
      });
      expect(dv.report.blocks).toEqual([]);
      expect(rec.bodies).toEqual([]);
    } finally {
      rec.restore();
    }
  }, 30000);
});

describe('POST /projects/:id/coderive intent=verify-document (route + SSE)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    const provider = commentaryProvider({ prompts: [] });
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: provider });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `docverify ${Date.now()}` } });
    projectId = p.json().id;
    // New projects auto-seed a (near-empty) main.tex; store the document under a distinct path.
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'chapter.tex', content: DOC } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'refs.bib', content: BIB } });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('streams a result with documentVerification, no anchor/fileId needed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/coderive`,
      headers: auth,
      payload: { intent: 'verify-document' },
    });
    expect(res.statusCode).toBe(200);
    const result = res.payload
      .split('\n\n')
      .map((b) => ({ event: /event: (.*)/.exec(b)?.[1], data: /data: (.*)/.exec(b)?.[1] }))
      .find((e) => e.event === 'result');
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result!.data!) as {
      candidates: unknown[];
      documentVerification?: { report: { totals: { passed: number; failing: number } }; comments: unknown[] };
    };
    expect(parsed.candidates).toEqual([]); // no insertable proposals in this mode
    expect(parsed.documentVerification).toBeTruthy();
    expect(parsed.documentVerification!.report.totals.passed).toBeGreaterThanOrEqual(1);
    expect(parsed.documentVerification!.report.totals.failing).toBe(1); // only the chain's wrong step
    // The route compiles FIRST and scans the compiled PDF.
    const dv = parsed.documentVerification as unknown as { pdfScanned: boolean; pdfPageCount?: number; verifyPdfUrl?: string };
    expect(dv.pdfScanned).toBe(true);
    expect(dv.pdfPageCount).toBeGreaterThanOrEqual(1);

    // An annotated PDF (SymPy verdicts + AI comments + feedback page) is ALWAYS
    // produced when a PDF exists — and it is servable.
    expect(dv.verifyPdfUrl).toBeTruthy();
    const servedPath = dv.verifyPdfUrl!.replace(/\?.*$/, '');
    const pdf = await app.inject({ method: 'GET', url: servedPath, headers: auth });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  }, 120000);

  it('verifies only the compiled document — a wrong equation in an unused .tex is dropped', async () => {
    // A clearly-wrong chain in a file the root (chapter.tex) never \inputs, so it
    // is not in the compiled PDF and must not be verified.
    const SCRATCH = ['\\begin{align}', 'z &= 2x \\\\', 'z &= 3x', '\\end{align}'].join('\n');
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'scratch.tex', content: SCRATCH } });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/coderive`, headers: auth, payload: { intent: 'verify-document' } });
    const result = res.payload
      .split('\n\n')
      .map((b) => ({ event: /event: (.*)/.exec(b)?.[1], data: /data: (.*)/.exec(b)?.[1] }))
      .find((e) => e.event === 'result');
    const parsed = JSON.parse(result!.data!) as {
      documentVerification: { report: { totals: { failing: number }; blocks: Array<{ file: string }> } };
    };
    const blocks = parsed.documentVerification.report.blocks;
    // scratch.tex isn't in the compiled PDF → its equations are not verified.
    expect(blocks.some((b) => b.file === 'scratch.tex')).toBe(false);
    // Still exactly one failure — the chain in the compiled document, not scratch's.
    expect(parsed.documentVerification.report.totals.failing).toBe(1);
  }, 120000);
});
