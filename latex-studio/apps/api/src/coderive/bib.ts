export interface BibEntry {
  key: string;
  type: string;
  author?: string;
  title?: string;
  year?: string;
  abstract?: string;
  /** Raw `file`/`url` field, used to locate the cited work's source in the project. */
  file?: string;
  url?: string;
}

/** Read a brace- or quote-delimited field value starting at `start`. */
function readValue(s: string, start: number): { value: string; end: number } | null {
  let i = start;
  while (i < s.length && /\s/.test(s[i]!)) i += 1;
  const open = s[i];
  if (open === '{') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') depth += 1;
      else if (s[j] === '}') {
        depth -= 1;
        if (depth === 0) return { value: s.slice(i + 1, j).replace(/\s+/g, ' ').trim(), end: j + 1 };
      }
    }
    return null;
  }
  if (open === '"') {
    const close = s.indexOf('"', i + 1);
    if (close === -1) return null;
    return { value: s.slice(i + 1, close).replace(/\s+/g, ' ').trim(), end: close + 1 };
  }
  // bare value (number / macro) up to comma or closing brace
  const m = /^[^,}\n]+/.exec(s.slice(i));
  if (m) return { value: m[0].trim(), end: i + m[0].length };
  return null;
}

/** Parse the entries out of one or more .bib files into a key→entry map. */
export function parseBib(content: string): Map<string, BibEntry> {
  const entries = new Map<string, BibEntry>();
  const entryRe = /@(\w+)\s*\{\s*([^,\s}]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(content)) !== null) {
    const type = (m[1] ?? '').toLowerCase();
    const key = (m[2] ?? '').trim();
    if (!key || type === 'comment' || type === 'string' || type === 'preamble') continue;

    const entry: BibEntry = { key, type };
    const fieldRe = /(\w+)\s*=\s*/g;
    fieldRe.lastIndex = entryRe.lastIndex;
    let f: RegExpExecArray | null;
    // Stop at the matching closing brace of this entry.
    let depth = 1;
    let scan = entryRe.lastIndex;
    while (scan < content.length && depth > 0) {
      if (content[scan] === '{') depth += 1;
      else if (content[scan] === '}') depth -= 1;
      scan += 1;
    }
    const entryEnd = scan;
    while ((f = fieldRe.exec(content)) !== null && fieldRe.lastIndex <= entryEnd) {
      const name = (f[1] ?? '').toLowerCase();
      const read = readValue(content, fieldRe.lastIndex);
      if (!read) break;
      fieldRe.lastIndex = read.end;
      if (name === 'author') entry.author = read.value;
      else if (name === 'title') entry.title = read.value;
      else if (name === 'year') entry.year = read.value;
      else if (name === 'abstract') entry.abstract = read.value;
      else if (name === 'file') entry.file = read.value;
      else if (name === 'url') entry.url = read.value;
    }
    entries.set(key, entry);
    entryRe.lastIndex = entryEnd;
  }
  return entries;
}
