import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

const createSnapshotBody = z.object({
  label: z.string().trim().min(1).max(200),
});

/** The shape of each file we freeze into a snapshot's JSON payload. */
interface SnapshotFile {
  path: string;
  content: string;
}

export async function snapshotRoutes(app: FastifyInstance): Promise<void> {
  // Create a snapshot: freeze the project's current files into JSONB.
  app.post<{ Params: { id: string } }>('/projects/:id/snapshots', async (request, reply) => {
    const project = request.project!;

    const parsed = createSnapshotBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true },
      orderBy: { path: 'asc' },
    });

    const snapshot = await app.prisma.snapshot.create({
      data: {
        projectId: project.id,
        label: parsed.data.label,
        files: files as unknown as Prisma.InputJsonValue,
      },
    });

    return reply.code(201).send({
      id: snapshot.id,
      projectId: snapshot.projectId,
      label: snapshot.label,
      createdAt: snapshot.createdAt.toISOString(),
      fileCount: files.length,
    });
  });

  // List a project's snapshots (metadata only — no file payloads).
  app.get<{ Params: { id: string } }>('/projects/:id/snapshots', async (request) => {
    const project = request.project!;

    const snapshots = await app.prisma.snapshot.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, projectId: true, label: true, createdAt: true },
    });

    return snapshots.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      label: s.label,
      createdAt: s.createdAt.toISOString(),
    }));
  });

  // Restore a snapshot: replace the project's files with the frozen set.
  app.post<{ Params: { id: string; snapshotId: string } }>(
    '/projects/:id/snapshots/:snapshotId/restore',
    async (request, reply) => {
      const snapshot = await app.prisma.snapshot.findUnique({
        where: { id: request.params.snapshotId },
      });
      if (!snapshot || snapshot.projectId !== request.params.id) {
        return reply.callNotFound();
      }

      const files = (snapshot.files as unknown as SnapshotFile[]) ?? [];

      // Atomically swap the working files for the snapshot's contents.
      await app.prisma.$transaction([
        app.prisma.texFile.deleteMany({ where: { projectId: snapshot.projectId } }),
        ...files.map((f) =>
          app.prisma.texFile.create({
            data: { projectId: snapshot.projectId, path: f.path, content: f.content },
          }),
        ),
        app.prisma.project.update({
          where: { id: snapshot.projectId },
          data: { updatedAt: new Date() },
        }),
      ]);

      const restored = await app.prisma.texFile.findMany({
        where: { projectId: snapshot.projectId },
        orderBy: { path: 'asc' },
        select: { id: true, projectId: true, path: true, updatedAt: true },
      });

      return restored.map((f) => ({
        id: f.id,
        projectId: f.projectId,
        path: f.path,
        updatedAt: f.updatedAt.toISOString(),
      }));
    },
  );
}
