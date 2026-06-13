import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getModels } from '../ai/models.js';
import { isAcceptableModel } from '../providers/index.js';
import { DEFAULT_MAIN_TEX } from '../lib/seedTemplate.js';
import { hardDeleteProject } from '../lib/hardDelete.js';
import { ownedProjectsWhere } from '../auth/principal.js';

const createProjectBody = z.object({
  name: z.string().trim().min(1).max(200),
  // Home folder to create the project in; null/omitted = root ("Unfiled").
  folderId: z.string().nullable().optional(),
});

const updateProjectBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  rootFile: z.string().trim().min(1).max(512).optional(),
  macros: z.record(z.string(), z.string()).optional(),
  assumptions: z.string().max(4000).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  aiInstructions: z.string().max(8000).optional(),
  // Which model CONNECTOR powers AI (Claude/ChatGPT/Gemini). Auth via the CLI.
  aiProvider: z.enum(['anthropic', 'chatgpt', 'gemini']).optional(),
  // Move the project between Home folders; null = root. Purely organisational.
  folderId: z.string().nullable().optional(),
  // Python "Run" settings.
  pythonRunTarget: z.string().max(512).optional(),
  networkEnabled: z.boolean().optional(),
  // Compile settings.
  texEngine: z.enum(['pdflatex', 'xelatex', 'lualatex']).optional(),
  haltOnError: z.boolean().optional(),
  draftMode: z.boolean().optional(),
});

/** Serialise a Project row to the shared `Project` shape (ISO timestamps). */
function serialiseProject(p: {
  id: string;
  name: string;
  rootFile: string;
  createdAt: Date;
  updatedAt: Date;
  folderId: string | null;
  macros: Prisma.JsonValue | null;
  assumptions: string;
  model: string;
  aiInstructions: string;
  aiProvider: string;
  pythonRunTarget: string;
  networkEnabled: boolean;
  archivedAt: Date | null;
  deletedAt: Date | null;
  texEngine: string;
  haltOnError: boolean;
  draftMode: boolean;
}) {
  return {
    id: p.id,
    name: p.name,
    rootFile: p.rootFile,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    folderId: p.folderId,
    macros: (p.macros as Record<string, string> | null) ?? {},
    assumptions: p.assumptions ?? '',
    model: p.model,
    aiInstructions: p.aiInstructions ?? '',
    aiProvider: p.aiProvider ?? 'anthropic',
    pythonRunTarget: p.pythonRunTarget ?? '',
    networkEnabled: p.networkEnabled ?? false,
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    texEngine: p.texEngine ?? 'pdflatex',
    haltOnError: p.haltOnError ?? false,
    draftMode: p.draftMode ?? false,
  };
}

