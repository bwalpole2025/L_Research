import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getModels } from '../ai/models.js';
import { isAcceptableModel } from '../providers/index.js';
import { DEFAULT_MAIN_TEX } from '../lib/seedTemplate.js';

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
  };
}

/** Validate a folderId target: null is the root; otherwise the folder must exist. */
async function folderExists(app: FastifyInstance, folderId: string | null): Promise<boolean> {
  if (folderId === null) return true;
  const found = await app.prisma.projectFolder.findUnique({ where: { id: folderId }, select: { id: true } });
  return !!found;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // List projects (newest first).
  app.get('/projects', async () => {
    const projects = await app.prisma.project.findMany({ orderBy: { updatedAt: 'desc' } });
    return projects.map(serialiseProject);
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
        files: { create: [{ path: 'main.tex', content: DEFAULT_MAIN_TEX }] },
      },
    });
    return reply.code(201).send(serialiseProject(project));
  });

  // Fetch one project.
  app.get<{ Params: { id: string } }>('/projects/:id', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
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
