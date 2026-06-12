/** Shared helpers for the literature source adapters. */

/** A minimal BibTeX entry built from normalised metadata. */
export interface BibFields {
  key: string;
  type?: string; // @article, @misc, …
  title?: string;
  author?: string; // "Surname, Given and Surname, Given"
  year?: string;
  journal?: string;
  doi?: string;
  url?: string;
  eprint?: string; // arXiv id
  archivePrefix?: string; // "arXiv"
}

/** Render a BibTeX entry. Fields with no value are omitted. */
export function renderBibTeX(f: BibFields): string {
  const lines: string[] = [];
  const add = (k: string, v?: string): void => {
    if (v && v.trim()) lines.push(`  ${k} = {${v.replace(/[{}]/g, '').trim()}}`);
  };
  add('title', f.title);
  add('author', f.author);
  add('year', f.year);
  add('journal', f.journal);
  add('doi', f.doi);
  add('eprint', f.eprint);
  add('archivePrefix', f.archivePrefix);
  add('url', f.url);
  return `@${f.type ?? 'article'}{${f.key},\n${lines.join(',\n')}\n}`;
}

/** A reasonable cite key: firstSurname + year (lowercased, ascii). */
export function citeKeyFrom(authors: string, year: string, fallback: string): string {
  const first = authors.split(/,| and /i)[0]?.trim() ?? '';
  const surname = first.split(/\s+/).pop() ?? '';
  const slug = surname.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = `${slug}${year}`.replace(/[^a-z0-9]/g, '');
  return key || fallback.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'ref';
}

/** Collapse whitespace and trim — for titles/abstracts from XML/JSON. */
export function clean(s: string | undefined | null): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}
