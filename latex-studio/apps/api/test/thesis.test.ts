import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseProject } from '../src/thesis/parse.js';
import { extractMathBlocks, splitEquation } from '../src/audit/extract.js';
import { clearAuditCache } from '../src/audit/service.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

// ── Pure: outline + cross-reference parser ────────────────────────────────────

describe('parseProject — outline + xref', () => {
  const main = {
    path: 'main.tex',
    content: [
      '\\documentclass{book}',
      '\\begin{document}',
      '\\chapter{Introduction}\\label{ch:intro}',
      'See \\ref{eq:euler} and \\ref{fig:ghost}.',
      '\\input{chapters/methods}',
      '\\cite{cornish2018}\\cite{missingkey}',
      '\\end{document}',
    ].join('\n'),
  };
  const methods = {
    path: 'chapters/methods.tex',
    content: [
      '\\section{Methods}\\label{sec:methods}',
      '\\subsection{Setup}',
      '\\begin{equation}\\label{eq:euler}',
      'e^{i\\pi} = -1',
      '\\end{equation}',
      '\\label{eq:euler}', // duplicate
      '\\begin{equation}',
      'a = b',
      '\\end{equation}', // numbered, unlabelled
    ].join('\n'),
  };
  const bib = { path: 'refs.bib', content: '@article{cornish2018, title={X}, author={Y}, year={2018}}\n' };

  const parsed = parseProject([main, methods, bib], 'main.tex');

  it('builds a nested multi-file outline in \\input order', () => {
    expect(parsed.outline).toHaveLength(1);
    const chapter = parsed.outline[0]!;
    expect(chapter.kind).toBe('chapter');
    expect(chapter.title).toBe('Introduction');
    const section = chapter.children[0]!;
    expect(section.kind).toBe('section');
    expect(section.file).toBe('chapters/methods.tex');
    expect(section.children[0]!.kind).toBe('subsection');
  });

  it('flags an undefined \\ref', () => {
    const d = parsed.xref.diagnostics.find((x) => x.rule === 'undefined-ref');
    expect(d?.key).toBe('fig:ghost');
    expect(d?.severity).toBe('error');
  });

  it('flags a duplicate \\label with all locations', () => {
    const d = parsed.xref.diagnostics.find((x) => x.rule === 'duplicate-label');
    expect(d?.key).toBe('eq:euler');
    expect(d?.locations?.length).toBe(2);
  });

  it('flags a \\cite with no bib entry, but not the one that exists', () => {
    const missing = parsed.xref.diagnostics.filter((x) => x.rule === 'missing-cite');
    expect(missing.map((m) => m.key)).toEqual(['missingkey']);
  });

  it('reports an unlabelled numbered equation as info', () => {
    expect(parsed.xref.diagnostics.some((x) => x.rule === 'unlabelled-equation')).toBe(true);
  });
});

describe('extractMathBlocks + splitEquation', () => {
  it('extracts display envs and \\[..\\] with line spans', () => {
    const content = 'a\n\\begin{align}\nx &= 1 \\\\\ny &= 2\n\\end{align}\n\\[ z = 3 \\]\n';
    const blocks = extractMathBlocks('f.tex', content);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.env).toBe('align');
    expect(blocks[0]!.steps.map((s) => s.line)).toEqual([3, 4]);
    expect(blocks[1]!.env).toBe('display');
  });
  it('splits a top-level equation, ignoring <= and braces', () => {
    expect(splitEquation('x &= 2(y+1)')).toEqual({ lhs: 'x', rhs: '2(y+1)' });
    expect(splitEquation('f(x) \\leq g(x)')).toBeNull();
    expect(splitEquation('\\alpha')).toBeNull();
  });
});

// ── Integration: maths audit against the live mathcheck service ───────────────

