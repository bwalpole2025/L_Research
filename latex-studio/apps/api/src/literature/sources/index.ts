import type { FastifyInstance } from 'fastify';
import type { LiteratureSource } from '@latex-studio/shared';
import { ArxivSource } from './arxiv.js';
import { CrossrefSource } from './crossref.js';
import { ZoteroSource } from './zotero.js';
import { SemanticScholarSource } from './semanticScholar.js';

/** Typed error so routes can return a clean "connect this source first" prompt. */
export class LiteratureSourceError extends Error {
  constructor(
    readonly kind: 'unknown' | 'needs_key',
    message: string,
  ) {
    super(message);
    this.name = 'LiteratureSourceError';
  }
}

/**
 * Resolve a `LiteratureSource` adapter by connector id, wiring in any API key
 * from the vault (Zotero requires one; Semantic Scholar uses one if present).
 * arXiv + CrossRef are open and need no credential.
 */
export async function literatureSource(app: FastifyInstance, id: string): Promise<LiteratureSource> {
  switch (id) {
    case 'arxiv':
      return new ArxivSource();
    case 'crossref':
      return new CrossrefSource();
    case 'zotero': {
      const cred = await app.vault.get<{ apiKey: string }>('zotero');
      const key = cred?.apiKey ?? app.config.zoteroApiKey;
      if (!key) throw new LiteratureSourceError('needs_key', 'Connect Zotero with an API key first.');
      return new ZoteroSource(key);
    }
    case 'semantic-scholar': {
      const cred = await app.vault.get<{ apiKey: string }>('semantic-scholar');
      const key = cred?.apiKey ?? app.config.semanticScholarApiKey;
      return new SemanticScholarSource(key || undefined);
    }
    default:
      throw new LiteratureSourceError('unknown', `Unknown literature source "${id}".`);
  }
}
