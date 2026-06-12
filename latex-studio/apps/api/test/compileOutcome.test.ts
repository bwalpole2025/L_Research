import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * THE RED RULE, live (real latexmk): red errors appear ONLY when the run
 * produced no PDF. A document with a TeX error that nonstop mode recovers from
 * still emits a PDF → its `!` entries are ORANGE; a document that cannot
 * produce any output stays RED.
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('compile outcome rule (live latexmk)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let fileId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `outcome ${Date.now()}` } });
    projectId = p.json().id;
    const files = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    fileId = (files.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!.id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  const setMain = (content: string) =>
    app.inject({ method: 'PATCH', url: `/files/${fileId}`, headers: auth, payload: { content } });

  const compile = async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/compile`, headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json() as { status: string; pdfUrl?: string; diagnostics: Array<{ severity: string; category?: string }> };
  };

  it('an undefined control sequence that still yields a PDF: status success, ORANGE entry, no red', async () => {
    await setMain('\\documentclass{article}\n\\begin{document}\nBefore \\undefinedcmd after.\n\\end{document}\n');
    const body = await compile();
    expect(body.status).toBe('success');
    expect(body.pdfUrl).toBeTruthy();
    expect(body.diagnostics.some((d) => d.severity === 'error')).toBe(false);
    expect(body.diagnostics.some((d) => d.severity === 'warning-important' && d.category === 'undefined-control-sequence')).toBe(true);
  }, 120000);

  it('a document that produces NO output keeps RED errors and status error', async () => {
    await setMain('\\undefinedcmd\n');
    const body = await compile();
    expect(body.status).toBe('error');
    expect(body.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  }, 120000);
});
