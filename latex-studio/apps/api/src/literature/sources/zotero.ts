import type { LiteratureCapabilities, LiteratureResult, LiteratureSource } from '@latex-studio/shared';
import { clean } from './util.js';

/**
 * Zotero Web API (requires the user's API key). Pulls the user's library: items,
 * BibTeX export, and attached PDFs. The numeric userID is derived from the key
 * (GET /keys/<key>), then cached on the instance.
 */
const ZOTERO_API = 'https://api.zotero.org';

interface ZoteroItem {
  key: string;
  data?: {
    title?: string;
    creators?: Array<{ lastName?: string; firstName?: string; name?: string }>;
    date?: string;
    DOI?: string;
    abstractNote?: string;
    contentType?: string;
    itemType?: string;
  };
}

export class ZoteroSource implements LiteratureSource {
  readonly capabilities: LiteratureCapabilities = { search: true, metadata: true, bibtex: true, pdf: true };
  private userId: string | null = null;

  constructor(private readonly apiKey: string) {}

  private headers(): Record<string, string> {
    return { 'Zotero-API-Version': '3', Authorization: `Bearer ${this.apiKey}` };
  }

  private async resolveUserId(): Promise<string> {
    if (this.userId) return this.userId;
    const res = await fetch(`${ZOTERO_API}/keys/${this.apiKey}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Zotero key invalid (HTTP ${res.status})`);
    const json = (await res.json()) as { userID?: number };
    if (!json.userID) throw new Error('Zotero key has no associated user');
    this.userId = String(json.userID);
    return this.userId;
  }

  async search(query: string): Promise<LiteratureResult[]> {
    const uid = await this.resolveUserId();
    const url = `${ZOTERO_API}/users/${uid}/items?q=${encodeURIComponent(query)}&qmode=titleCreatorYear&itemType=-attachment&limit=25&format=json`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`Zotero search failed (HTTP ${res.status})`);
    return ((await res.json()) as ZoteroItem[]).map(toResult);
  }

  async getMetadata(key: string): Promise<LiteratureResult> {
    const uid = await this.resolveUserId();
    const res = await fetch(`${ZOTERO_API}/users/${uid}/items/${key}?format=json`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Zotero item not found (HTTP ${res.status})`);
    return toResult((await res.json()) as ZoteroItem);
  }

  async getBibTeX(key: string): Promise<string> {
    const uid = await this.resolveUserId();
    const res = await fetch(`${ZOTERO_API}/users/${uid}/items/${key}?format=bibtex`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Zotero BibTeX failed (HTTP ${res.status})`);
    return (await res.text()).trim();
  }

  /** The first PDF attachment of an item, if any. */
  async getPDF(key: string): Promise<Uint8Array> {
    const uid = await this.resolveUserId();
    const childRes = await fetch(`${ZOTERO_API}/users/${uid}/items/${key}/children?format=json`, { headers: this.headers() });
    if (!childRes.ok) throw new Error(`Zotero attachments failed (HTTP ${childRes.status})`);
    const children = (await childRes.json()) as ZoteroItem[];
    const pdf = children.find((c) => c.data?.contentType === 'application/pdf');
    if (!pdf) throw new Error('No PDF attachment on this Zotero item');
    const fileRes = await fetch(`${ZOTERO_API}/users/${uid}/items/${pdf.key}/file`, { headers: this.headers() });
    if (!fileRes.ok) throw new Error(`Zotero PDF download failed (HTTP ${fileRes.status})`);
    return new Uint8Array(await fileRes.arrayBuffer());
  }
}

function toResult(item: ZoteroItem): LiteratureResult {
  const d = item.data ?? {};
  const authors = (d.creators ?? [])
    .map((c) => (c.lastName ? `${c.lastName}, ${c.firstName ?? ''}`.trim().replace(/,\s*$/, '') : clean(c.name)))
    .filter(Boolean)
    .join(' and ');
  const year = /(\d{4})/.exec(d.date ?? '')?.[1] ?? '';
  return {
    id: item.key,
    title: clean(d.title),
    authors,
    year,
    source: 'zotero',
    ...(d.DOI ? { doi: clean(d.DOI) } : {}),
    ...(d.abstractNote ? { abstract: clean(d.abstractNote) } : {}),
  };
}
