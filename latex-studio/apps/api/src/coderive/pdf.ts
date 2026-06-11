/** Extract plain text from a base64-encoded PDF (local; no network). Degrades to "" on any failure. */
export async function extractPdfText(base64: string, maxPages = 60): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const data = new Uint8Array(Buffer.from(base64, 'base64'));
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
    const parts: string[] = [];
    const pages = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => it.str ?? '').join(' '));
      page.cleanup();
    }
    await doc.destroy();
    return parts.join('\n');
  } catch {
    return '';
  }
}
