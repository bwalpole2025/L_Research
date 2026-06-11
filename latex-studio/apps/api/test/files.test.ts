import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * File CRUD coverage. Requires a reachable Postgres (DATABASE_URL is loaded from
 * the repo-root .env by the `test` script). The suite creates an isolated
 * project and removes it afterwards, so it is safe to run against the dev DB.
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('file CRUD routes', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: auth,
      payload: { name: `vitest ${Date.now()}` },
    });
    expect(res.statusCode).toBe(201);
    projectId = res.json().id;
  });

  afterAll(async () => {
    if (projectId) {
      await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await app.close();
  });

  it('seeds a new project with main.tex', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    expect(res.statusCode).toBe(200);
    const files = res.json() as Array<{ path: string }>;
    expect(files.map((f) => f.path)).toContain('main.tex');
  });

  it('requires a bearer token', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/files` });
    expect(res.statusCode).toBe(401);
  });

  it('creates, reads, updates, and deletes a file', async () => {
    // Create
    const created = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'chapters/intro.tex', content: '\\section{Intro}' },
    });
    expect(created.statusCode).toBe(201);
    const fileId = created.json().id as string;
    expect(created.json().content).toBe('\\section{Intro}');

    // Read (with content)
    const read = await app.inject({ method: 'GET', url: `/files/${fileId}`, headers: auth });
    expect(read.statusCode).toBe(200);
    expect(read.json().content).toBe('\\section{Intro}');

    // Update content (autosave path)
    const patched = await app.inject({
      method: 'PATCH',
      url: `/files/${fileId}`,
      headers: auth,
      payload: { content: '\\section{Introduction}\nHello.' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().content).toBe('\\section{Introduction}\nHello.');

    // Rename (path change)
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/files/${fileId}`,
      headers: auth,
      payload: { path: 'chapters/introduction.tex' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().path).toBe('chapters/introduction.tex');

    // Delete
    const deleted = await app.inject({ method: 'DELETE', url: `/files/${fileId}`, headers: auth });
    expect(deleted.statusCode).toBe(204);

    // Gone
    const gone = await app.inject({ method: 'GET', url: `/files/${fileId}`, headers: auth });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects an invalid file path', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: '../escape.tex' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a disallowed extension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'notes.md' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 on a duplicate path', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'dup.tex' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'dup.tex' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('creates and restores a snapshot', async () => {
    // Edit main.tex, snapshot, edit again, then restore.
    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    const main = (list.json() as Array<{ id: string; path: string }>).find(
      (f) => f.path === 'main.tex',
    )!;

    await app.inject({
      method: 'PATCH',
      url: `/files/${main.id}`,
      headers: auth,
      payload: { content: 'SNAPSHOT-CONTENT' },
    });

    const snap = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/snapshots`,
      headers: auth,
      payload: { label: 'v1' },
    });
    expect(snap.statusCode).toBe(201);
    const snapshotId = snap.json().id as string;

    await app.inject({
      method: 'PATCH',
      url: `/files/${main.id}`,
      headers: auth,
      payload: { content: 'CHANGED-AFTER-SNAPSHOT' },
    });

    const restore = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/snapshots/${snapshotId}/restore`,
      headers: auth,
    });
    expect(restore.statusCode).toBe(200);

    const restoredFiles = restore.json() as Array<{ id: string; path: string }>;
    const restoredMain = restoredFiles.find((f) => f.path === 'main.tex')!;
    const content = await app.inject({ method: 'GET', url: `/files/${restoredMain.id}`, headers: auth });
    expect(content.json().content).toBe('SNAPSHOT-CONTENT');
  });
});
