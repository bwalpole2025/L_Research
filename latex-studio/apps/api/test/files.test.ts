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
      payload: { path: 'notes.zip' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a .bst bibliography style file as editable text', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'jfm.bst', content: 'ENTRY { author title } {} { label }' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().encoding).toBe('utf8'); // text, not base64 — editable
    expect(res.json().content).toBe('ENTRY { author title } {} { label }');
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

describe('binary file upload', () => {
  let app: FastifyInstance;
  let projectId: string;
  // 1x1 transparent PNG.
  const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `upload ${Date.now()}` } });
    projectId = res.json().id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('stores a base64 image and round-trips encoding + content', async () => {
    const create = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'figures/logo.png', content: PNG_BASE64, encoding: 'base64' },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json().encoding).toBe('base64');

    const list = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    const meta = (list.json() as Array<{ path: string; encoding: string }>).find((f) => f.path === 'figures/logo.png');
    expect(meta?.encoding).toBe('base64');

    const read = await app.inject({ method: 'GET', url: `/files/${create.json().id}`, headers: auth });
    expect(read.json().content).toBe(PNG_BASE64);
  });

  it('rejects a binary file sent without base64 encoding', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'figures/bad.png', content: 'not-base64-text' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a disallowed extension', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'evil.exe', content: 'x', encoding: 'base64' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('runner.writeFiles decodes binary', () => {
  it('writes base64 content as decoded bytes and utf8 as text', async () => {
    const { createRunner } = await import('../src/compile/runner.js');
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'ls-runner-'));
    try {
      const runner = createRunner({ compileWorkspace: dir, texliveWorkspace: '/workspace' } as never);
      const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff]);
      await runner.writeFiles('proj', [
        { path: 'figs/a.png', content: bytes.toString('base64'), encoding: 'base64' },
        { path: 'main.tex', content: '\\documentclass{article}', encoding: 'utf8' },
      ]);
      const png = await readFile(join(dir, 'proj', 'figs/a.png'));
      expect(png.equals(bytes)).toBe(true);
      const tex = await readFile(join(dir, 'proj', 'main.tex'), 'utf8');
      expect(tex).toBe('\\documentclass{article}');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
