/**
 * Chunk a document's extracted text into ~400–500-token passages with overlap,
 * preserving char offsets (and, when a page map is available, the source page) so
 * every retrieved passage can be cited back to its location for provenance.
 */

export interface PageOffset {
  page: number;
  charStart: number;
}

export interface TextChunk {
  text: string;
  charStart: number;
  charEnd: number;
  page: number;
}

// ~4 chars/token for English; 450 tokens ≈ 1800 chars, with ~12% overlap.
const TARGET_CHARS = 1800;
const OVERLAP_CHARS = 220;
const MIN_CHARS = 120; // drop trailing scraps shorter than this

/** Map an absolute char offset to its 1-based page using the page-offset table. */
function pageAt(offset: number, pageOffsets: PageOffset[]): number {
  if (pageOffsets.length === 0) return 0;
  let page = pageOffsets[0]!.page;
  for (const po of pageOffsets) {
    if (po.charStart <= offset) page = po.page;
    else break;
  }
  return page;
}

/** Prefer to cut at a paragraph/sentence boundary near the target end. */
function boundary(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  const para = window.lastIndexOf('\n\n');
  if (para > TARGET_CHARS * 0.5) return from + para + 2;
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'));
  if (sentence > TARGET_CHARS * 0.5) return from + sentence + 1;
  return to;
}

export function chunkText(text: string, pageOffsets: PageOffset[] = []): TextChunk[] {
  const clean = text.replace(/\r\n/g, '\n');
  const n = clean.length;
  if (n === 0) return [];
  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < n) {
    const hardEnd = Math.min(start + TARGET_CHARS, n);
    const end = hardEnd >= n ? n : boundary(clean, start, hardEnd);
    const slice = clean.slice(start, end).trim();
    if (slice.length >= MIN_CHARS || (chunks.length === 0 && slice.length > 0)) {
      const charStart = start + (clean.slice(start, end).length - clean.slice(start, end).trimStart().length);
      chunks.push({ text: slice, charStart, charEnd: end, page: pageAt(charStart, pageOffsets) });
    }
    if (end >= n) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return chunks;
}
