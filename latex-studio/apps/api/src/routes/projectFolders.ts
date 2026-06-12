import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ProjectFolder } from '@latex-studio/shared';

/**
 * APP-LEVEL project folders — the Home file-explorer. These group projects only;
 * they never touch a project's internal files/paths (no path cascade). Mirrors the
 * literature-library folder machinery in `library.ts` (flat parentId tree, the
 * cycle/collision guards, subtree capture → TrashEntry → restore), but app-scoped:
 * no projectId/tree. App-level trash rows are stored with `projectId = null` and
 * `kind = 'project-folder'`, kept separate from the per-project trash.
 */

const folderBody = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullable().optional() });
const folderPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), parentId: z.string().nullable().optional() });

function serializeFolder(f: { id: string; parentId: string | null; name: string; createdAt: Date }): ProjectFolder {
  return { id: f.id, parentId: f.parentId, name: f.name, createdAt: f.createdAt.toISOString() };
}

export async function projectFolderRoutes(app: FastifyInstance): Promise<void> {
  // True when a sibling folder already has `name` under `parentId`. NULL-parent
  // collisions need this check too (SQL treats NULLs as distinct in the unique key).
  async function folderCollision(parentId: string | null, name: string, excludeId?: string): Promise<boolean> {
    const found = await app.prisma.projectFolder.findFirst({
      where: { parentId, name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    return !!found;
  }

  // True when moving `folderId` under `newParentId` would create a cycle.
  async function wouldCycle(folderId: string, newParentId: string | null): Promise<boolean> {
    if (!newParentId) return false;
    if (newParentId === folderId) return true;
    let cur: string | null = newParentId;
    for (let i = 0; cur && i < 1000; i++) {
      const f: { parentId: string | null } | null = await app.prisma.projectFolder.findUnique({ where: { id: cur }, select: { parentId: true } });
      if (!f) break;
      if (f.parentId === folderId) return true;
      cur = f.parentId;
    }
    return false;
  }

  // ── Tree ──────────────────────────────────────────────────────────────────

  app.get('/project-folders', async () => {
    const folders = await app.prisma.projectFolder.findMany({ orderBy: { name: 'asc' } });
    return { folders: folders.map(serializeFolder) };
  });

  app.post('/project-folders', async (request, reply) => {
    const parsed = folderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const parentId = parsed.data.parentId ?? null;
    if (parentId) {
      const parent = await app.prisma.projectFolder.findUnique({ where: { id: parentId }, select: { id: true } });
      if (!parent) return reply.code(400).send({ error: 'Parent folder does not exist.' });
    }
    if (await folderCollision(parentId, parsed.data.name)) {
      return reply.code(409).send({ error: `A folder named “${parsed.data.name}” already exists here.` });
    }
    const folder = await app.prisma.projectFolder.create({ data: { name: parsed.data.name, parentId } });
    return reply.code(201).send(serializeFolder(folder));
  });

  app.patch<{ Params: { folderId: string } }>('/project-folders/:folderId', async (request, reply) => {
    const folder = await app.prisma.projectFolder.findUnique({ where: { id: request.params.folderId } });
    if (!folder) return reply.callNotFound();
    const parsed = folderPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const name = parsed.data.name ?? folder.name;
    const parentId = parsed.data.parentId === undefined ? folder.parentId : parsed.data.parentId;

    if (parsed.data.parentId !== undefined && (await wouldCycle(folder.id, parentId))) {
      return reply.code(409).send({ error: 'That move would create a cycle (a folder cannot contain itself).' });
    }
    if (await folderCollision(parentId, name, folder.id)) {
      return reply.code(409).send({ error: `A folder named “${name}” already exists in the destination.` });
    }

    const updated = await app.prisma.projectFolder.update({ where: { id: folder.id }, data: { name, parentId } });
    return serializeFolder(updated);
  });

  // Delete a folder + its subtree to trash. Projects in the subtree detach to root
  // (folderId → null via SetNull); their original assignments are captured so
  // restore can reattach them.
  app.delete<{ Params: { folderId: string } }>('/project-folders/:folderId', async (request, reply) => {
    const folder = await app.prisma.projectFolder.findUnique({ where: { id: request.params.folderId } });
    if (!folder) return reply.callNotFound();

    const allFolders = await app.prisma.projectFolder.findMany();
    const childrenOf = new Map<string | null, typeof allFolders>();
    for (const f of allFolders) {
      const list = childrenOf.get(f.parentId) ?? [];
      list.push(f);
      childrenOf.set(f.parentId, list);
    }
    const subtree: typeof allFolders = [];
    const stack = [folder];
    while (stack.length) {
      const f = stack.pop()!;
      subtree.push(f);
      stack.push(...(childrenOf.get(f.id) ?? []));
    }
    const folderIds = subtree.map((f) => f.id);
    const projects = await app.prisma.project.findMany({ where: { folderId: { in: folderIds } }, select: { id: true, folderId: true } });

    await app.prisma.$transaction(async (tx) => {
      await tx.trashEntry.create({
        data: {
          projectId: null,
          kind: 'project-folder',
          payload: {
            folders: subtree.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, createdAt: f.createdAt.toISOString() })),
            projectAssignments: projects.map((p) => ({ projectId: p.id, folderId: p.folderId })),
            rootName: folder.name,
          } as Prisma.InputJsonValue,
        },
      });
      // Deleting the folders detaches their projects to root (Project.folderId SetNull).
      await tx.projectFolder.deleteMany({ where: { id: { in: folderIds } } });
    });

    return { ok: true, trashedProjects: projects.length };
  });

  // ── App-level trash (deleted project folders) ───────────────────────────────

  app.get('/project-trash', async () => {
    const entries = await app.prisma.trashEntry.findMany({
      where: { projectId: null, kind: 'project-folder' },
      orderBy: { deletedAt: 'desc' },
    });
    return {
      items: entries.map((e) => {
        const payload = e.payload as Record<string, unknown>;
        const count = Array.isArray(payload.projectAssignments) ? payload.projectAssignments.length : 0;
        return {
          id: e.id,
          kind: 'project-folder' as const,
          label: `Folder “${String(payload.rootName ?? 'folder')}” (${count} project${count === 1 ? '' : 's'})`,
          deletedAt: e.deletedAt.toISOString(),
        };
      }),
    };
  });

  app.post<{ Params: { trashId: string } }>('/project-trash/:trashId/restore', async (request, reply) => {
    const entry = await app.prisma.trashEntry.findUnique({ where: { id: request.params.trashId } });
    if (!entry || entry.kind !== 'project-folder') return reply.callNotFound();
    const payload = entry.payload as Record<string, unknown>;
    const folders = (payload.folders as Array<{ id: string; parentId: string | null; name: string }>) ?? [];
    const assignments = (payload.projectAssignments as Array<{ projectId: string; folderId: string | null }>) ?? [];

    // Recreate folders parents-first so a child never references a missing parent.
    const placed = new Set<string>();
    let guard = 0;
    while (placed.size < folders.length && guard++ < 10000) {
      for (const f of folders) {
        if (placed.has(f.id)) continue;
        if (f.parentId && folders.some((p) => p.id === f.parentId) && !placed.has(f.parentId)) continue;
        await app.prisma.projectFolder.create({ data: { id: f.id, name: f.name, parentId: f.parentId } }).catch(() => undefined);
        placed.add(f.id);
      }
    }
    // Reattach projects that still exist (a project may have been moved/deleted since).
    for (const a of assignments) {
      await app.prisma.project.update({ where: { id: a.projectId }, data: { folderId: a.folderId } }).catch(() => undefined);
    }

    await app.prisma.trashEntry.delete({ where: { id: entry.id } });
    return { ok: true };
  });

  app.delete('/project-trash', async () => {
    const result = await app.prisma.trashEntry.deleteMany({ where: { projectId: null, kind: 'project-folder' } });
    return { ok: true, removed: result.count };
  });
}
