'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageViewport, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  Loader2,
  Maximize,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useReviewStore } from '@/lib/reviewStore';

type PdfMode = 'light' | 'dim' | 'invert';

const MODE_FILTER: Record<PdfMode, string> = {
  light: 'none',
  dim: 'brightness(0.86) contrast(1.02)',
  invert: 'invert(0.92) hue-rotate(180deg)',
};

const pdfButton =
  'inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-950 disabled:pointer-events-none disabled:opacity-35 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';

interface Highlight {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nonce: number;
}

/** Filename for the downloaded PDF, derived from what is being viewed.
 *  Exported for tests. */
export function pdfDownloadName(
  rootFile: string | null,
  mode: 'clean' | 'review' | 'literature',
  literatureTitle: string | null,
): string {
  if (mode === 'literature') {
    const title = (literatureTitle ?? '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${title || 'article'}.pdf`;
  }
  const base = (rootFile ?? 'document').split('/').pop()!.replace(/\.tex$/i, '') || 'document';
  return mode === 'review' ? `${base}.review.pdf` : `${base}.pdf`;
}

// Lazy-loaded so pdf.js (browser-only) is never evaluated during SSR.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

export function PdfViewer() {
  const pdfUrl = useEditorStore((s) => s.pdfUrl);
  const reviewMode = useReviewStore((s) => s.pdfMode);
  const reviewPdfUrl = useReviewStore((s) => s.reviewPdfUrl);
  const literaturePdfUrl = useReviewStore((s) => s.literaturePdfUrl);
  const literatureTitle = useReviewStore((s) => s.literatureTitle);
  const setReviewMode = useReviewStore((s) => s.setPdfMode);
  // What is actually displayed (the review/literature toggles fall back to the
  // clean PDF when their URL is missing) — the download follows this too.
  const effectiveMode: 'clean' | 'review' | 'literature' =
    reviewMode === 'literature' && literaturePdfUrl ? 'literature' : reviewMode === 'review' && reviewPdfUrl ? 'review' : 'clean';
  const effectiveUrl =
    effectiveMode === 'literature' ? literaturePdfUrl : effectiveMode === 'review' ? reviewPdfUrl : pdfUrl;
  const rootFile = useEditorStore((s) => s.projects.find((p) => p.id === s.projectId)?.rootFile ?? null);
  const compiling = useEditorStore((s) => s.compiling);
  const theme = useEditorStore((s) => s.theme);
  const forwardHighlight = useEditorStore((s) => s.forwardHighlight);
  const locateInPdf = useEditorStore((s) => s.locateInPdf);
  const syncInverseJump = useEditorStore((s) => s.syncInverseJump);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderSeq = useRef(0);
  const renderTasks = useRef<RenderTask[]>([]);
  const baseWidth = useRef(612);
  const scaleRef = useRef(1.2);

  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [fitWidth, setFitWidth] = useState(true);
  const [renderNonce, setRenderNonce] = useState(0);
  const [mode, setMode] = useState<PdfMode>(theme === 'dark' ? 'dim' : 'light');
  const [highlight, setHighlight] = useState<Highlight | null>(null);

  scaleRef.current = scale;

  const renderAll = useCallback(async () => {
    const doc = docRef.current;
    const container = containerRef.current;
    if (!doc || !container) return;

    const seq = ++renderSeq.current;
    renderTasks.current.forEach((t) => {
      try {
        t.cancel();
      } catch {
        /* noop */
      }
    });
    renderTasks.current = [];

    const ratio = container.scrollHeight > 0 ? container.scrollTop / container.scrollHeight : 0;
    const dpr = window.devicePixelRatio || 1;
    const s = scaleRef.current;

    for (let p = 1; p <= doc.numPages; p++) {
      if (seq !== renderSeq.current) return;
      const canvas = canvasRefs.current.get(p);
      if (!canvas) continue;
      const page = await doc.getPage(p);
      const viewport: PageViewport = page.getViewport({ scale: s });
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const task = page.render(
        dpr !== 1
          ? { canvasContext: ctx, viewport, transform: [dpr, 0, 0, dpr, 0, 0] }
          : { canvasContext: ctx, viewport },
      );
      renderTasks.current.push(task);
      try {
        await task.promise;
      } catch {
        /* cancelled by a newer render */
      }
    }

    if (seq === renderSeq.current) {
      container.scrollTop = ratio * container.scrollHeight;
    }
  }, []);

  // Load the document whenever the PDF URL changes.
  useEffect(() => {
    if (!effectiveUrl) {
      setNumPages(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({ url: effectiveUrl, disableRange: true, disableStream: true });
      try {
        const doc = await task.promise;
        if (cancelled) {
          void doc.destroy();
          return;
        }
        const previous = docRef.current;
        docRef.current = doc;
        const first = await doc.getPage(1);
        baseWidth.current = first.getViewport({ scale: 1 }).width;
        setNumPages(doc.numPages);
        setRenderNonce((n) => n + 1);
        if (previous && previous !== doc) void previous.destroy();
      } catch {
        /* failed to load — keep showing the previous PDF */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveUrl]);

  // Re-render pages when the page set, scale, or document changes.
  useEffect(() => {
    if (numPages > 0) void renderAll();
  }, [numPages, scale, renderNonce, renderAll]);

  // Fit-width: recompute scale from the container width.
  const recomputeFit = useCallback(() => {
    const container = containerRef.current;
    if (!container || !baseWidth.current) return;
    const available = container.clientWidth - 24;
    setScale(Math.max(0.3, Math.min(4, available / baseWidth.current)));
  }, []);

  useEffect(() => {
    if (fitWidth) recomputeFit();
  }, [fitWidth, numPages, recomputeFit]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (fitWidth) recomputeFit();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [fitWidth, recomputeFit]);

  // Track the page nearest the top of the viewport.
  const onScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const top = container.scrollTop;
    let best = 1;
    let bestDelta = Infinity;
    pageRefs.current.forEach((el, p) => {
      const delta = Math.abs(el.offsetTop - top);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = p;
      }
    });
    setCurrentPage(best);
  }, []);

  const goToPage = useCallback((p: number) => {
    const el = pageRefs.current.get(p);
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  // Forward SyncTeX highlight (locate-in-PDF): scroll to + flash a region.
  useEffect(() => {
    if (!forwardHighlight) return;
    goToPage(forwardHighlight.page);
    setHighlight({ ...forwardHighlight });
    const t = window.setTimeout(() => setHighlight(null), 1800);
    return () => window.clearTimeout(t);
  }, [forwardHighlight, goToPage]);

  // Cmd/Ctrl+click → inverse SyncTeX.
  const onPageClick = (e: React.MouseEvent, page: number) => {
    if (!e.metaKey && !e.ctrlKey) return;
    const canvas = canvasRefs.current.get(page);
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    void syncInverseJump(page, x, y);
  };

  const zoom = (delta: number) => {
    setFitWidth(false);
    setScale((s) => Math.max(0.3, Math.min(4, Math.round((s + delta) * 100) / 100)));
  };

  const hasPdf = Boolean(effectiveUrl) && numPages > 0;

  // Download the displayed PDF. The fetch goes through the same authenticated
  // /api proxy as the viewer, so no token ever reaches the markup.
  const downloadPdf = useCallback(async () => {
    if (!effectiveUrl) return;
    try {
      const res = await fetch(effectiveUrl);
      if (!res.ok) return;
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = pdfDownloadName(rootFile, effectiveMode, literatureTitle);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 4000);
    } catch {
      /* network hiccup — nothing downloaded */
    }
  }, [effectiveUrl, rootFile, effectiveMode, literatureTitle]);

  // The editor top bar's download icon triggers the same download.
  useEffect(() => {
    const onDownload = () => void downloadPdf();
    window.addEventListener('ls:download-pdf', onDownload);
    return () => window.removeEventListener('ls:download-pdf', onDownload);
  }, [downloadPdf]);

  return (
    <div className="flex h-full flex-col bg-zinc-100 dark:bg-zinc-950">
      <div className="flex h-10 items-center gap-1 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-2 text-xs dark:border-zinc-800">
        {reviewMode === 'literature' && literaturePdfUrl && (
          <>
            <button
              type="button"
              data-testid="pdf-back-clean"
              onClick={() => setReviewMode('clean')}
              className="rounded-md border border-zinc-200 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              ← Clean
            </button>
            <span className="max-w-48 truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400" title={literatureTitle ?? ''}>
              📄 {literatureTitle ?? 'Article'}
            </span>
            <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
          </>
        )}
        {reviewMode !== 'literature' && reviewPdfUrl && (
          <>
            <div className="flex overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-700" role="tablist">
              <button
                type="button"
                data-testid="pdf-clean"
                onClick={() => setReviewMode('clean')}
                className={`px-2 py-1 text-[11px] font-medium ${reviewMode === 'clean' ? 'bg-blue-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'}`}
              >
                Clean
              </button>
              <button
                type="button"
                data-testid="pdf-review"
                onClick={() => setReviewMode('review')}
                className={`px-2 py-1 text-[11px] font-medium ${reviewMode === 'review' ? 'bg-blue-600 text-white' : 'bg-white text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300'}`}
              >
                Review
              </button>
            </div>
            <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
          </>
        )}
        <button
          type="button"
          aria-label="Previous page"
          disabled={!hasPdf || currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
          className={pdfButton}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-12 text-center font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
          {hasPdf ? `${currentPage} / ${numPages}` : '– / –'}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={!hasPdf || currentPage >= numPages}
          onClick={() => goToPage(currentPage + 1)}
          className={pdfButton}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />

        <button
          type="button"
          aria-label="Zoom out"
          disabled={!hasPdf}
          onClick={() => zoom(-0.2)}
          className={pdfButton}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-11 text-center font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={!hasPdf}
          onClick={() => zoom(0.2)}
          className={pdfButton}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fit width"
          title="Fit width"
          disabled={!hasPdf}
          onClick={() => setFitWidth(true)}
          className={`${pdfButton} ${
            fitWidth ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300' : ''
          }`}
        >
          <Maximize className="h-4 w-4" />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <select
            aria-label="PDF color mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as PdfMode)}
            className="h-7 rounded-md border border-zinc-200 bg-white px-2 text-xs font-medium text-zinc-700 outline-none transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700"
          >
            <option value="light">Light page</option>
            <option value="dim">Dimmed</option>
            <option value="invert">Inverted</option>
          </select>
          <button
            type="button"
            title="Locate cursor in PDF"
            disabled={!hasPdf}
            onClick={() => void locateInPdf()}
            className={pdfButton}
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Download PDF"
            title="Download PDF"
            data-testid="pdf-download"
            disabled={!hasPdf}
            onClick={() => void downloadPdf()}
            className={pdfButton}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Pages */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-950"
        data-testid="pdf-scroll"
      >
        {!hasPdf ? (
          // While compiling, show progress; otherwise the pane stays empty (the
          // "No preview yet" placeholder was removed — compile from the toolbar).
          compiling ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Compiling…</p>
            </div>
          ) : null
        ) : (
          <div className="flex flex-col items-center gap-4 p-4" style={{ filter: MODE_FILTER[mode] }}>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <div
                key={p}
                ref={(el) => {
                  if (el) pageRefs.current.set(p, el);
                  else pageRefs.current.delete(p);
                }}
                onClick={(e) => onPageClick(e, p)}
                className="relative overflow-hidden rounded-sm bg-white shadow-[0_1px_2px_rgba(18,25,38,0.08),0_22px_44px_rgba(18,25,38,0.16)] ring-1 ring-zinc-950/5 dark:ring-white/10"
                style={{ cursor: 'default' }}
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(p, el);
                    else canvasRefs.current.delete(p);
                  }}
                  className="block bg-white"
                />
                {highlight && highlight.page === p && (
                  <div
                    className="pointer-events-none absolute rounded-sm bg-amber-300/40 ring-2 ring-amber-400 transition-opacity"
                    style={{
                      left: highlight.x * scale,
                      top: highlight.y * scale,
                      width: Math.max(highlight.width * scale, 6),
                      height: Math.max(highlight.height * scale, 12),
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