describe('maths audit (live mathcheck)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let fileId: string;
  const chapter = [
    '\\documentclass{article}',
    '\\begin{document}',
    '\\section{Algebra}',
    'A derivation with a planted error:',
    '\\begin{align}',
    'x &= 2(y+1) \\\\',
    'x &= 2y + 1', // WRONG: should be 2y + 2
    '\\end{align}',
    'A true identity:',
    '\\begin{equation}',
    'a = a + 0',
    '\\end{equation}',
    'Something unparseable:',
    '\\[ \\weirdmacro{q} \\]',
    '\\end{document}',
  ].join('\n');

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `audit ${Date.now()}` } });
    projectId = p.json().id;
    const f = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'chapter.tex', content: chapter },
    });
    fileId = f.json().id;
    clearAuditCache();
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('surfaces exactly the planted step as failing with a counterexample', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/audit-maths`,
      headers: auth,
      payload: { scope: 'file', fileId },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json();

    const failing = report.blocks.filter((b: { verdict: string }) => b.verdict === 'failing');
    expect(failing).toHaveLength(1);
    expect(failing[0].lineStart).toBe(7); // the "x &= 2y + 1" line
    expect(failing[0].counterexample).toBeTruthy();

    // The true identity passes; the macro line is unknown (never "passed").
    expect(report.blocks.some((b: { verdict: string; latex: string }) => b.verdict === 'passed' && b.latex.includes('a + 0'))).toBe(true);
    expect(report.blocks.some((b: { verdict: string; latex: string }) => b.verdict === 'unknown' && b.latex.includes('weirdmacro'))).toBe(true);
    expect(report.totals.failing).toBe(1);
    expect(report.totals.checked).toBeGreaterThan(0);
    expect(report.byFile['chapter.tex']).toBeGreaterThanOrEqual(2); // failing + unknown
  }, 30000);

  it('re-audit after an unrelated edit rechecks nothing (cache hit)', async () => {
    // Insert an unrelated paragraph above (shifts line numbers, same equations).
    const edited = chapter.replace('\\section{Algebra}', '\\section{Algebra}\nAn extra unrelated sentence here.');
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/audit-maths`,
      headers: auth,
      payload: { scope: 'file', fileId, overrides: { 'chapter.tex': edited } },
    });
    const report = res.json();
    expect(report.totals.checked).toBe(0); // all served from cache
    expect(report.totals.cached).toBeGreaterThan(0);
    expect(report.totals.failing).toBe(1); // still flagged, with current (shifted) line
    const failing = report.blocks.find((b: { verdict: string }) => b.verdict === 'failing');
    expect(failing.lineStart).toBe(8); // shifted down by the inserted line
  }, 30000);
});

describe('dictionary + pre-submit (live compile + mathcheck)', () => {
  let app: FastifyInstance;
  let projectId: string;
  const main = [
    '\\documentclass{article}',
    '\\begin{document}',
    'A sentance with a typo. See \\ref{nope}.',
    '\\begin{equation}',
    'a = a + 0',
    '\\end{equation}',
    '\\end{document}',
  ].join('\n');

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `presubmit ${Date.now()}` } });
    projectId = p.json().id;
    const files = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    const mainFile = (files.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!;
    await app.inject({ method: 'PATCH', url: `/files/${mainFile.id}`, headers: auth, payload: { content: main } });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('persists a word added to the dictionary', async () => {
    const before = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/prose-check`,
      headers: auth,
      payload: { scope: 'project' },
    });
    expect((before.json().diagnostics as Array<{ word?: string }>).some((d) => d.word === 'sentance')).toBe(true);

    await app.inject({ method: 'POST', url: `/projects/${projectId}/dictionary`, headers: auth, payload: { word: 'sentance' } });
    const after = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/prose-check`,
      headers: auth,
      payload: { scope: 'project' },
    });
    expect((after.json().diagnostics as Array<{ word?: string }>).some((d) => d.word === 'sentance')).toBe(false);
  }, 30000);

  it('pre-submit produces a combined dashboard summary', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/pre-submit`, headers: auth, payload: {} });
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.compile.status).toBe('success');
    expect(s.maths.failing).toBe(0); // a = a + 0 passes
    expect(s.xref.error).toBeGreaterThanOrEqual(1); // \ref{nope} undefined
    expect(s.ready).toBe(false); // reference error blocks readiness
    expect(typeof s.generatedAt).toBe('string');
  }, 60000);
});
