import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { validateFilePath } from '../lib/paths.js';

function serialiseFile(f: {
  id: string;
  projectId: string;
  path: string;
  content: string;
  updatedAt: Date;
}) {
  return {
    id: f.id,
    projectId: f.projectId,
    path: f.path,
    content: f.content,
    updatedAt: f.updatedAt.toISOString(),
  };
}

const createFileBody = z.object({
  path: z.string(),
  content: z.string().optional(),
});

// At least one of path/content must be present on a PATCH.
const updateFileBody = z
  .object({
    path: z.string().optional(),
    content: z.string().optional(),
  })
  .refine((b) => b.path !== undefined || b.content !== undefined, {
    message: 'provide at least one of: path, content',
  });

/** True when a Prisma error is a unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  // List a project's files (metadata only — no content — to keep the tree light).
  app.get<{ Params: { id: string } }>('/projects/:id/files', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      orderBy: { path: 'asc' },
      select: { id: true, projectId: true, path: true, updatedAt: true },
    });
    return files.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      path: f.path,
      updatedAt: f.updatedAt.toISOString(),
    }));
  });

  // Create a file in a project.
  app.post<{ Params: { id: string } }>('/projects/:id/files', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();

    const parsed = createFileBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const check = validateFilePath(parsed.data.path);
    if (!check.ok) return reply.code(400).send({ error: check.error });

    try {
      const file = await app.prisma.texFile.create({
        data: {
          projectId: project.id,
          path: parsed.data.path,
          content: parsed.data.content ?? '',
        },
      });
      return reply.code(201).send(serialiseFile(file));
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: `a file already exists at "${parsed.data.path}"` });
      }
      throw err;
    }
  });

  // Read a single file (with content).
  app.get<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    const file = await app.prisma.texFile.findUnique({ where: { id: request.params.id } });
    if (!file) return reply.callNotFound();
    return serialiseFile(file);
  });

  // Update a file's content and/or path (rename).
  app.patch<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    const parsed = updateFileBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    if (parsed.data.path !== undefined) {
      const check = validateFilePath(parsed.data.path);
      if (!check.ok) return reply.code(400).send({ error: check.error });
    }

    const existing = await app.prisma.texFile.findUnique({ where: { id: request.params.id } });
    if (!existing) return reply.callNotFound();

    const data: Prisma.TexFileUpdateInput = {};
    if (parsed.data.path !== undefined) data.path = parsed.data.path;
    if (parsed.data.content !== undefined) data.content = parsed.data.content;

    try {
      const file = await app.prisma.texFile.update({ where: { id: existing.id }, data });
      return serialiseFile(file);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({ error: `a file already exists at "${parsed.data.path}"` });
      }
      throw err;
    }
  });

  // Delete a file.
  app.delete<{ Params: { id: string } }>('/files/:id', async (request, reply) => {
    try {
      await app.prisma.texFile.delete({ where: { id: request.params.id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.callNotFound();
      }
      throw err;
    }
    return reply.code(204).send();
  });
}
