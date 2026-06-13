import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ModelProvider } from '@latex-studio/shared';
import { Writable } from 'node:stream';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';

/**
 * GDPR / data-custodian guarantees: logs carry no document content or bearer
 * token; permanent deletion leaves nothing orphaned (DB rows + workspace files);
 * the export is a complete, self-describing archive. Runs against the dev
 * Postgres; created projects are hard-deleted afterwards.
 */
const TOKEN = 'data-custodian-test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const SENTINEL = 'CUSTODIAN-SECRET-THESIS-9f3a';

const mockProvider: ModelProvider = {
  async *chatStream() {
    yield { text: '' };
  },
  async complete() {
    return '';
  },
  async editRegion() {
    return '';
  },
};

describe('data custodian: logging, erasure, export', () => {
  let app: FastifyInstance;
  const logs: string[] = [];
  const created: string[] = [];

  beforeAll(async () => {
    const logStream = new Writable({
      write(chunk, _enc, cb) {
        logs.push(chunk.toString());
        cb();
      },
    });
    app = await buildApp({ config: { bearerToken: TOKEN }, logStream, modelProvider: mockProvider });
    await app.ready();
  });

  afterAll(async () => {
    const { hardDeleteProject } = await import('../src/lib/hardDelete.js');
    for (const id of created) await hardDeleteProject(app, id).catch(() => undefined);
    await app.close();
  });

  async function newProject(name: string): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name } });
    const id = res.json().id as string;
    created.push(id);
    return id;
  }

  it('logs carry only metadata — no document content, no bearer token', async () => {
    const pid = await newProject(`ztmp-log ${Date.now()}`);
    await app.inject({ method: 'POST', url: `/projects/${pid}/files`, headers: auth, payload: { path: 'secret.tex', content: SENTINEL } });
    const list = await app.inject({ method: 'GET', url: `/projects/${pid}/files`, headers: auth });
    const fid = (list.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'secret.tex')!.id;
    await app.inject({ method: 'GET', url: `/files/${fid}`, headers: auth });
    await app.inject({ method: 'PATCH', url: `/files/${fid}`, headers: auth, payload: { content: `${SENTINEL} edited` } });

    const blob = logs.join('\n');
    expect(blob.length).toBeGreaterThan(0); // logging actually happened
    expect(blob).not.toContain(SENTINEL); // no document content
    expect(blob).not.toContain(TOKEN); // no credential
    expect(blob).toContain('/files/'); // metadata (path) IS logged — proves it logged at all
  });

  it('permanent deletion removes every DB row, workspace file, and non-FK row', async () => {
    const pid = await newProject(`ztmp-del ${Date.now()}`);
    // Cascade-covered rows.
    await app.inject({ method: 'POST', url: `/projects/${pid}/files`, headers: auth, payload: { path: 'a.tex', content: SENTINEL } });
    await app.inject({ method: 'POST', url: `/projects/${pid}/snapshots`, headers: auth, payload: { label: 's' } });
    await app.prisma.literatureItem.create({ data: { projectId: pid } });
    // Non-FK rows (the gaps): AiCallLog + project-scoped UsageStat.
    await app.prisma.aiCallLog.create({ data: { projectId: pid, route: 'chat', model: 'm', latencyMs: 1, ok: true } });
    await app.prisma.usageStat.create({ data: { scope: pid, key: 'cmd:x', count: 1, score: 1 } });
    // On-disk workspace (sources / literature PDFs live here).
    const workdir = join(app.config.compileWorkspace, pid);
    mkdirSync(workdir, { recursive: true });
    writeFileSync(join(workdir, 'main.tex'), 'x');
    expect(existsSync(workdir)).toBe(true);

    await app.inject({ method: 'DELETE', url: `/projects/${pid}`, headers: auth }); // soft-delete to Trash
    const purge = await app.inject({ method: 'DELETE', url: `/projects/${pid}/permanent`, headers: auth });
    expect(purge.statusCode).toBe(200);

    expect(await app.prisma.project.findUnique({ where: { id: pid } })).toBeNull();
    expect(await app.prisma.texFile.count({ where: { projectId: pid } })).toBe(0);
    expect(await app.prisma.snapshot.count({ where: { projectId: pid } })).toBe(0);
    expect(await app.prisma.literatureItem.count({ where: { projectId: pid } })).toBe(0);
    expect(await app.prisma.aiCallLog.count({ where: { projectId: pid } })).toBe(0);
    expect(await app.prisma.usageStat.count({ where: { scope: pid } })).toBe(0);
    expect(existsSync(workdir)).toBe(false);
  });

  it('export produces a complete archive (sources + metadata + literature)', async () => {
    const pid = await newProject(`ztmp-exp ${Date.now()}`);
    await app.inject({ method: 'POST', url: `/projects/${pid}/files`, headers: auth, payload: { path: 'chapters/intro.tex', content: SENTINEL } });

    const res = await app.inject({ method: 'GET', url: `/projects/${pid}/export?pdf=1&literature=1`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const zip = res.rawPayload.toString('latin1'); // zip stores entry names in cleartext headers
    expect(zip).toContain('metadata.json'); // project settings + manifest
    expect(zip).toContain('main.tex'); // seeded source
    expect(zip).toContain('chapters/intro.tex'); // nested source
    expect(res.rawPayload.length).toBeGreaterThan(200); // a real archive, not an error page
  });
});
