import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const PDF_B64 = readFileSync(fileURLToPath(new URL('./fixtures/cornish2018.pdf.b64', import.meta.url)), 'utf8').trim();

describe('Literature library + citation linking + trash', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `library ${Date.now()}` } });
    projectId = p.json().id;
    // Cite both a key we'll link (cornish2018) and one we won't (ghostref).
    const main = (await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth }).then((r) => r.json() as Array<{ id: string; path: string }>)).find((f) => f.path === 'main.tex')!;
    await app.inject({ method: 'PATCH', url: `/files/${main.id}`, headers: auth, payload: { content: 'We use the multiple scales expansion method \\cite{cornish2018}. Also \\cite{ghostref}.' } });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('rejects a sibling name collision and a cyclic move with clear messages', async () => {
    const a = await app.inject({ method: 'POST', url: `/projects/${projectId}/library/folders`, headers: auth, payload: { name: 'Topic A' } });
    expect(a.statusCode).toBe(201);
    const dup = await app.inject({ method: 'POST', url: `/projects/${projectId}/library/folders`, headers: auth, payload: { name: 'Topic A' } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatch(/already exists/i);

    const parent = a.json().id;
    const child = await app.inject({ method: 'POST', url: `/projects/${projectId}/library/folders`, headers: auth, payload: { name: 'Sub', parentId: parent } });
    // Move the parent under its own child → cycle.
    const cyc = await app.inject({ method: 'PATCH', url: `/library/folders/${parent}`, headers: auth, payload: { parentId: child.json().id } });
    expect(cyc.statusCode).toBe(409);
    expect(cyc.json().error).toMatch(/cycle/i);
  });

  it('uploads a PDF, extracts its text, and full-text-searches the library', async () => {
    const folder = await app.inject({ method: 'POST', url: `/projects/${projectId}/library/folders`, headers: auth, payload: { name: 'Methods' } });
    const up = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/library/items`,
      headers: auth,
      payload: { fileName: 'cornish2018.pdf', fileBase64: PDF_B64, folderId: folder.json().id },
    });
    expect(up.statusCode).toBe(201);
    expect(up.json().hasText).toBe(true);
    expect(up.json().fileSizeBytes).toBeGreaterThan(0);

    const search = await app.inject({ method: 'GET', url: `/projects/${projectId}/library/search?q=multiple%20scales`, headers: auth });
    expect((search.json().items as Array<{ id: string }>).length).toBeGreaterThanOrEqual(1);
  }, 30000);

  it('PAYOFF: a linked cite key resolves "full-text (library)" in Document Review; an unlinked key stays metadata-only', async () => {
    const items = await app.inject({ method: 'GET', url: `/projects/${projectId}/library`, headers: auth }).then((r) => r.json() as { items: Array<{ id: string }> });
    const itemId = items.items[0]!.id;
    await app.inject({ method: 'POST', url: `/library/items/${itemId}/link`, headers: auth, payload: { citeKey: 'cornish2018' } });

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/review`, headers: auth, payload: { scope: 'project', deterministicOnly: true } });
    expect(res.statusCode).toBe(200);
    const refs = res.json().references as Array<{ key: string; provenance: string; library?: boolean }>;
    const cornish = refs.find((r) => r.key === 'cornish2018');
    expect(cornish?.provenance).toBe('full-text');
    expect(cornish?.library).toBe(true);
    const ghost = refs.find((r) => r.key === 'ghostref');
    expect(ghost?.provenance).not.toBe('full-text'); // metadata-only / not-found — never fabricated
    expect(ghost?.library).toBeFalsy();
  }, 30000);

  it('generates a .bib entry from an article and links it', async () => {
    const item = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/library/items`,
      headers: auth,
      payload: { fileName: 'smith.pdf', fileBase64: PDF_B64 },
    }).then((r) => r.json() as { id: string });
    await app.inject({ method: 'PATCH', url: `/library/items/${item.id}`, headers: auth, payload: { authors: 'Jane Smith', year: '2021', title: 'A study' } });
    const gen = await app.inject({ method: 'POST', url: `/library/items/${item.id}/generate-bib`, headers: auth, payload: {} });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().citeKey).toMatch(/smith2021/);
    const keys = await app.inject({ method: 'GET', url: `/projects/${projectId}/library/cite-keys`, headers: auth });
    expect((keys.json().keys as string[]).some((k) => /smith2021/.test(k))).toBe(true);
  }, 30000);

  it('deletes a folder of articles to trash, restores the subtree, then empties trash', async () => {
    const folder = await app.inject({ method: 'POST', url: `/projects/${projectId}/library/folders`, headers: auth, payload: { name: 'ToDelete' } }).then((r) => r.json() as { id: string });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/library/items`, headers: auth, payload: { fileName: 'x.pdf', fileBase64: PDF_B64, folderId: folder.id } });

    const del = await app.inject({ method: 'DELETE', url: `/library/folders/${folder.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    expect(del.json().trashedItems).toBe(1);

    const trash = await app.inject({ method: 'GET', url: `/projects/${projectId}/trash`, headers: auth });
    const entry = (trash.json().items as Array<{ id: string; kind: string }>).find((t) => t.kind === 'folder')!;
    expect(entry).toBeTruthy();

    const restore = await app.inject({ method: 'POST', url: `/projects/${projectId}/trash/${entry.id}/restore`, headers: auth });
    expect(restore.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: `/projects/${projectId}/library`, headers: auth }).then((r) => r.json() as { folders: Array<{ id: string }> });
    expect(after.folders.some((f) => f.id === folder.id)).toBe(true);

    const empty = await app.inject({ method: 'DELETE', url: `/projects/${projectId}/trash`, headers: auth });
    expect(empty.statusCode).toBe(200);
    const trash2 = await app.inject({ method: 'GET', url: `/projects/${projectId}/trash`, headers: auth });
    expect((trash2.json().items as unknown[]).length).toBe(0);
  }, 30000);
});
