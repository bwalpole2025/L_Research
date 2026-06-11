import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { CiteLink, LibraryFolder, LiteratureItem } from '@latex-studio/shared';
import { parseBib } from '../coderive/bib.js';
import {
  deleteLiteraturePdf,
  enrichFromCrossref,
  extractViaMathcheck,
  readLiteraturePdf,
  writeLiteraturePdf,
} from '../literature/storage.js';

type ItemRow = {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  authors: string;
  year: string;
  citeKey: string | null;
  fileName: string;
  fileSizeBytes: number;
  doi: string | null;
  abstract: string | null;
  extractedText: string | null;
  extractedAt: Date | null;
  addedAt: Date;
};

function serializeItem(it: ItemRow): LiteratureItem {
  return {
    id: it.id,
    projectId: it.projectId,
    folderId: it.folderId,
    title: it.title,
    authors: it.authors,
    year: it.year,
    citeKey: it.citeKey,
    fileName: it.fileName,
    fileSizeBytes: it.fileSizeBytes,
    doi: it.doi,
    abstract: it.abstract,
    hasText: !!it.extractedText && it.extractedText.trim().length > 0,
    extractedAt: it.extractedAt ? it.extractedAt.toISOString() : null,
    addedAt: it.addedAt.toISOString(),
  };
}

function serializeFolder(f: { id: string; projectId: string; parentId: string | null; name: string; createdAt: Date }): LibraryFolder {
  return { id: f.id, projectId: f.projectId, parentId: f.parentId, name: f.name, createdAt: f.createdAt.toISOString() };
}

const folderBody = z.object({ name: z.string().trim().min(1).max(120), parentId: z.string().nullable().optional() });
const folderPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), parentId: z.string().nullable().optional() });
const uploadBody = z.object({
  fileName: z.string().min(1),
  fileBase64: z.string().min(1),
  folderId: z.string().nullable().optional(),
});
const importBibBody = z.object({ bibContent: z.string(), folderId: z.string().nullable().optional() });
const itemPatch = z
  .object({
    title: z.string(),
    authors: z.string(),
    year: z.string(),
    citeKey: z.string().nullable(),
    doi: z.string().nullable(),
    abstract: z.string().nullable(),
    folderId: z.string().nullable(),
  })
  .partial();
const linkBody = z.object({ citeKey: z.string().trim().min(1).max(120) });

const CITE_KEY_RE = /@\w+\s*\{\s*([^,\s}]+)/g;

