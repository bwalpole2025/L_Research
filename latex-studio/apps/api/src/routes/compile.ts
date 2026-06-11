import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CompileService } from '../compile/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    compileService: CompileService;
  }
}

const forwardBody = z.object({
  projectId: z.string().min(1),
  file: z.string().min(1).max(512),
  line: z.number().int().positive(),
  column: z.number().int().min(0).optional(),
});

const inverseBody = z.object({
  projectId: z.string().min(1),
  page: z.number().int().positive(),
  x: z.number(),
  y: z.number(),
});

async function sendFile(reply: FastifyReply, path: string, contentType: string): Promise<FastifyReply> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return reply.code(404).send({ error: 'Not compiled yet' });
  }
  if (!info.isFile()) return reply.code(404).send({ error: 'Not compiled yet' });

  reply.header('content-type', contentType);
  reply.header('content-length', info.size);
  reply.header('cache-control', 'no-store');
  return reply.send(createReadStream(path));
}

export async function compileRoutes(app: FastifyInstance): Promise<void> {
  const svc = app.compileService;

  // Compile a project (queued one-per-project).
  app.post<{ Params: { id: string } }>('/projects/:id/compile', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true },
    });

    const result = await svc.compile({
      projectId: project.id,
      rootFile: project.rootFile,
      files,
    });

    if (result.status !== 'superseded') {
      await app.prisma.compileLog
        .create({
          data: {
            projectId: project.id,
            status: result.status,
            log: result.log ?? '',
            durationMs: result.durationMs,
          },
        })
        .catch(() => undefined);
    }

    return result;
  });

  // Serve the produced PDF (authenticated — this route is behind the bearer hook).
  app.get<{ Params: { id: string } }>('/projects/:id/pdf', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    return sendFile(reply, svc.pdfPath(project.id, project.rootFile), 'application/pdf');
  });

  // Serve the .synctex.gz.
  app.get<{ Params: { id: string } }>('/projects/:id/synctex', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    return sendFile(reply, svc.synctexPath(project.id, project.rootFile), 'application/gzip');
  });

  // Forward search: source file:line → PDF location(s).
  app.post('/synctex/forward', async (request, reply) => {
    const parsed = forwardBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const project = await app.prisma.project.findUnique({ where: { id: parsed.data.projectId } });
    if (!project) return reply.callNotFound();

    return svc.forward(
      project.id,
      project.rootFile,
      parsed.data.file,
      parsed.data.line,
      parsed.data.column ?? 0,
    );
  });

  // Inverse search: PDF point → source file:line.
  app.post('/synctex/inverse', async (request, reply) => {
    const parsed = inverseBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const project = await app.prisma.project.findUnique({ where: { id: parsed.data.projectId } });
    if (!project) return reply.callNotFound();

    const result = await svc.inverse(
      project.id,
      project.rootFile,
      parsed.data.page,
      parsed.data.x,
      parsed.data.y,
    );
    if (!result) return reply.code(404).send({ error: 'No source location found' });
    return result;
  });
}
