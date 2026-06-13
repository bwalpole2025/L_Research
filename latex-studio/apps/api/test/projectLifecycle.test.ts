import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Project lifecycle — Archive + Trash. A project is ACTIVE until archived or
 * soft-deleted; the default list (and the editor) only ever see active projects.
 * Archive/unarchive and delete/restore are reversible; only purge is permanent,
 * and a project must be in the Trash before it can be purged. Runs against the
 * shared dev DB; everything is namespaced and cleaned up in afterAll.
 */

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const PREFIX = `pl-${Date.now()}`;

describe('Project lifecycle (archive + trash)', () => {
  let app: FastifyInstance;
  const ids: string[] = [];

  const newProject = async (name: string) => {
    const r = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `${PREFIX} ${name}` } });
    const p = r.json() as { id: string; archivedAt: string | null; deletedAt: string | null };
    ids.push(p.id);
    return p;
  };
  const list = async (view?: string) => {
    const r = await app.inject({ method: 'GET', url: view ? `/projects?view=${view}` : '/projects', headers: auth });
    return (r.json() as Array<{ id: string }>).map((p) => p.id);
  };

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
  });
  afterAll(async () => {
    for (const id of ids) await app.prisma.project.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it('a new project is active; both lifecycle flags are null', async () => {
    const p = await newProject('fresh');
    expect(p.archivedAt).toBeNull();
    expect(p.deletedAt).toBeNull();
    expect(await list()).toContain(p.id);
    expect(await list('archived')).not.toContain(p.id);
    expect(await list('deleted')).not.toContain(p.id);
  });

  it('archive removes it from the active list and into Archived; unarchive reverses it', async () => {
    const p = await newProject('to-archive');
    const arc = await app.inject({ method: 'POST', url: `/projects/${p.id}/archive`, headers: auth });
    expect(arc.statusCode).toBe(200);
    expect((arc.json() as { archivedAt: string | null }).archivedAt).not.toBeNull();

    expect(await list()).not.toContain(p.id); // gone from active (and the editor)
    expect(await list('archived')).toContain(p.id);

    await app.inject({ method: 'POST', url: `/projects/${p.id}/unarchive`, headers: auth });
    expect(await list()).toContain(p.id);
    expect(await list('archived')).not.toContain(p.id);
  });

  it('delete moves to Trash (restorable); restore brings it back active', async () => {
    const p = await newProject('to-delete');
    const del = await app.inject({ method: 'DELETE', url: `/projects/${p.id}`, headers: auth });
    expect(del.statusCode).toBe(200);
    expect((del.json() as { deletedAt: string | null }).deletedAt).not.toBeNull();

    expect(await list()).not.toContain(p.id);
    expect(await list('deleted')).toContain(p.id);

    await app.inject({ method: 'POST', url: `/projects/${p.id}/restore`, headers: auth });
    expect(await list()).toContain(p.id);
    expect(await list('deleted')).not.toContain(p.id);
  });

  it('restore clears an archive flag too (archived → deleted → restore = active)', async () => {
    const p = await newProject('arch-then-del');
    await app.inject({ method: 'POST', url: `/projects/${p.id}/archive`, headers: auth });
    await app.inject({ method: 'DELETE', url: `/projects/${p.id}`, headers: auth });
    expect(await list('deleted')).toContain(p.id);
    await app.inject({ method: 'POST', url: `/projects/${p.id}/restore`, headers: auth });
    const ids2 = await list();
    expect(ids2).toContain(p.id);
    expect(await list('archived')).not.toContain(p.id);
  });

  it('permanent delete is refused for an ACTIVE project, allowed once in Trash', async () => {
    const p = await newProject('purge-guard');
    const refused = await app.inject({ method: 'DELETE', url: `/projects/${p.id}/permanent`, headers: auth });
    expect(refused.statusCode).toBe(409); // must be trashed first

    await app.inject({ method: 'DELETE', url: `/projects/${p.id}`, headers: auth }); // → trash
    const purged = await app.inject({ method: 'DELETE', url: `/projects/${p.id}/permanent`, headers: auth });
    expect(purged.statusCode).toBe(200);

    // Gone for good — fetching it 404s.
    const gone = await app.inject({ method: 'GET', url: `/projects/${p.id}`, headers: auth });
    expect(gone.statusCode).toBe(404);
  });

  it('empty-trash purges every soft-deleted project (active + archived survive)', async () => {
    const live = await newProject('survivor-active');
    const arch = await newProject('survivor-archived');
    const doomed1 = await newProject('doomed-1');
    const doomed2 = await newProject('doomed-2');
    await app.inject({ method: 'POST', url: `/projects/${arch.id}/archive`, headers: auth });
    await app.inject({ method: 'DELETE', url: `/projects/${doomed1.id}`, headers: auth });
    await app.inject({ method: 'DELETE', url: `/projects/${doomed2.id}`, headers: auth });

    const res = await app.inject({ method: 'DELETE', url: '/projects-trash/purge', headers: auth });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { removed: number }).removed).toBeGreaterThanOrEqual(2);

    expect(await list('deleted')).not.toContain(doomed1.id);
    expect(await list('deleted')).not.toContain(doomed2.id);
    expect(await list()).toContain(live.id); // active survived
    expect(await list('archived')).toContain(arch.id); // archived survived
  });
});