function projectCiteKeys(bibContents: string[]): string[] {
  const keys = new Set<string>();
  for (const c of bibContents) {
    CITE_KEY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_KEY_RE.exec(c)) !== null) if (m[1] && !/^string$/i.test(m[1])) keys.add(m[1].trim());
  }
  return [...keys].sort();
}

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  const ws = () => app.config.compileWorkspace;

  async function bibKeysFor(projectId: string): Promise<string[]> {
    const bibs = await app.prisma.texFile.findMany({ where: { projectId, path: { endsWith: '.bib' } }, select: { content: true } });
    return projectCiteKeys(bibs.map((b) => b.content));
  }

  async function folderCollision(projectId: string, parentId: string | null, name: string, excludeId?: string): Promise<boolean> {
    const found = await app.prisma.folder.findFirst({
      where: { projectId, tree: 'literature', parentId, name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    });
    return !!found;
  }

  async function wouldCycle(folderId: string, newParentId: string | null): Promise<boolean> {
    if (!newParentId) return false;
    if (newParentId === folderId) return true;
    let cur: string | null = newParentId;
    for (let i = 0; cur && i < 1000; i++) {
      const f: { parentId: string | null } | null = await app.prisma.folder.findUnique({ where: { id: cur }, select: { parentId: true } });
      if (!f) break;
      if (f.parentId === folderId) return true;
      cur = f.parentId;
    }
    return false;
  }

  // ── Tree + lookups ──────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/projects/:id/library', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const [folders, items, trashCount] = await Promise.all([
      app.prisma.folder.findMany({ where: { projectId: project.id, tree: 'literature' }, orderBy: { name: 'asc' } }),
      app.prisma.literatureItem.findMany({ where: { projectId: project.id }, orderBy: { addedAt: 'desc' } }),
      app.prisma.trashEntry.count({ where: { projectId: project.id } }),
    ]);
    return { folders: folders.map(serializeFolder), items: items.map(serializeItem), trashCount };
  });

  app.get<{ Params: { id: string } }>('/projects/:id/library/cite-keys', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    return { keys: await bibKeysFor(project.id) };
  });

  app.get<{ Params: { id: string } }>('/projects/:id/library/links', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const keys = await bibKeysFor(project.id);
    const linked = await app.prisma.literatureItem.findMany({
      where: { projectId: project.id, NOT: { citeKey: null } },
      select: { id: true, citeKey: true, title: true, extractedText: true },
    });
    const byKey = new Map(linked.map((l) => [l.citeKey!, l]));
    const links: CiteLink[] = keys.map((key) => {
      const it = byKey.get(key);
      return it
        ? { citeKey: key, linked: true, hasText: !!it.extractedText && it.extractedText.trim().length > 0, itemId: it.id, title: it.title }
        : { citeKey: key, linked: false, hasText: false };
    });
    return { links };
  });

  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/projects/:id/library/search', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const q = (request.query.q ?? '').trim();
    if (!q) {
      const all = await app.prisma.literatureItem.findMany({ where: { projectId: project.id }, orderBy: { addedAt: 'desc' } });
      return { items: all.map(serializeItem) };
    }
    const matches = await app.prisma.literatureItem.findMany({
      where: {
        projectId: project.id,
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { authors: { contains: q, mode: 'insensitive' } },
          { year: { contains: q } },
          { extractedText: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { addedAt: 'desc' },
    });
    return { items: matches.map(serializeItem) };
  });

  // ── Folders ─────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/library/folders', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = folderBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const parentId = parsed.data.parentId ?? null;
    if (await folderCollision(project.id, parentId, parsed.data.name)) {
      return reply.code(409).send({ error: `A folder named “${parsed.data.name}” already exists here.` });
    }
    const folder = await app.prisma.folder.create({
      data: { projectId: project.id, tree: 'literature', name: parsed.data.name, parentId },
    });
    return reply.code(201).send(serializeFolder(folder));
  });

  app.patch<{ Params: { folderId: string } }>('/library/folders/:folderId', async (request, reply) => {
    const folder = await app.prisma.folder.findUnique({ where: { id: request.params.folderId } });
    if (!folder) return reply.callNotFound();
    const parsed = folderPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const name = parsed.data.name ?? folder.name;
    const parentId = parsed.data.parentId === undefined ? folder.parentId : parsed.data.parentId;
    if (parsed.data.parentId !== undefined && (await wouldCycle(folder.id, parentId))) {
      return reply.code(409).send({ error: 'That move would create a cycle (a folder cannot contain itself).' });
    }
    if (await folderCollision(folder.projectId, parentId, name, folder.id)) {
      return reply.code(409).send({ error: `A folder named “${name}” already exists in the destination.` });
    }
    const updated = await app.prisma.folder.update({ where: { id: folder.id }, data: { name, parentId } });
    return serializeFolder(updated);
  });

  app.delete<{ Params: { folderId: string } }>('/library/folders/:folderId', async (request, reply) => {
    const folder = await app.prisma.folder.findUnique({ where: { id: request.params.folderId } });
    if (!folder) return reply.callNotFound();
    // Gather the whole subtree so restore can rebuild it.
    const allFolders = await app.prisma.folder.findMany({ where: { projectId: folder.projectId, tree: 'literature' } });
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
    const items = await app.prisma.literatureItem.findMany({ where: { folderId: { in: folderIds } } });

    await app.prisma.$transaction(async (tx) => {
      await tx.trashEntry.create({
        data: {
          projectId: folder.projectId,
          kind: 'folder',
          payload: {
            folders: subtree.map((f) => ({ id: f.id, parentId: f.parentId, name: f.name, createdAt: f.createdAt.toISOString() })),
            items: items.map((it) => ({ ...it, extractedAt: it.extractedAt?.toISOString() ?? null, addedAt: it.addedAt.toISOString() })),
            rootName: folder.name,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.literatureItem.deleteMany({ where: { id: { in: items.map((i) => i.id) } } });
      await tx.folder.deleteMany({ where: { id: { in: folderIds } } });
    });
    return { ok: true, trashedItems: items.length };
  });

  // ── Items ───────────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/library/items', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = uploadBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    if (!/\.pdf$/i.test(parsed.data.fileName)) return reply.code(400).send({ error: 'Only PDF files can be added to the library.' });

    const { storagePath, size } = await writeLiteraturePdf(ws(), project.id, parsed.data.fileBase64);
    const extraction = await extractViaMathcheck(app.config.mathcheckUrl, parsed.data.fileBase64);
    const item = await app.prisma.literatureItem.create({
      data: {
        projectId: project.id,
        folderId: parsed.data.folderId ?? null,
        fileName: parsed.data.fileName,
        storagePath,
        fileSizeBytes: size,
        title: extraction.title || parsed.data.fileName.replace(/\.pdf$/i, ''),
        authors: extraction.author,
        ...(extraction.text ? { extractedText: extraction.text, extractedAt: new Date() } : {}),
      },
    });
    return reply.code(201).send(serializeItem(item));
  });

  app.post<{ Params: { id: string } }>('/projects/:id/library/import-bib', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = importBibBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const entries = [...parseBib(parsed.data.bibContent).values()];
    const created = await app.prisma.$transaction(
      entries.map((e) =>
        app.prisma.literatureItem.create({
          data: {
            projectId: project.id,
            folderId: parsed.data.folderId ?? null,
            title: e.title ?? '',
            authors: e.author ?? '',
            year: e.year ?? '',
            citeKey: e.key,
            ...(e.abstract ? { abstract: e.abstract } : {}),
          },
        }),
      ),
    );
    return reply.code(201).send({ items: created.map(serializeItem) });
  });

  app.patch<{ Params: { itemId: string } }>('/library/items/:itemId', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item) return reply.callNotFound();
    const parsed = itemPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const data: Prisma.LiteratureItemUpdateInput = {};
    for (const [k, v] of Object.entries(parsed.data)) (data as Record<string, unknown>)[k] = v;
    const updated = await app.prisma.literatureItem.update({ where: { id: item.id }, data });
    return serializeItem(updated);
  });

  app.post<{ Params: { itemId: string } }>('/library/items/:itemId/extract', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item || !item.storagePath) return reply.code(404).send({ error: 'no PDF to extract' });
    const buf = await readLiteraturePdf(ws(), item.projectId, item.storagePath).catch(() => null);
    if (!buf) return reply.code(404).send({ error: 'PDF not found on disk' });
    const extraction = await extractViaMathcheck(app.config.mathcheckUrl, buf.toString('base64'));
    const updated = await app.prisma.literatureItem.update({
      where: { id: item.id },
      data: { extractedText: extraction.text, extractedAt: new Date() },
    });
    return { ...serializeItem(updated), pageCount: extraction.pageCount };
  });

  app.post<{ Params: { itemId: string } }>('/library/items/:itemId/link', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item) return reply.callNotFound();
    const parsed = linkBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const updated = await app.prisma.literatureItem.update({ where: { id: item.id }, data: { citeKey: parsed.data.citeKey } });
    return serializeItem(updated);
  });

  app.post<{ Params: { itemId: string } }>('/library/items/:itemId/generate-bib', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item) return reply.callNotFound();
    const existing = new Set(await bibKeysFor(item.projectId));
    let key = item.citeKey ?? '';
    if (!key) {
      const last = (item.authors.split(',')[0] || item.authors).trim().split(/\s+/).pop() ?? 'ref';
      const base = (last.toLowerCase().replace(/[^a-z]/g, '') || 'ref') + (item.year || '');
      key = base;
      for (let i = 1; existing.has(key); i++) key = base + String.fromCharCode(96 + i);
    }
    const entry =
      `@article{${key},\n` +
      `  title = {${item.title}},\n` +
      `  author = {${item.authors}},\n` +
      `  year = {${item.year}},\n` +
      (item.doi ? `  doi = {${item.doi}},\n` : '') +
      `}\n`;

    let bib = await app.prisma.texFile.findFirst({ where: { projectId: item.projectId, path: { endsWith: '.bib' } } });
    if (bib) {
      await app.prisma.texFile.update({ where: { id: bib.id }, data: { content: `${bib.content.trimEnd()}\n\n${entry}` } });
    } else {
      bib = await app.prisma.texFile.create({ data: { projectId: item.projectId, path: 'references.bib', content: entry } });
    }
    const updated = await app.prisma.literatureItem.update({ where: { id: item.id }, data: { citeKey: key } });
    return { item: serializeItem(updated), citeKey: key, bibFile: bib.path };
  });

  app.post<{ Params: { itemId: string } }>('/library/items/:itemId/enrich', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item) return reply.callNotFound();
    if (!item.doi) return reply.code(400).send({ error: 'No DOI on this item to enrich from.' });
    const data = await enrichFromCrossref(item.doi);
    if (!data) return reply.code(502).send({ error: 'Crossref returned nothing (or the network is unavailable).' });
    const updated = await app.prisma.literatureItem.update({
      where: { id: item.id },
      data: {
        ...(data.title ? { title: data.title } : {}),
        ...(data.authors ? { authors: data.authors } : {}),
        ...(data.year ? { year: data.year } : {}),
        ...(data.abstract ? { abstract: data.abstract } : {}),
      },
    });
    return serializeItem(updated);
  });

  app.get<{ Params: { itemId: string } }>('/library/items/:itemId/pdf', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item || !item.storagePath) return reply.callNotFound();
    const buf = await readLiteraturePdf(ws(), item.projectId, item.storagePath).catch(() => null);
    if (!buf) return reply.callNotFound();
    reply.header('content-type', 'application/pdf');
    return reply.send(buf);
  });

  app.delete<{ Params: { itemId: string } }>('/library/items/:itemId', async (request, reply) => {
    const item = await app.prisma.literatureItem.findUnique({ where: { id: request.params.itemId } });
    if (!item) return reply.callNotFound();
    await app.prisma.$transaction([
      app.prisma.trashEntry.create({
        data: {
          projectId: item.projectId,
          kind: 'literature',
          payload: { ...item, extractedAt: item.extractedAt?.toISOString() ?? null, addedAt: item.addedAt.toISOString() } as Prisma.InputJsonValue,
        },
      }),
      app.prisma.literatureItem.delete({ where: { id: item.id } }),
    ]);
    return { ok: true };
  });

  // ── Trash ───────────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>('/projects/:id/trash', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const entries = await app.prisma.trashEntry.findMany({ where: { projectId: project.id }, orderBy: { deletedAt: 'desc' } });
    return {
      items: entries.map((e) => {
        const payload = e.payload as Record<string, unknown>;
        const label =
          e.kind === 'folder'
            ? `Folder “${String(payload.rootName ?? 'folder')}” (${Array.isArray(payload.items) ? payload.items.length : 0} article(s))`
            : e.kind === 'literature'
              ? `Article “${String(payload.title || payload.fileName || 'untitled')}”`
              : `File ${String(payload.path ?? '')}`;
        return { id: e.id, kind: e.kind, label, deletedAt: e.deletedAt.toISOString() };
      }),
    };
  });

  app.post<{ Params: { id: string; trashId: string } }>('/projects/:id/trash/:trashId/restore', async (request, reply) => {
    const entry = await app.prisma.trashEntry.findUnique({ where: { id: request.params.trashId } });
    if (!entry) return reply.callNotFound();
    const payload = entry.payload as Record<string, unknown>;

    if (entry.kind === 'literature') {
      const it = payload as unknown as ItemRow & { storagePath: string };
      await app.prisma.literatureItem.create({
        data: {
          id: it.id,
          projectId: entry.projectId,
          folderId: it.folderId,
          title: it.title,
          authors: it.authors,
          year: it.year,
          citeKey: it.citeKey,
          fileName: it.fileName,
          storagePath: it.storagePath,
          fileSizeBytes: it.fileSizeBytes,
          doi: it.doi,
          abstract: it.abstract,
          extractedText: it.extractedText,
        },
      });
    } else if (entry.kind === 'folder') {
      const folders = (payload.folders as Array<{ id: string; parentId: string | null; name: string }>) ?? [];
      const items = (payload.items as Array<ItemRow & { storagePath: string }>) ?? [];
      // Recreate folders parents-first.
      const placed = new Set<string>();
      let guard = 0;
      while (placed.size < folders.length && guard++ < 10000) {
        for (const f of folders) {
          if (placed.has(f.id)) continue;
          if (f.parentId && folders.some((p) => p.id === f.parentId) && !placed.has(f.parentId)) continue;
          await app.prisma.folder.create({ data: { id: f.id, projectId: entry.projectId, tree: 'literature', name: f.name, parentId: f.parentId } }).catch(() => undefined);
          placed.add(f.id);
        }
      }
      for (const it of items) {
        await app.prisma.literatureItem
          .create({
            data: {
              id: it.id,
              projectId: entry.projectId,
              folderId: it.folderId,
              title: it.title,
              authors: it.authors,
              year: it.year,
              citeKey: it.citeKey,
              fileName: it.fileName,
              storagePath: it.storagePath,
              fileSizeBytes: it.fileSizeBytes,
              doi: it.doi,
              abstract: it.abstract,
              extractedText: it.extractedText,
            },
          })
          .catch(() => undefined);
      }
    }
    await app.prisma.trashEntry.delete({ where: { id: entry.id } });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/projects/:id/trash', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const entries = await app.prisma.trashEntry.findMany({ where: { projectId: project.id } });
    // Permanently delete the PDF files on disk for literature/folder entries.
    for (const e of entries) {
      const payload = e.payload as Record<string, unknown>;
      const items =
        e.kind === 'literature'
          ? [payload]
          : e.kind === 'folder' && Array.isArray(payload.items)
            ? (payload.items as Record<string, unknown>[])
            : [];
      for (const it of items) {
        if (typeof it.storagePath === 'string' && it.storagePath) await deleteLiteraturePdf(ws(), project.id, it.storagePath);
      }
    }
    await app.prisma.trashEntry.deleteMany({ where: { projectId: project.id } });
    return { ok: true, removed: entries.length };
  });
}
