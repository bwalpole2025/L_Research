declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  interface TextItem {
    str?: string;
  }
  interface PDFPage {
    getTextContent(): Promise<{ items: TextItem[] }>;
    cleanup(): void;
  }
  interface PDFDocument {
    numPages: number;
    getPage(n: number): Promise<PDFPage>;
    destroy(): Promise<void>;
  }
  interface LoadingTask {
    promise: Promise<PDFDocument>;
  }
  export function getDocument(opts: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): LoadingTask;
}
