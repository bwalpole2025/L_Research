import type { LiteratureCapabilities, LiteratureResult, LiteratureSource } from '@latex-studio/shared';
import { citeKeyFrom, clean, renderBibTeX } from './util.js';

/**
 * arXiv (open API, no auth). Search + metadata + BibTeX + PDF — arXiv explicitly
 * permits programmatic PDF download. The Atom feed is parsed with small regexes
 * (no XML dependency); enough for the well-formed arXiv responses.
 */
const ARXIV_API = 'http://export.arxiv.org/api/query';

export class ArxivSource implements LiteratureSource {
  readonly capabilities: LiteratureCapabilities = { search: true, metadata: true, bibtex: true, pdf: true };

  async search(query: string): Promise<LiteratureResult[]> {
    const url = `${ARXIV_API}?search_query=${encodeURIComponent(`all:${query}`)}&start=0&max_results=20`;
    const res = await fetch(url, { headers: { Accept: 'application/atom+xml' } });
    if (!res.ok) throw new Error(`arXiv search failed (HTTP ${res.status})`);
    return parseFeed(await res.text());
  }

  async getMetadata(id: string): Promise<LiteratureResult> {
    const url = `${ARXIV_API}?id_list=${encodeURIComponent(normalizeId(id))}`;
    const res = await fetch(url, { headers: { Accept: 'application/atom+xml' } });
    if (!res.ok) throw new Error(`arXiv metadata failed (HTTP ${res.status})`);
    const items = parseFeed(await res.text());
    const item = items[0];
    if (!item) throw new Error(`arXiv id "${id}" not found`);
    return item;
  }

  async getBibTeX(id: string): Promise<string> {
    const m = await this.getMetadata(id);
    const arxivId = normalizeId(id);
    return renderBibTeX({
      key: citeKeyFrom(m.authors, m.year, arxivId),
      type: 'article',
      title: m.title,
      author: m.authors,
      year: m.year,
      eprint: arxivId,
      archivePrefix: 'arXiv',
      url: `https://arxiv.org/abs/${arxivId}`,
      ...(m.doi ? { doi: m.doi } : {}),
    });
  }

  async getPDF(id: string): Promise<Uint8Array> {
    const res = await fetch(`https://arxiv.org/pdf/${normalizeId(id)}.pdf`);
    if (!res.ok) throw new Error(`arXiv PDF failed (HTTP ${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Strip a full arXiv URL / version to the bare id (e.g. "2401.12345"). */
function normalizeId(id: string): string {
  return id.replace(/^https?:\/\/arxiv\.org\/(abs|pdf)\//i, '').replace(/\.pdf$/i, '').replace(/v\d+$/i, '');
}

/** Parse the arXiv Atom feed into LiteratureResults. */
export function parseFeed(xml: string): LiteratureResult[] {
  const out: LiteratureResult[] = [];
  for (const entry of xml.split(/<entry>/).slice(1)) {
    const block = entry.split(/<\/entry>/)[0] ?? '';
    const idRaw = clean(/<id>([^<]+)<\/id>/.exec(block)?.[1]);
    const id = normalizeId(idRaw);
    if (!id) continue;
    const title = clean(/<title>([\s\S]*?)<\/title>/.exec(block)?.[1]);
    const abstract = clean(/<summary>([\s\S]*?)<\/summary>/.exec(block)?.[1]);
    const year = clean(/<published>(\d{4})/.exec(block)?.[1]);
    const authors = [...block.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => clean(m[1])).filter(Boolean).join(' and ');
    const doi = clean(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/.exec(block)?.[1]) || undefined;
    out.push({ id, title, authors, year, source: 'arxiv', ...(abstract ? { abstract } : {}), ...(doi ? { doi } : {}) });
  }
  return out;
}
