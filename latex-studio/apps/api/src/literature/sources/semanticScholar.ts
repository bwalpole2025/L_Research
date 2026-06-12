import type { LiteratureCapabilities, LiteratureResult, LiteratureSource } from '@latex-studio/shared';
import { clean } from './util.js';

/**
 * Semantic Scholar Graph API. Works without a key (rate-limited); an optional
 * API key raises limits. Search + metadata + BibTeX (S2 returns a ready-made
 * BibTeX in `citationStyles`). PDFs are not fetched here — only open-access links
 * are exposed by S2 and publisher rights vary, so we keep to metadata.
 */
const S2_API = 'https://api.semanticscholar.org/graph/v1';
const FIELDS = 'title,authors,year,abstract,externalIds,citationStyles';

interface S2Paper {
  paperId?: string;
  title?: string;
  authors?: Array<{ name?: string }>;
  year?: number;
  abstract?: string;
  externalIds?: { DOI?: string };
  citationStyles?: { bibtex?: string };
}

export class SemanticScholarSource implements LiteratureSource {
  readonly capabilities: LiteratureCapabilities = { search: true, metadata: true, bibtex: true, pdf: false };

  constructor(private readonly apiKey?: string) {}

  private headers(): Record<string, string> {
    return this.apiKey ? { 'x-api-key': this.apiKey } : {};
  }

  async search(query: string): Promise<LiteratureResult[]> {
    const url = `${S2_API}/paper/search?query=${encodeURIComponent(query)}&limit=20&fields=${FIELDS}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Semantic Scholar search failed (HTTP ${res.status})`);
    const json = (await res.json()) as { data?: S2Paper[] };
    return (json.data ?? []).map(toResult).filter((r) => r.id);
  }

  async getMetadata(id: string): Promise<LiteratureResult> {
    const res = await fetch(`${S2_API}/paper/${encodeURIComponent(id)}?fields=${FIELDS}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Semantic Scholar metadata failed (HTTP ${res.status})`);
    return toResult((await res.json()) as S2Paper);
  }

  async getBibTeX(id: string): Promise<string> {
    const res = await fetch(`${S2_API}/paper/${encodeURIComponent(id)}?fields=citationStyles,title,authors,year,externalIds`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Semantic Scholar BibTeX failed (HTTP ${res.status})`);
    const paper = (await res.json()) as S2Paper;
    const bib = paper.citationStyles?.bibtex;
    if (!bib) throw new Error('No BibTeX available for this paper');
    return bib.trim();
  }
}

function toResult(p: S2Paper): LiteratureResult {
  return {
    id: clean(p.paperId),
    title: clean(p.title),
    authors: (p.authors ?? []).map((a) => clean(a.name)).filter(Boolean).join(' and '),
    year: p.year ? String(p.year) : '',
    source: 'semantic-scholar',
    ...(p.externalIds?.DOI ? { doi: clean(p.externalIds.DOI) } : {}),
    ...(p.abstract ? { abstract: clean(p.abstract) } : {}),
  };
}
