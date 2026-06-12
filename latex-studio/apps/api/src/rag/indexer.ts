import type { PrismaClient } from '@prisma/client';
import { chunkText, type PageOffset } from './chunk.js';
import { embedTexts } from './embeddings.js';
import { ensurePgvector, toVectorLiteral } from './pgvector.js';

/**
 * Index ONE literature item: chunk its extracted text (~450-token passages with
 * overlap, page + char provenance), embed each chunk LOCALLY via mathcheck
 * /embed, and store LibraryChunk rows. Existing chunks for the item are
 * replaced atomically (delete + insert), so re-indexing after a text change is
 * idempotent. Returns the number of chunks written.
 */
export async function indexLibraryItem(
  prisma: PrismaClient,
  mathcheckUrl: string,
  item: { id: string; projectId: string; extractedText: string | null },
  pageOffsets: PageOffset[] = [],
): Promise<number> {
  const text = (item.extractedText ?? '').trim();
  await ensurePgvector(prisma);
  await prisma.libraryChunk.deleteMany({ where: { literatureItemId: item.id } });
  if (!text) return 0;

  const chunks = chunkText(text, pageOffsets);
  if (chunks.length === 0) return 0;

  const BATCH = 32;
  let written = 0;
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    const { vectors, model } = await embedTexts(mathcheckUrl, batch.map((c) => c.text));
    if (vectors.length !== batch.length) throw new Error('embedding service returned a short batch');
    for (let j = 0; j < batch.length; j++) {
      const c = batch[j]!;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "LibraryChunk" ("id", "literatureItemId", "projectId", "page", "charStart", "charEnd", "text", "embedding", "model", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, NOW())`,
        `lc_${item.id}_${i + j}_${Math.abs(hash(c.text)).toString(36)}`,
        item.id,
        item.projectId,
        c.page,
        c.charStart,
        c.charEnd,
        c.text,
        toVectorLiteral(vectors[j]!),
        model,
      );
      written += 1;
    }
  }
  return written;
}

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(33, h) + s.charCodeAt(i)) | 0;
  return h;
}

export interface IndexStatus {
  items: number;
  itemsWithText: number;
  indexedItems: number;
  chunks: number;
  model: string | null;
}

/** Index coverage for the Settings panel: how much of the library is embedded. */
export async function libraryIndexStatus(prisma: PrismaClient, projectId: string): Promise<IndexStatus> {
  const [items, itemsWithText, grouped, sample] = await Promise.all([
    prisma.literatureItem.count({ where: { projectId } }),
    prisma.literatureItem.count({ where: { projectId, extractedText: { not: null } } }),
    prisma.libraryChunk.groupBy({ by: ['literatureItemId'], where: { projectId }, _count: true }),
    prisma.libraryChunk.findFirst({ where: { projectId }, select: { model: true } }),
  ]);
  return {
    items,
    itemsWithText,
    indexedItems: grouped.length,
    chunks: grouped.reduce((n, g) => n + g._count, 0),
    model: sample?.model ?? null,
  };
}

/**
 * Rebuild the whole project index. When a PDF is on disk we re-extract via
 * mathcheck to recover page offsets (better provenance than the stored text);
 * items without a readable PDF are indexed from extractedText with page 0.
 */
export async function reindexProject(
  prisma: PrismaClient,
  mathcheckUrl: string,
  projectId: string,
  reExtract: (storagePath: string) => Promise<{ text: string; pageOffsets: PageOffset[] } | null>,
): Promise<{ indexed: number; chunks: number; skipped: number }> {
  const items = await prisma.literatureItem.findMany({
    where: { projectId },
    select: { id: true, projectId: true, extractedText: true, storagePath: true },
  });
  let indexed = 0;
  let chunks = 0;
  let skipped = 0;
  for (const item of items) {
    let text = item.extractedText;
    let pageOffsets: PageOffset[] = [];
    if (item.storagePath) {
      const fresh = await reExtract(item.storagePath).catch(() => null);
      if (fresh?.text) {
        text = fresh.text;
        pageOffsets = fresh.pageOffsets;
        if (text !== item.extractedText) {
          await prisma.literatureItem.update({ where: { id: item.id }, data: { extractedText: text, extractedAt: new Date() } });
        }
      }
    }
    if (!text?.trim()) {
      skipped += 1;
      continue;
    }
    const n = await indexLibraryItem(prisma, mathcheckUrl, { id: item.id, projectId: item.projectId, extractedText: text }, pageOffsets);
    if (n > 0) {
      indexed += 1;
      chunks += n;
    } else {
      skipped += 1;
    }
  }
  return { indexed, chunks, skipped };
}