/** Validate a folderId target: null is the root; otherwise the folder must exist. */
async function folderExists(app: FastifyInstance, folderId: string | null): Promise<boolean> {
  if (folderId === null) return true;
  const found = await app.prisma.projectFolder.findUnique({ where: { id: folderId }, select: { id: true } });
  return !!found;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // List projects (newest first). `view` selects the lifecycle bucket:
  //   active (default) — both archivedAt + deletedAt NULL; the only view the
  //                      editor ever uses, so archived/deleted never appear there.
  //   archived         — archivedAt set, not deleted.
  //   deleted          — deletedAt set (in Trash).
  const listQuery = z.object({ view: z.enum(['active', 'archived', 'deleted']).default('active') });
  app.get<{ Querystring: { view?: string } }>('/projects', async (request) => {
    const view = listQuery.safeParse(request.query).data?.view ?? 'active';
    const lifecycle: Prisma.ProjectWhereInput =
      view === 'archived'
        ? { archivedAt: { not: null }, deletedAt: null }
        : view === 'deleted'
          ? { deletedAt: { not: null } }
          : { archivedAt: null, deletedAt: null };
    // Only ever list projects the principal owns (today: all, since unowned).
    const where: Prisma.ProjectWhereInput = { ...lifecycle, ...ownedProjectsWhere(request.principal) };
    const orderBy: Prisma.ProjectOrderByWithRelationInput =
      view === 'deleted' ? { deletedAt: 'desc' } : view === 'archived' ? { archivedAt: 'desc' } : { updatedAt: 'desc' };
    const projects = await app.prisma.project.findMany({ where, orderBy });
    return projects.map(serialiseProject);
  });

  // ── Lifecycle: archive / trash / restore / purge ────────────────────────────
  // A reusable setter for the soft-state flags; returns the serialised project.
  async function setLifecycle(id: string, data: { archivedAt?: Date | null; deletedAt?: Date | null }, reply: import('fastify').FastifyReply) {
    const existing = await app.prisma.project.findUnique({ where: { id } });
    if (!existing) return reply.callNotFound();
    const project = await app.prisma.project.update({ where: { id }, data });
    return serialiseProject(project);
  }

  // Archive (set aside) / unarchive.
  app.post<{ Params: { id: string } }>('/projects/:id/archive', (request, reply) => setLifecycle(request.params.id, { archivedAt: new Date() }, reply));
  app.post<{ Params: { id: string } }>('/projects/:id/unarchive', (request, reply) => setLifecycle(request.params.id, { archivedAt: null }, reply));

  // Soft-delete to Trash / restore back to active (clears BOTH flags).
  app.delete<{ Params: { id: string } }>('/projects/:id', (request, reply) => setLifecycle(request.params.id, { deletedAt: new Date() }, reply));
  app.post<{ Params: { id: string } }>('/projects/:id/restore', (request, reply) => setLifecycle(request.params.id, { deletedAt: null, archivedAt: null }, reply));

  // Permanent delete — only from the Trash (a project must be soft-deleted first,
  // so a single click can never destroy a live project). Cascades to its files.
  app.delete<{ Params: { id: string } }>('/projects/:id/permanent', async (request, reply) => {
    const existing = await app.prisma.project.findUnique({ where: { id: request.params.id }, select: { id: true, deletedAt: true } });
    if (!existing) return reply.callNotFound();
    if (!existing.deletedAt) return reply.code(409).send({ error: 'Move the project to Trash before deleting it permanently.' });
    // Erasure: cascade DB rows + non-FK rows + the on-disk workspace (see hardDelete).
    await hardDeleteProject(app, existing.id);
    return { ok: true };
  });

  // Empty the project Trash (purge ALL soft-deleted projects). Folders have
  // their own trash (/project-trash); this is projects only.
  app.delete('/projects-trash/purge', async (request) => {
    const doomed = await app.prisma.project.findMany({
      where: { deletedAt: { not: null }, ...ownedProjectsWhere(request.principal) },
      select: { id: true },
    });
    for (const p of doomed) await hardDeleteProject(app, p.id).catch(() => undefined);
    return { ok: true, removed: doomed.length };
  });

  // Create a project, seeded with a minimal compilable main.tex.
  app.post('/projects', async (request, reply) => {
    const parsed = createProjectBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const folderId = parsed.data.folderId ?? null;
    if (!(await folderExists(app, folderId))) {
      return reply.code(400).send({ error: 'Target folder does not exist.' });
    }

    const project = await app.prisma.project.create({
      data: {
        name: parsed.data.name,
        rootFile: 'main.tex',
        folderId,
        // Stamp the owner. Null today (static bearer); a real user id once auth lands.
        userId: request.principal.userId,
        files: { create: [{ path: 'main.tex', content: DEFAULT_MAIN_TEX }] },
      },
    });
    return reply.code(201).send(serialiseProject(project));
  });

  // Fetch one project.
  app.get<{ Params: { id: string } }>('/projects/:id', async (request) => {
    const project = request.project!;
    return serialiseProject(project);
  });

  // Update project metadata + mathcheck settings (macro table, assumptions).
  app.patch<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const parsed = updateProjectBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const existing = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.callNotFound();

    const data: Prisma.ProjectUpdateInput = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name;
    if (parsed.data.rootFile !== undefined) data.rootFile = parsed.data.rootFile;
    if (parsed.data.folderId !== undefined) {
      if (!(await folderExists(app, parsed.data.folderId))) {
        return reply.code(400).send({ error: 'Target folder does not exist.' });
      }
      data.folder = parsed.data.folderId === null ? { disconnect: true } : { connect: { id: parsed.data.folderId } };
    }
    if (parsed.data.macros !== undefined) data.macros = parsed.data.macros as Prisma.InputJsonValue;
    if (parsed.data.assumptions !== undefined) data.assumptions = parsed.data.assumptions;
    if (parsed.data.aiInstructions !== undefined) data.aiInstructions = parsed.data.aiInstructions;
    if (parsed.data.aiProvider !== undefined) data.aiProvider = parsed.data.aiProvider;
    if (parsed.data.pythonRunTarget !== undefined) data.pythonRunTarget = parsed.data.pythonRunTarget;
    if (parsed.data.networkEnabled !== undefined) data.networkEnabled = parsed.data.networkEnabled;
    if (parsed.data.texEngine !== undefined) data.texEngine = parsed.data.texEngine;
    if (parsed.data.haltOnError !== undefined) data.haltOnError = parsed.data.haltOnError;
    if (parsed.data.draftMode !== undefined) data.draftMode = parsed.data.draftMode;
    if (parsed.data.model !== undefined) {
      const { models } = await getModels(app.config.model);
      if (!isAcceptableModel(parsed.data.model, models)) {
        return reply.code(400).send({ error: `Unsupported model: ${parsed.data.model}` });
      }
      data.model = parsed.data.model;
    }

    const project = await app.prisma.project.update({ where: { id: existing.id }, data });
    return serialiseProject(project);
  });
}
