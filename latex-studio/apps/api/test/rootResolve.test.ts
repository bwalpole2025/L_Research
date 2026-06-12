import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { resolveRootFile } from '../src/compile/rootResolve.js';
import { DEFAULT_MAIN_TEX } from '../src/lib/seedTemplate.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

const ROOT_DOC = '\\documentclass{article}\n\\begin{document}\nFallback root.\n\\end{document}\n';

describe('resolveRootFile — fall back to the next available .tex document', () => {
  it('keeps the configured root when it exists', () => {
    const r = resolveRootFile('main.tex', [{ path: 'main.tex', content: 'x' }, { path: 'thesis.tex', content: ROOT_DOC }]);
    expect(r).toEqual({ rootFile: 'main.tex', fellBack: false });
  });

  it('prefers a real compilable root (\\documentclass + \\begin{document}) over fragments', () => {
    const r = resolveRootFile('main.tex', [
      { path: 'chapters/intro.tex', content: '\\section{Intro} no documentclass here' },
      { path: 'thesis.tex', content: ROOT_DOC },
    ]);
    expect(r).toEqual({ rootFile: 'thesis.tex', fellBack: true, reason: 'missing' });
  });

  it('prefers shallower paths, then alphabetical, among equal candidates', () => {
    const r = resolveRootFile('main.tex', [
      { path: 'b/deep.tex', content: ROOT_DOC },
      { path: 'beta.tex', content: ROOT_DOC },
      { path: 'alpha.tex', content: ROOT_DOC },
    ]);
    expect(r.rootFile).toBe('alpha.tex');
  });

  it('ignores binary files and non-.tex; with no .tex at all the configured name is kept', () => {
    const none = resolveRootFile('main.tex', [
      { path: 'figure.png', content: 'xxxx', encoding: 'base64' },
      { path: 'refs.bib', content: '@article{a, title={T}}' },
    ]);
    expect(none).toEqual({ rootFile: 'main.tex', fellBack: false });
  });

  // The "uploaded my paper into a fresh project" case: the UNTOUCHED starter
  // template must never shadow the real manuscript.
  it('an untouched seeded main.tex loses to a real uploaded document', () => {
    const r = resolveRootFile('main.tex', [
      { path: 'main.tex', content: DEFAULT_MAIN_TEX },
      { path: 'BW_EP_manuscript.tex', content: ROOT_DOC },
    ]);
    expect(r).toEqual({ rootFile: 'BW_EP_manuscript.tex', fellBack: true, reason: 'pristine-seed' });
  });

  it('an EDITED main.tex is respected as the root, even with other documents present', () => {
    const edited = DEFAULT_MAIN_TEX.replace('\\section{Introduction}', '\\section{Introduction}\nMy actual writing.');
    const r = resolveRootFile('main.tex', [
      { path: 'main.tex', content: edited },
      { path: 'BW_EP_manuscript.tex', content: ROOT_DOC },
    ]);
    expect(r).toEqual({ rootFile: 'main.tex', fellBack: false });
  });

  it('a fragment (no \\documentclass) never displaces the seed', () => {
    const r = resolveRootFile('main.tex', [
      { path: 'main.tex', content: DEFAULT_MAIN_TEX },
      { path: 'chapters/intro.tex', content: '\\section{Intro} fragment only' },
    ]);
    expect(r).toEqual({ rootFile: 'main.tex', fellBack: false });
  });
});

describe('POST /projects/:id/compile — missing root compiles the next .tex (live latexmk)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `rootfb ${Date.now()}` } });
    projectId = p.json().id;

    // Remove the seeded main.tex and add a differently-named root document.
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    const main = (list.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex');
    if (main) await app.inject({ method: 'DELETE', url: `/files/${main.id}`, headers: auth });
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'thesis.tex', content: ROOT_DOC },
    });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('compiles thesis.tex, persists it as the project root, and surfaces a warning diagnostic', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/compile`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; pdfUrl?: string; diagnostics: Array<{ severity: string; message: string }> };
    expect(body.status).toBe('success');
    expect(body.pdfUrl).toBeTruthy();

    const note = body.diagnostics.find((d) => /not found — compiled "thesis\.tex"/.test(d.message));
    expect(note?.severity).toBe('warning-important');

    // The fallback is persisted, so PDF serving / SyncTeX / review all agree.
    const project = await app.prisma.project.findUnique({ where: { id: projectId } });
    expect(project?.rootFile).toBe('thesis.tex');

    // And the produced PDF is servable.
    const pdf = await app.inject({ method: 'GET', url: `/projects/${projectId}/pdf`, headers: auth });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  }, 120000);
});

describe('POST /projects/:id/compile — untouched seed loses to an uploaded manuscript (live latexmk)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    // Fresh project: keeps its seeded, untouched main.tex.
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `seedfb ${Date.now()}` } });
    projectId = p.json().id;
    // The user uploads their real paper WITHOUT touching main.tex.
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'my_paper.tex', content: ROOT_DOC },
    });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('compiles the manuscript, not the placeholder, and persists it as root', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/compile`, headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; pdfUrl?: string; diagnostics: Array<{ severity: string; message: string }> };
    expect(body.status).toBe('success');
    expect(body.pdfUrl).toBeTruthy();

    const note = body.diagnostics.find((d) => /untouched starter template — compiled your document "my_paper\.tex"/.test(d.message));
    expect(note?.severity).toBe('warning-important');

    const project = await app.prisma.project.findUnique({ where: { id: projectId } });
    expect(project?.rootFile).toBe('my_paper.tex');
  }, 120000);
});
