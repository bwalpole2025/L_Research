import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChatDelta, ChatRequest, EditRequest, ModelProvider } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { classifyRoute } from '../src/plugins/ownership.js';

const TOKEN = 'ownership-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const FOREIGN = 'some-other-user';

class MockProvider implements ModelProvider {
  async *chatStream(_req: ChatRequest): AsyncIterable<ChatDelta> {
    yield { text: 'ok' };
  }
  async complete(): Promise<string> {
    return 'ok';
  }
  async editRegion(_req: EditRequest): Promise<string> {
    return 'ok';
  }
}

describe('ownership guard — classifyRoute (no-bypass audit)', () => {
  it('classifies every kind of route', () => {
    expect(classifyRoute('GET', '/healthz')).toEqual({ kind: 'public' });
    expect(classifyRoute('GET', '/connectors/:id/callback')).toEqual({ kind: 'public' });
    expect(classifyRoute('GET', '/projects')).toEqual({ kind: 'principal' });
    expect(classifyRoute('GET', '/mathcheck/parse')).toEqual({ kind: 'principal' });
    // path param
    expect(classifyRoute('POST', '/projects/:id/compile')).toMatchObject({
      kind: 'project',
      resolver: { from: 'param', name: 'id' },
    });
    expect(classifyRoute('POST', '/projects/:projectId/storage/:id/import')).toMatchObject({
      resolver: { from: 'param', name: 'projectId' },
    });
    // body
    expect(classifyRoute('POST', '/synctex/forward')).toMatchObject({
      resolver: { from: 'body', name: 'projectId' },
    });
    // child id (the IDOR-fixed routes)
    expect(classifyRoute('GET', '/files/:id')).toMatchObject({ resolver: { from: 'child', model: 'texFile' } });
    expect(classifyRoute('DELETE', '/chat/threads/:tid')).toMatchObject({ resolver: { from: 'child', model: 'chatThread' } });
    expect(classifyRoute('PATCH', '/library/items/:itemId')).toMatchObject({ resolver: { from: 'child', model: 'literatureItem' } });
    expect(classifyRoute('PATCH', '/library/folders/:folderId')).toMatchObject({ resolver: { from: 'child', model: 'folder' } });
  });

  it('returns null for an unknown route (would fail the boot audit)', () => {
    expect(classifyRoute('GET', '/totally/new/route')).toBeNull();
  });
});

describe('ownership guard — enforcement + IDOR', () => {
  let app: FastifyInstance;
  let owned: string; // project owned by the bearer principal (userId null)
  let foreign: string; // project flipped to a different owner
  let foreignThread: string;
  let foreignFile: string;
  let foreignItem: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: new MockProvider() });
    await app.ready();

    const a = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `owned ${Date.now()}` } });
    owned = a.json().id;
    const b = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `foreign ${Date.now()}` } });
    foreign = b.json().id;

    // Children of the foreign project, created while still owned.
    foreignThread = (await app.prisma.chatThread.create({ data: { projectId: foreign, title: 't' } })).id;
    foreignFile = (await app.prisma.texFile.create({ data: { projectId: foreign, path: 'x.tex', content: 'hi' } })).id;
    foreignItem = (await app.prisma.literatureItem.create({ data: { projectId: foreign, title: 'paper' } })).id;

    // Hand the foreign project to a different owner — the bearer principal (userId
    // null) must no longer reach it or any of its children.
    await app.prisma.project.update({ where: { id: foreign }, data: { userId: FOREIGN } });
  });

  afterAll(async () => {
    for (const id of [owned, foreign]) {
      await app.prisma.project.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  it('newly created projects are stamped with the principal (null today) and are reachable', async () => {
    const created = await app.prisma.project.findUnique({ where: { id: owned }, select: { userId: true } });
    expect(created?.userId).toBeNull(); // single-user: unowned
    const res = await app.inject({ method: 'GET', url: `/projects/${owned}`, headers: auth });
    expect(res.statusCode).toBe(200);
  });

  it('the project list excludes a project owned by someone else', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects', headers: auth });
    const ids = (res.json() as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(owned);
    expect(ids).not.toContain(foreign);
  });

  it('rejects a project-scoped route for a project the principal does not own', async () => {
    expect((await app.inject({ method: 'GET', url: `/projects/${foreign}`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/projects/${foreign}/files`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/projects/${foreign}/compile`, headers: auth, payload: {} })).statusCode).toBe(404);
  });

  it('rejects by-id child routes whose parent project is owned by someone else (IDOR)', async () => {
    // chat thread (the route the review flagged): /chat/threads/:tid
    expect((await app.inject({ method: 'GET', url: `/chat/threads/${foreignThread}/messages`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/chat/threads/${foreignThread}`, headers: auth })).statusCode).toBe(404);
    // library item (the other flagged route): /library/items/:itemId
    expect((await app.inject({ method: 'PATCH', url: `/library/items/${foreignItem}`, headers: auth, payload: { title: 'hacked' } })).statusCode).toBe(404);
    // and the analogous file by-id route
    expect((await app.inject({ method: 'GET', url: `/files/${foreignFile}`, headers: auth })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/files/${foreignFile}`, headers: auth, payload: { content: 'hacked' } })).statusCode).toBe(404);
  });

  it('the rejected writes did not mutate the foreign resources', async () => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: foreignItem } });
    expect(item?.title).toBe('paper'); // not 'hacked'
    const file = await app.prisma.texFile.findUnique({ where: { id: foreignFile } });
    expect(file?.content).toBe('hi'); // not 'hacked'
    const thread = await app.prisma.chatThread.findUnique({ where: { id: foreignThread } });
    expect(thread).not.toBeNull(); // not deleted
  });

  it('still serves owned by-id resources normally (single-user unchanged)', async () => {
    const f = await app.prisma.texFile.create({ data: { projectId: owned, path: 'a.tex', content: 'hello' } });
    const res = await app.inject({ method: 'GET', url: `/files/${f.id}`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: f.id, content: 'hello' });
  });
});

describe('TexFile optimistic lock (version)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: new MockProvider() });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `lock ${Date.now()}` } });
    projectId = p.json().id;
  });

  afterAll(async () => {
    await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('exposes version, increments it on save, and rejects a stale write with 409', async () => {
    const created = (
      await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'lock.tex', content: 'v0' } })
    ).json();
    expect(created.version).toBe(0);

    // Save without a version → unchanged behaviour, but version advances.
    const s1 = await app.inject({ method: 'PATCH', url: `/files/${created.id}`, headers: auth, payload: { content: 'v1' } });
    expect(s1.statusCode).toBe(200);
    expect(s1.json().version).toBe(1);

    // Save WITH the current version → succeeds.
    const s2 = await app.inject({ method: 'PATCH', url: `/files/${created.id}`, headers: auth, payload: { content: 'v2', version: 1 } });
    expect(s2.statusCode).toBe(200);
    expect(s2.json().version).toBe(2);

    // Save WITH a stale version → 409, content untouched.
    const stale = await app.inject({ method: 'PATCH', url: `/files/${created.id}`, headers: auth, payload: { content: 'should-not-apply', version: 0 } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().currentVersion).toBe(2);
    const after = await app.prisma.texFile.findUnique({ where: { id: created.id } });
    expect(after?.content).toBe('v2');
  });
});
