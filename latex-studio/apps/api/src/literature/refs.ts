import type { PrismaClient } from '@prisma/client';
import type { LibraryRef } from '../coderive/references.js';

/** Map each project cite key that is linked to a library article → its metadata + cached text. */
export async function loadLibraryResolver(prisma: PrismaClient, projectId: string): Promise<Map<string, LibraryRef>> {
  const items = await prisma.literatureItem.findMany({
    where: { projectId, NOT: { citeKey: null } },
    select: { id: true, citeKey: true, title: true, authors: true, year: true, abstract: true, extractedText: true, fileName: true },
  });
  const map = new Map<string, LibraryRef>();
  for (const it of items) {
    if (it.citeKey) {
      map.set(it.citeKey, {
        itemId: it.id,
        title: it.title,
        authors: it.authors,
        year: it.year,
        abstract: it.abstract,
        extractedText: it.extractedText,
        fileName: it.fileName,
      });
    }
  }
  return map;
}
