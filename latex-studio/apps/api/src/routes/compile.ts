import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CompileService } from '../compile/service.js';
import { resolveAndPersistRoot } from '../compile/rootResolve.js';
import { principalKey } from '../auth/principal.js';

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
  /** Latest compile outcome (dashboard badge): green/orange/red at a glance. */
  app.get<{ Params: { id: string } }>('/projects/:id/compile-status', async (request) => {
    const project = request.project!;
    const last = await app.prisma.compileLog.findFirst({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      select: { status: true, createdAt: true },
    });
    return last ? { status: last.status, at: last.createdAt.toISOString() } : { status: null };
  });

  const svc = app.compileService;

  // Compile a project (queued one-per-project).
  app.post<{ Params: { id: string } }>('/projects/:id/compile', async (request) => {
    const project = request.project!;

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });

    // If the configured root (e.g. "main.tex") doesn't exist, fall back to the
    // next available .tex document and persist it as the project root so PDF
    // serving, SyncTeX, review and verify all agree.
    const resolved = await resolveAndPersistRoot(app.prisma, project.id, project.rootFile, files);

    const engine = (['pdflatex', 'xelatex', 'lualatex'] as const).includes(project.texEngine as 'pdflatex')
      ? (project.texEngine as 'pdflatex' | 'xelatex' | 'lualatex')
      : 'pdflatex';
    const result = await svc.compile({
      projectId: project.id,
      rootFile: resolved.rootFile,
      files,
      options: { engine, haltOnError: project.haltOnError, draftMode: project.draftMode },
      userKey: principalKey(request.principal),
    });

    if (resolved.fellBack && result.status !== 'superseded') {
      result.diagnostics.unshift({
        severity: 'warning-important',
        message:
          resolved.reason === 'pristine-seed'
            ? `"${project.rootFile}" is the untouched starter template — compiled your document "${resolved.rootFile}" instead and set it as the project root (change it in Settings).`
            : `Root file "${project.rootFile}" not found — compiled "${resolved.rootFile}" instead and set it as the project root (change it in Settings).`,
        file: resolved.rootFile,
        line: 1,
      });
    }

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

  // LaTeX-aware word count (texcount): total + per-file/included-file breakdown.
  app.get<{ Params: { id: string } }>('/projects/:id/wordcount', async (request) => {
    const project = request.project!;
    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    // Count against the resolved root so \input/\include are followed correctly
    // (and a pristine-seed / missing root falls back like a compile would).
    const resolved = await resolveAndPersistRoot(app.prisma, project.id, project.rootFile, files);
    return svc.wordCount(project.id, resolved.rootFile, files);
  });

  // Serve the produced PDF (authenticated — this route is behind the bearer hook).
  app.get<{ Params: { id: string } }>('/projects/:id/pdf', async (request, reply) => {
    const project = request.project!;
    return sendFile(reply, svc.pdfPath(project.id, project.rootFile), 'application/pdf');
  });

  // Serve the .synctex.gz.
  app.get<{ Params: { id: string } }>('/projects/:id/synctex', async (request, reply) => {
    const project = request.project!;
    return sendFile(reply, svc.synctexPath(project.id, project.rootFile), 'application/gzip');
  });

  // Forward search: source file:line → PDF location(s).
  app.post('/synctex/forward', async (request, reply) => {
    const parsed = forwardBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const project = request.project!;

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
    const project = request.project!;

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
