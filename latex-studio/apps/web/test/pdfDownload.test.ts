import { describe, expect, it } from 'vitest';
import { pdfDownloadName } from '../components/PdfViewer';

describe('pdfDownloadName — filename follows what is displayed', () => {
  it('clean PDF is named after the project root file', () => {
    expect(pdfDownloadName('BW_EP_manuscript.tex', 'clean', null)).toBe('BW_EP_manuscript.pdf');
    expect(pdfDownloadName('chapters/main.tex', 'clean', null)).toBe('main.pdf'); // basename only
  });

  it('falls back to document.pdf when no root file is known', () => {
    expect(pdfDownloadName(null, 'clean', null)).toBe('document.pdf');
    expect(pdfDownloadName('.tex', 'clean', null)).toBe('document.pdf');
  });

  it('review mode appends .review', () => {
    expect(pdfDownloadName('main.tex', 'review', null)).toBe('main.review.pdf');
  });

  it('literature mode uses the sanitised article title', () => {
    expect(pdfDownloadName('main.tex', 'literature', 'Solitary waves: a "review"?')).toBe('Solitary waves a review.pdf');
    expect(pdfDownloadName('main.tex', 'literature', null)).toBe('article.pdf');
  });
});
