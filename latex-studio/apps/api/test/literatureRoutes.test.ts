import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Literature connector routes: search a source, and add a result to the library
 * with provenance. Uses CrossRef (pdf:false) so the add path is metadata-only —
 * deterministic, no PDF/extract pipeline. External calls are mocked.
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('literature connector routes', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN, connectorsMasterKey: 'bGl0LXJvdXRlcy10ZXN0LW1hc3Rlci1rZXktMzJieXRl' } });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `vitest-lit ${Date.now()}` } });
    projectId = res.json().id;
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await app.prisma.project.delete({ where: { id: projectId } });
    await app.close();
  });

  it('searches CrossRef and returns normalised results (data, not actions)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: { items: [{ DOI: '10/abc', title: ['On Waves'], author: [{ given: 'A', family: 'Author' }], issued: { 'date-parts': [[2019]] } }] } }), { status: 200 }),
      ),
    );
    const res = await app.inject({ method: 'GET', url: '/connectors/literature/crossref/search?q=waves', headers: auth });
    expect(res.statusCode).toBe(200);
    const { results } = res.json() as { results: Array<{ doi: string; source: string }> };
    expect(results[0]).toMatchObject({ doi: '10/abc', source: 'crossref' });
  });

  it('adds a CrossRef result to the library with source provenance (metadata-only)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: { DOI: '10/abc', title: ['On Waves'], author: [{ given: 'A', family: 'Author' }], issued: { 'date-parts': [[2019]] }, abstract: 'We study waves.' } }), { status: 200 }),
      ),
    );
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/library/from-literature`,
      headers: auth,
      payload: { source: 'crossref', externalId: '10/abc' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { item: { id: string; title: string }; pdfFetched: boolean };
    expect(body.pdfFetched).toBe(false); // CrossRef PDFs are not fetched
    expect(body.item.title).toBe('On Waves');

    const row = await app.prisma.literatureItem.findUnique({ where: { id: body.item.id } });
    expect(row?.source).toBe('crossref'); // provenance recorded
    expect(row?.doi).toBe('10/abc');
  });

  it('Zotero search without a key returns a clear connect prompt, not a crash', async () => {
    const res = await app.inject({ method: 'GET', url: '/connectors/literature/zotero/search?q=x', headers: auth });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toMatch(/API key/i);
  });

  it('storage list for a disconnected connector returns a 409 reconnect prompt, not a crash', async () => {
    const res = await app.inject({ method: 'GET', url: '/connectors/storage/dropbox/list', headers: auth });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { kind: string }).kind).toBe('needs_connect');
  });
});
