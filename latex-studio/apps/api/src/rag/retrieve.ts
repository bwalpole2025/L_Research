import type { PrismaClient } from '@prisma/client';
import type { RetrievedPassage } from '@latex-studio/shared';
import { embedQuery } from './embeddings.js';
import { ensurePgvector, toVectorLiteral } from './pgvector.js';

export interface RetrieveOpts {
  /** Restrict to ONE literature item (citation-content checks). */
  literatureItemId?: string;
  k?: number;
  /** Minimum cosine similarity to count as evidence at all. */
  minScore?: number;
}

interface ChunkRow {
  literatureItemId: string;
  page: number;
  text: string;
  score: number;
  sourceTitle: string | null;
}

/**
 * Retrieve the top-k most similar library passages for a query (cosine, HNSW).
 * Retrieval is LOCAL ONLY: the project's pgvector index, embedded via the local
 * mathcheck model — no external service is ever consulted. Returns [] when the
 * index is empty or nothing clears minScore; callers MUST treat an empty result
 * as "no evidence" (no contradiction may be asserted).
 */
export async function retrievePassages(
  prisma: PrismaClient,
  mathcheckUrl: string,
  projectId: string,
  query: string,
  opts: RetrieveOpts = {},
): Promise<RetrievedPassage[]> {
  const k = opts.k ?? 4;
  const minScore = opts.minScore ?? 0.45;
  if (!query.trim()) return [];
  await ensurePgvector(prisma);
  const vec = toVectorLiteral(await embedQuery(mathcheckUrl, query));

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT c."literatureItemId", c."page", c."text",
            1 - (c."embedding" <=> $1::vector) AS "score",
            i."title" AS "sourceTitle"
       FROM "LibraryChunk" c
       JOIN "LiteratureItem" i ON i."id" = c."literatureItemId"
      WHERE c."projectId" = $2 ${opts.literatureItemId ? 'AND c."literatureItemId" = $4' : ''}
      ORDER BY c."embedding" <=> $1::vector
      LIMIT $3`,
    vec,
    projectId,
    k,
    ...(opts.literatureItemId ? [opts.literatureItemId] : []),
  )) as ChunkRow[];

  return rows
    .filter((r) => Number(r.score) >= minScore)
    .map((r) => ({
      literatureItemId: r.literatureItemId,
      page: r.page,
      text: r.text,
      score: Math.round(Number(r.score) * 1000) / 1000,
      ...(r.sourceTitle ? { sourceTitle: r.sourceTitle } : {}),
    }));
}
