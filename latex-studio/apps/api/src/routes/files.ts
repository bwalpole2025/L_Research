import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { isBinaryPath, validateFilePath } from '../lib/paths.js';
import { createZip, type ZipEntry } from '../lib/zip.js';
import { readLiteraturePdf } from '../literature/storage.js';

function serialiseFile(f: {
  id: string;
  projectId: string;
  path: string;
  content: string;
  encoding: string;
  updatedAt: Date;
}) {
  return {
    id: f.id,
    projectId: f.projectId,
    path: f.path,
    content: f.content,
    encoding: f.encoding,
    updatedAt: f.updatedAt.toISOString(),
  };
}

const createFileBody = z.object({
  path: z.string(),
  content: z.string().optional(),
  encoding: z.enum(['utf8', 'base64']).optional(),
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

const slug = (s: string): string => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'project';

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  // Export the project's source tree as a .zip. Optional ?pdf=1 includes the
  // last compiled PDF (from the workspace, if present) and ?literature=1 includes
  // the linked library PDFs under literature/. Built dependency-free in memory.
  app.get<{ Params: { id: string }; Querystring: { pdf?: string; literature?: string } }>(
    '/projects/:id/export',
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
      if (!project) return reply.callNotFound();
      const truthy = (v?: string) => v === '1' || v === 'true';
      const wantPdf = truthy(request.query.pdf);
      const wantLit = truthy(request.query.literature);

      const files = await app.prisma.texFile.findMany({
        where: { projectId: project.id },
        select: { path: true, content: true, encoding: true },
      });
      const seen = new Set<string>();
      const entries: ZipEntry[] = [];
      const add = (name: string, data: Buffer) => {
        if (seen.has(name)) return;
        seen.add(name);
        entries.push({ name, data });
      };
      for (const f of files) add(f.path, Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'));

      if (wantPdf) {
        const base = basename(project.rootFile, extname(project.rootFile));
        const pdf = await readFile(app.compileService.pdfPath(project.id, project.rootFile)).catch(() => null);
        if (pdf) add(`${base}.pdf`, pdf);
      }

      if (wantLit) {
        const items = await app.prisma.literatureItem.findMany({
          where: { projectId: project.id, NOT: { storagePath: '' } },
          select: { storagePath: true, fileName: true, citeKey: true, id: true },
        });
        for (const it of items) {
          const buf = await readLiteraturePdf(app.config.compileWorkspace, project.id, it.storagePath).catch(() => null);
          if (!buf) continue;
          const raw = it.fileName || `${it.citeKey ?? it.id}.pdf`;
          const name = raw.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_');
          add(`literature/${name}.pdf`, buf);
        }
      }

      // metadata.json — project settings + a manifest of files and library items,
      // so the archive is a complete, self-describing "export all my data".
      const litMeta = await app.prisma.literatureItem.findMany({
        where: { projectId: project.id },
        select: { citeKey: true, title: true, fileName: true },
      });
      const metadata = {
        exportedAt: new Date().toISOString(),
        project: {
          id: project.id,
          name: project.name,
          rootFile: project.rootFile,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          texEngine: project.texEngine,
          macros: project.macros,
          assumptions: project.assumptions,
          model: project.model,
          aiInstructions: project.aiInstructions,
        },
        files: files.map((f) => ({ path: f.path, encoding: f.encoding })),
        literature: litMeta,
      };
      add('metadata.json', Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'));

      const zip = createZip(entries);
      reply.header('content-type', 'application/zip');
      reply.header('content-disposition', `attachment; filename="${slug(project.name)}.zip"`);
      reply.header('content-length', zip.length);
      reply.header('cache-control', 'no-store');
      return reply.send(zip);
    },
  );

  // List a project's files (metadata only — no content — to keep the tree light).
  app.get<{ Params: { id: string } }>('/projects/:id/files', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      orderBy: { path: 'asc' },
      select: { id: true, projectId: true, path: true, encoding: true, updatedAt: true },
    });
    return files.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      path: f.path,
      encoding: f.encoding,
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

    // Binary files must arrive explicitly base64; text files are always utf8.
    const binary = isBinaryPath(parsed.data.path);
    if (binary && parsed.data.encoding !== 'base64') {
      return reply.code(400).send({ error: 'binary files must be uploaded with base64 encoding' });
    }
    const encoding = binary ? 'base64' : 'utf8';

    try {
      const file = await app.prisma.texFile.create({
        data: {
          projectId: project.id,
          path: parsed.data.path,
          content: parsed.data.content ?? '',
          encoding,
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
