import type { LiteratureCapabilities, LiteratureResult, LiteratureSource } from '@latex-studio/shared';
import { clean } from './util.js';

/**
 * CrossRef (open REST API, no auth). Search + metadata by query, and BibTeX by
 * DOI via CrossRef's content-negotiation transform. No PDF (publisher-hosted).
 * A polite `mailto` is recommended by CrossRef but optional.
 */
const CROSSREF_API = 'https://api.crossref.org/works';

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
  issued?: { 'date-parts'?: number[][] };
  abstract?: string;
  'container-title'?: string[];
}

export class CrossrefSource implements LiteratureSource {
  readonly capabilities: LiteratureCapabilities = { search: true, metadata: true, bibtex: true, pdf: false };

  async search(query: string): Promise<LiteratureResult[]> {
    const url = `${CROSSREF_API}?query=${encodeURIComponent(query)}&rows=20&select=DOI,title,author,issued,abstract,container-title`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CrossRef search failed (HTTP ${res.status})`);
    const json = (await res.json()) as { message?: { items?: CrossrefItem[] } };
    return (json.message?.items ?? []).map(toResult).filter((r) => r.id);
  }

  async getMetadata(doi: string): Promise<LiteratureResult> {
    const res = await fetch(`${CROSSREF_API}/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CrossRef metadata failed (HTTP ${res.status})`);
    const json = (await res.json()) as { message?: CrossrefItem };
    if (!json.message) throw new Error(`DOI "${doi}" not found`);
    return toResult(json.message);
  }

  /** CrossRef returns ready-made BibTeX via content negotiation. */
  async getBibTeX(doi: string): Promise<string> {
    const res = await fetch(`${CROSSREF_API}/${encodeURIComponent(doi)}/transform/application/x-bibtex`, {
      headers: { Accept: 'application/x-bibtex' },
    });
    if (!res.ok) throw new Error(`CrossRef BibTeX failed (HTTP ${res.status})`);
    return (await res.text()).trim();
  }
}

function toResult(item: CrossrefItem): LiteratureResult {
  const authors = (item.author ?? [])
    .map((a) => (a.family ? `${a.family}, ${a.given ?? ''}`.trim().replace(/,\s*$/, '') : clean(a.name)))
    .filter(Boolean)
    .join(' and ');
  const year = item.issued?.['date-parts']?.[0]?.[0];
  const abstract = clean(item.abstract).replace(/<[^>]+>/g, ''); // strip JATS tags
  return {
    id: clean(item.DOI),
    title: clean(item.title?.[0]),
    authors,
    year: year ? String(year) : '',
    source: 'crossref',
    ...(item.DOI ? { doi: clean(item.DOI) } : {}),
    ...(abstract ? { abstract } : {}),
  };
}
