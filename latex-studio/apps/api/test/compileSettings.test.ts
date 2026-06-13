import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { latexmkFlags } from '../src/compile/runner.js';

/** Engine + halt-on-error + draft → latexmk flags, and a live compile per engine. */
describe('compile settings — latexmk flags', () => {
  it('maps engines to -pdf / -pdfxe / -pdflua (default pdflatex)', () => {
    expect(latexmkFlags()).toContain('-pdf');
    expect(latexmkFlags({ engine: 'pdflatex' })).toContain('-pdf');
    expect(latexmkFlags({ engine: 'xelatex' })).toContain('-pdfxe');
    expect(latexmkFlags({ engine: 'lualatex' })).toContain('-pdflua');
    // unknown → safe default
    expect(latexmkFlags({ engine: 'totallatex' as 'pdflatex' })).toContain('-pdf');
    // base flags always present (SyncTeX + diagnostics keep working)
    for (const f of ['-interaction=nonstopmode', '-synctex=1', '-file-line-error']) {
      expect(latexmkFlags()).toContain(f);
    }
  });

  it('halt-on-error and draft are opt-in flags', () => {
    expect(latexmkFlags()).not.toContain('-halt-on-error');
    expect(latexmkFlags({ haltOnError: true })).toContain('-halt-on-error');
    const draft = latexmkFlags({ draftMode: true });
    expect(draft.some((f) => f.startsWith('-usepretex=') && f.includes('draft') && f.includes('graphicx'))).toBe(true);
    expect(latexmkFlags()).not.toContain(latexmkFlags({ draftMode: true }).find((f) => f.startsWith('-usepretex=')) ?? 'x');
  });
});

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('compile settings — live engines + persistence', () => {
  let app: FastifyInstance;
  let projectId: string;
  let fileId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `engine ${Date.now()}` } });
    projectId = p.json().id;
    const files = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    fileId = (files.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!.id;
    await app.inject({ method: 'PATCH', url: `/files/${fileId}`, headers: auth, payload: { content: '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nHi $x^2$.\n\\end{document}\n' } });
  });
  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  const setEngine = (texEngine: string) => app.inject({ method: 'PATCH', url: `/projects/${projectId}`, headers: auth, payload: { texEngine } });
  const compile = async () => {
    const r = await app.inject({ method: 'POST', url: `/projects/${projectId}/compile`, headers: auth });
    return r.json() as { status: string; pdfUrl?: string };
  };

  it('the engine choice persists and compiles with pdfLaTeX, XeLaTeX and LuaLaTeX', async () => {
    for (const engine of ['pdflatex', 'xelatex', 'lualatex'] as const) {
      const patched = await setEngine(engine);
      expect((patched.json() as { texEngine: string }).texEngine).toBe(engine);
      // persisted: a fresh GET reflects it
      const got = await app.inject({ method: 'GET', url: `/projects/${projectId}`, headers: auth });
      expect((got.json() as { texEngine: string }).texEngine).toBe(engine);
      const body = await compile();
      expect(body.status, `engine ${engine}`).toBe('success');
      expect(body.pdfUrl).toBeTruthy();
    }
  }, 180000);

  it('rejects an invalid engine (zod enum)', async () => {
    const r = await app.inject({ method: 'PATCH', url: `/projects/${projectId}`, headers: auth, payload: { texEngine: 'wordstar' } });
    expect(r.statusCode).toBe(400);
  });
});
