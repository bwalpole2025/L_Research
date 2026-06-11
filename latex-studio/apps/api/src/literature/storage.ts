import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Literature PDFs live on the compile-workspace volume, never in Postgres. */
export function literatureAbsPath(workspace: string, projectId: string, storagePath: string): string {
  return join(workspace, projectId, storagePath);
}

export async function writeLiteraturePdf(
  workspace: string,
  projectId: string,
  base64: string,
): Promise<{ storagePath: string; size: number }> {
  const storagePath = `literature/${randomUUID()}.pdf`;
  const abs = literatureAbsPath(workspace, projectId, storagePath);
  await mkdir(dirname(abs), { recursive: true });
  const buf = Buffer.from(base64, 'base64');
  await writeFile(abs, buf);
  return { storagePath, size: buf.length };
}

export async function readLiteraturePdf(workspace: string, projectId: string, storagePath: string): Promise<Buffer> {
  return readFile(literatureAbsPath(workspace, projectId, storagePath));
}

export async function deleteLiteraturePdf(workspace: string, projectId: string, storagePath: string): Promise<void> {
  await unlink(literatureAbsPath(workspace, projectId, storagePath)).catch(() => undefined);
}

export interface PdfExtraction {
  text: string;
  pageCount: number;
  title: string;
  author: string;
}

/** Extract full text + offline metadata via the mathcheck PyMuPDF route. */
export async function extractViaMathcheck(mathcheckUrl: string, base64: string): Promise<PdfExtraction> {
  try {
    const res = await fetch(`${mathcheckUrl}/extract-pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdf_base64: base64 }),
    });
    const data = (await res.json()) as Partial<PdfExtraction>;
    return { text: data.text ?? '', pageCount: data.pageCount ?? 0, title: data.title ?? '', author: data.author ?? '' };
  } catch {
    return { text: '', pageCount: 0, title: '', author: '' };
  }
}

/** Optional DOI enrichment via Crossref (https://api.crossref.org). NETWORK — only
 *  ever called when the user explicitly enables it; never auto-fetched. */
export async function enrichFromCrossref(
  doi: string,
): Promise<{ title?: string; authors?: string; year?: string; abstract?: string } | null> {
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      message?: {
        title?: string[];
        author?: Array<{ given?: string; family?: string }>;
        issued?: { 'date-parts'?: number[][] };
        abstract?: string;
      };
    };
    const m = data.message ?? {};
    const authors = (m.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(', ');
    const year = m.issued?.['date-parts']?.[0]?.[0];
    return {
      ...(m.title?.[0] ? { title: m.title[0] } : {}),
      ...(authors ? { authors } : {}),
      ...(year ? { year: String(year) } : {}),
      ...(m.abstract ? { abstract: m.abstract.replace(/<[^>]+>/g, '').trim() } : {}),
    };
  } catch {
    return null;
  }
}
