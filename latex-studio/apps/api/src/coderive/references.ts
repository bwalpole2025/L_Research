import type { ReferenceContext } from '@latex-studio/shared';
import { parseBib, type BibEntry } from './bib.js';
import { extractPdfText } from './pdf.js';
import { stripLatex } from '../prose/strip.js';

export interface RefFile {
  path: string;
  content: string;
  encoding: string;
}

/** path:length → extracted text (extractions are expensive; cache them). */
const textCache = new Map<string, string>();

export function clearReferenceCache(): void {
  textCache.clear();
}

function basenameNoExt(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/\.[^.]+$/, '');
}

/** Locate a project file that is plausibly the source of cite `key`. */
function findSourceFile(key: string, entry: BibEntry | undefined, files: RefFile[]): RefFile | undefined {
  const lowerKey = key.toLowerCase();
  if (entry?.file) {
    const path = entry.file.split(/[:;]/).find((p) => /\.(pdf|tex|txt|md)/i.test(p)) ?? entry.file;
    const target = basenameNoExt(path).toLowerCase();
    const byField = files.find((f) => basenameNoExt(f.path).toLowerCase() === target);
    if (byField) return byField;
  }
  return files.find((f) => {
    if (!/\.(pdf|tex|txt|md)$/i.test(f.path)) return false;
    const b = basenameNoExt(f.path).toLowerCase();
    return b === lowerKey || b.includes(lowerKey);
  });
}

async function extractText(file: RefFile): Promise<string> {
  const cacheKey = `${file.path}:${file.content.length}`;
  const cached = textCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let text = '';
  if (file.encoding === 'base64' && /\.pdf$/i.test(file.path)) {
    text = await extractPdfText(file.content);
  } else if (file.encoding !== 'base64') {
    text = /\.(tex|sty|cls)$/i.test(file.path) ? stripLatex(file.content).prose : file.content;
  }
  textCache.set(cacheKey, text);
  return text;
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'or', 'for', 'is', 'are', 'on', 'with', 'by', 'we', 'that',
  'this', 'as', 'at', 'it', 'be', 'from', 'which', 'using', 'use', 'can', 'where', 'these', 'such', 'when',
]);

function keywords(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/** Top passages of `text` most relevant to the query terms (not the whole document). */
function bestPassages(text: string, queryTerms: string[], max = 3, passageLen = 600): string[] {
  if (!text.trim() || queryTerms.length === 0) return [];
  const paras = text
    .split(/\n{2,}|(?<=[.?!])\s{2,}/)
    .map((c) => c.replace(/\s+/g, ' ').trim())
    .filter((c) => c.length > 40);
  const candidates =
    paras.length > 1 ? paras : (text.match(/[\s\S]{1,600}/g) ?? []).map((c) => c.replace(/\s+/g, ' ').trim());
  const terms = new Set(queryTerms);
  const scored = candidates.map((c) => {
    let score = 0;
    for (const w of c.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []) if (terms.has(w)) score += 1;
    return { passage: c.slice(0, passageLen), score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((s) => s.passage);
}

/** A linked Literature-library article, keyed by cite key (see literature/refs.ts). */
export interface LibraryRef {
  itemId: string;
  title: string;
  authors: string;
  year: string;
  abstract: string | null;
  extractedText: string | null;
  fileName: string;
}

/**
 * Assemble reference context for the cited keys, graded by what is actually
 * available locally. NEVER fetches from the web — only project files + the
 * linked Literature library are read. A linked article with extracted text is
 * "full-text (library)"; a linked article with no text, or a bare .bib entry, is
 * "metadata-only" — preserving the honesty contract (no source ⇒ no contradiction).
 */
export async function buildReferences(
  citedKeys: string[],
  files: RefFile[],
  queryText: string,
  libraryItems?: Map<string, LibraryRef>,
): Promise<ReferenceContext[]> {
  const bibContent = files
    .filter((f) => f.path.endsWith('.bib') && f.encoding !== 'base64')
    .map((f) => f.content)
    .join('\n');
  const entries = parseBib(bibContent);
  const queryTerms = keywords(queryText);

  const out: ReferenceContext[] = [];
  for (const key of citedKeys) {
    const entry = entries.get(key);
    const ref: ReferenceContext = {
      key,
      ...(entry?.author ? { author: entry.author } : {}),
      ...(entry?.title ? { title: entry.title } : {}),
      ...(entry?.year ? { year: entry.year } : {}),
      ...(entry?.abstract ? { abstract: entry.abstract } : {}),
      provenance: entry ? 'metadata-only' : 'not-found',
    };

    // 1) A linked library article takes precedence (it carries the source text).
    const lib = libraryItems?.get(key);
    if (lib) {
      if (lib.title) ref.title = lib.title;
      if (lib.authors) ref.author = lib.authors;
      if (lib.year) ref.year = lib.year;
      if (lib.abstract) ref.abstract = lib.abstract;
      ref.library = true;
      const text = lib.extractedText ?? '';
      if (text.trim()) {
        const terms = [...new Set([...queryTerms, ...keywords(lib.title)])];
        const passages = bestPassages(text, terms);
        if (passages.length > 0) {
          ref.passages = passages;
          ref.sourceFile = `library: ${lib.fileName || lib.title || key}`;
          ref.provenance = 'full-text';
          out.push(ref);
          continue;
        }
      }
      // Linked but no usable text → metadata-only; do NOT fabricate full-text.
      ref.provenance = 'metadata-only';
      out.push(ref);
      continue;
    }

    // 2) Otherwise, a matching source file in the project.
    const source = findSourceFile(key, entry, files);
    if (source) {
      const text = await extractText(source);
      const terms = [...new Set([...queryTerms, ...keywords(entry?.title ?? '')])];
      const passages = bestPassages(text, terms);
      if (passages.length > 0) {
        ref.passages = passages;
        ref.sourceFile = source.path;
        ref.provenance = 'full-text';
      } else if (text.trim()) {
        ref.sourceFile = source.path;
      }
    }
    out.push(ref);
  }
  return out;
}
