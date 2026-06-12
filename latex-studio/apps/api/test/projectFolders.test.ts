import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * App-level project folders (the Home explorer): nesting, the cycle/collision
 * guards, moving a project between folders, and folder delete → trash → restore →
 * empty. Runs against the shared dev DB (like library.test.ts), so everything is
 * namespaced with a unique prefix and cleaned up in afterAll — including only the
 * trash entries this test created.
 */

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const PREFIX = `pf-${Date.now()}`;

describe('Project folders (Home explorer)', () => {
  let app: FastifyInstance;
  const projectIds: string[] = [];
  const folderIds: string[] = [];

  const newProject = async (name: string, folderId?: string | null) => {
    const r = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `${PREFIX} ${name}`, ...(folderId !== undefined ? { folderId } : {}) } });
    const p = r.json() as { id: string; folderId: string | null };
    projectIds.push(p.id);
    return p;
  };
  const newFolder = async (name: string, parentId?: string | null) => {
    const r = await app.inject({ method: 'POST', url: '/project-folders', headers: auth, payload: { name: `${PREFIX} ${name}`, ...(parentId !== undefined ? { parentId } : {}) } });
    return r;
  };

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
  });

  afterAll(async () => {
    for (const id of projectIds) await app.prisma.project.delete({ where: { id } }).catch(() => undefined);
    for (const id of folderIds) await app.prisma.projectFolder.delete({ where: { id } }).catch(() => undefined);
    // Remove only the project-folder trash entries this test left behind.
    const stray = await app.prisma.trashEntry.findMany({ where: { kind: 'project-folder' } });
    for (const e of stray) {
      const root = String((e.payload as Record<string, unknown>).rootName ?? '');
      if (root.startsWith(PREFIX)) await app.prisma.trashEntry.delete({ where: { id: e.id } }).catch(() => undefined);
    }
    await app.close();
  });

  it('creates nested folders and rejects sibling collisions and cyclic moves', async () => {
    const a = await newFolder('Ferrofluid');
    expect(a.statusCode).toBe(201);
    const parent = a.json().id as string;
    folderIds.push(parent);

    const dup = await newFolder('Ferrofluid');
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatch(/already exists/i);

    const sub = await newFolder('Inner', parent);
    expect(sub.statusCode).toBe(201);
    const child = sub.json().id as string;
    folderIds.push(child);

    // Move the parent under its own child → cycle.
    const cyc = await app.inject({ method: 'PATCH', url: `/project-folders/${parent}`, headers: auth, payload: { parentId: child } });
    expect(cyc.statusCode).toBe(409);
    expect(cyc.json().error).toMatch(/cycle/i);

    const tree = await app.inject({ method: 'GET', url: '/project-folders', headers: auth }).then((r) => r.json() as { folders: Array<{ id: string; parentId: string | null }> });
    expect(tree.folders.find((f) => f.id === child)?.parentId).toBe(parent);
  });

  it('moves a project into a folder and back to the root (folderId only)', async () => {
    const folder = await newFolder('Plateau border');
    const fid = folder.json().id as string;
    folderIds.push(fid);

    const p = await newProject('border-study');
    expect(p.folderId).toBeNull();

    const moved = await app.inject({ method: 'PATCH', url: `/projects/${p.id}`, headers: auth, payload: { folderId: fid } });
    expect(moved.statusCode).toBe(200);
    expect((moved.json() as { folderId: string | null }).folderId).toBe(fid);

    const back = await app.inject({ method: 'PATCH', url: `/projects/${p.id}`, headers: auth, payload: { folderId: null } });
    expect((back.json() as { folderId: string | null }).folderId).toBeNull();

    // A non-existent target folder is rejected.
    const bad = await app.inject({ method: 'PATCH', url: `/projects/${p.id}`, headers: auth, payload: { folderId: 'nope' } });
    expect(bad.statusCode).toBe(400);
  });

  it('deletes a folder to trash, restores the subtree with its projects, then empties trash', async () => {
    const folder = await newFolder('Doomed');
    const fid = folder.json().id as string;
    folderIds.push(fid);
    const sub = await newFolder('DoomedChild', fid);
    const subId = sub.json().id as string;
    folderIds.push(subId);
    const p = await newProject('inside', subId);
    expect(p.folderId).toBe(subId);

    // Delete the top folder → subtree to trash, project detaches to root.
    const del = await app.inject({ method: 'DELETE', url: `/project-folders/${fid}`, headers: auth });
    expect(del.statusCode).toBe(200);
    expect(del.json().trashedProjects).toBe(1);
    const detached = await app.inject({ method: 'GET', url: `/projects/${p.id}`, headers: auth }).then((r) => r.json() as { folderId: string | null });
    expect(detached.folderId).toBeNull();

    // It's in trash.
    const trash = await app.inject({ method: 'GET', url: '/project-trash', headers: auth }).then((r) => r.json() as { items: Array<{ id: string; label: string }> });
    const entry = trash.items.find((t) => t.label.includes(`${PREFIX} Doomed`))!;
    expect(entry).toBeTruthy();

    // Restore → folders return (ids preserved) and the project reattaches.
    const restore = await app.inject({ method: 'POST', url: `/project-trash/${entry.id}/restore`, headers: auth });
    expect(restore.statusCode).toBe(200);
    const folders = await app.inject({ method: 'GET', url: '/project-folders', headers: auth }).then((r) => r.json() as { folders: Array<{ id: string }> });
    expect(folders.folders.some((f) => f.id === fid)).toBe(true);
    expect(folders.folders.some((f) => f.id === subId)).toBe(true);
    const reattached = await app.inject({ method: 'GET', url: `/projects/${p.id}`, headers: auth }).then((r) => r.json() as { folderId: string | null });
    expect(reattached.folderId).toBe(subId);

    // Delete again, then empty trash → the entry is permanently gone.
    await app.inject({ method: 'DELETE', url: `/project-folders/${fid}`, headers: auth });
    const empty = await app.inject({ method: 'DELETE', url: '/project-trash', headers: auth });
    expect(empty.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/project-trash', headers: auth }).then((r) => r.json() as { items: Array<{ label: string }> });
    expect(after.items.some((t) => t.label.includes(`${PREFIX} Doomed`))).toBe(false);
  });
});
