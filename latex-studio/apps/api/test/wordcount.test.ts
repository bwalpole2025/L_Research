import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { WordCountResult } from '@latex-studio/shared';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

/** Live texcount: a known multi-file document returns an accurate total + a
 *  per-file/included-file breakdown that follows \input. */
describe('word count (live texcount)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let mainId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `wc ${Date.now()}` } });
    projectId = p.json().id;
    const files = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    mainId = (files.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!.id;
    // main has 4 words of text, includes ch1 (8 words). Total = 12.
    await app.inject({ method: 'PATCH', url: `/files/${mainId}`, headers: auth, payload: { content: '\\documentclass{article}\n\\begin{document}\nIntro has four words.\n\\input{ch1}\n\\end{document}\n' } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'ch1.tex', content: 'Chapter one body with seven words total here.\n' } });
  });
  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('totals match texcount and break down per included file', async () => {
    const r = await app.inject({ method: 'GET', url: `/projects/${projectId}/wordcount`, headers: auth });
    expect(r.statusCode).toBe(200);
    const wc = r.json() as WordCountResult;
    expect(wc.total.words).toBe(12);
    const byFile = Object.fromEntries(wc.files.map((f) => [f.file, f.words]));
    expect(byFile['main.tex']).toBe(4);
    expect(byFile['ch1.tex']).toBe(8);
  }, 60000);
});
