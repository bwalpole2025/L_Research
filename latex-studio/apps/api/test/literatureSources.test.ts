import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArxivSource, parseFeed } from '../src/literature/sources/arxiv.js';
import { CrossrefSource } from '../src/literature/sources/crossref.js';
import { SemanticScholarSource } from '../src/literature/sources/semanticScholar.js';
import { citeKeyFrom, renderBibTeX } from '../src/literature/sources/util.js';

afterEach(() => vi.unstubAllGlobals());

const ARXIV_FEED = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.01234v2</id>
    <title>Solitary waves on a falling film</title>
    <summary>We study depression solitons.</summary>
    <published>2024-01-03T00:00:00Z</published>
    <author><name>A. Author</name></author>
    <author><name>B. Coauthor</name></author>
  </entry>
</feed>`;

describe('util', () => {
  it('renderBibTeX omits empty fields and escapes braces', () => {
    const bib = renderBibTeX({ key: 'author2024', type: 'article', title: 'A {Title}', author: 'Author, A', year: '2024' });
    expect(bib).toContain('@article{author2024,');
    expect(bib).toContain('title = {A Title}');
    expect(bib).not.toContain('journal'); // omitted
  });
  it('citeKeyFrom builds surname+year', () => {
    expect(citeKeyFrom('Author, A and Coauthor, B', '2024', 'x')).toBe('author2024');
  });
});

describe('arXiv', () => {
  it('parses the Atom feed into results (bare id, joined authors, year)', () => {
    const [r] = parseFeed(ARXIV_FEED);
    expect(r).toMatchObject({ id: '2401.01234', title: 'Solitary waves on a falling film', year: '2024', source: 'arxiv' });
    expect(r!.authors).toBe('A. Author and B. Coauthor');
  });

  it('search hits the export API and getBibTeX renders an arXiv entry', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(ARXIV_FEED, { status: 200 })));
    const src = new ArxivSource();
    const results = await src.search('falling film');
    expect(results[0]!.id).toBe('2401.01234');
    const bib = await src.getBibTeX('2401.01234');
    expect(bib).toContain('archivePrefix = {arXiv}');
    expect(bib).toContain('eprint = {2401.01234}');
  });

  it('capabilities advertise PDF (arXiv permits)', () => {
    expect(new ArxivSource().capabilities.pdf).toBe(true);
  });
});

describe('CrossRef', () => {
  it('maps items to results and pulls ready-made BibTeX', async () => {
    const item = { DOI: '10.1017/jfm.2019.247', title: ['On waves'], author: [{ given: 'A', family: 'Author' }], issued: { 'date-parts': [[2019]] } };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('x-bibtex')) return new Response('@article{author2019, title={On waves}}', { status: 200 });
        return new Response(JSON.stringify({ message: { items: [item] } }), { status: 200 });
      }),
    );
    const src = new CrossrefSource();
    const [r] = await src.search('waves');
    expect(r).toMatchObject({ doi: '10.1017/jfm.2019.247', year: '2019', source: 'crossref' });
    expect(r!.authors).toBe('Author, A');
    expect(await src.getBibTeX('10.1017/jfm.2019.247')).toContain('@article{author2019');
    expect(src.capabilities.pdf).toBe(false); // publisher PDFs not fetched
  });
});

describe('Semantic Scholar', () => {
  it('maps papers and returns the S2 citationStyles BibTeX', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('fields=citationStyles')) return new Response(JSON.stringify({ citationStyles: { bibtex: '@article{x2020}' } }), { status: 200 });
        return new Response(JSON.stringify({ data: [{ paperId: 'abc', title: 'T', authors: [{ name: 'A' }], year: 2020, externalIds: { DOI: '10/x' } }] }), { status: 200 });
      }),
    );
    const src = new SemanticScholarSource();
    const [r] = await src.search('q');
    expect(r).toMatchObject({ id: 'abc', year: '2020', doi: '10/x', source: 'semantic-scholar' });
    expect(await src.getBibTeX('abc')).toBe('@article{x2020}');
  });
});
