import type { PrismaClient } from '@prisma/client';

/**
 * Idempotently ensure the pgvector extension + the HNSW cosine index on
 * LibraryChunk.embedding exist. Runs at most once per process (memoised), lazily
 * — so app boot and /healthz stay dependency-free, but anything that indexes or
 * queries embeddings can `await ensurePgvector(prisma)` first and rely on them.
 *
 * Prisma cannot model a pgvector op-class index, so we create it here in raw SQL.
 */
let ensured: Promise<void> | null = null;

export function ensurePgvector(prisma: PrismaClient): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
      await prisma.$executeRawUnsafe(
        'CREATE INDEX IF NOT EXISTS library_chunk_embedding_hnsw ON "LibraryChunk" USING hnsw (embedding vector_cosine_ops)',
      );
    })().catch((err) => {
      ensured = null; // allow a later retry if this attempt failed
      throw err;
    });
  }
  return ensured;
}

/** Render a JS number[] as a pgvector literal string: "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
