'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageViewport, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Loader2,
  Maximize,
  Play,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useEditorStore } from '@/lib/store';

type PdfMode = 'light' | 'dim' | 'invert';

const MODE_FILTER: Record<PdfMode, string> = {
  light: 'none',
  dim: 'brightness(0.86) contrast(1.02)',
  invert: 'invert(0.92) hue-rotate(180deg)',
};

interface Highlight {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  nonce: number;
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
  const compiling = useEditorStore((s) => s.compiling);
  const theme = useEditorStore((s) => s.theme);
  const forwardHighlight = useEditorStore((s) => s.forwardHighlight);
  const compileProject = useEditorStore((s) => s.compileProject);
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
    if (!pdfUrl) {
      setNumPages(0);
      return;
    }
    let cancelled = false;
    void (async () => {
      const pdfjs = await loadPdfjs();
      const task = pdfjs.getDocument({ url: pdfUrl, disableRange: true, disableStream: true });
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
  }, [pdfUrl]);

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

  const hasPdf = Boolean(pdfUrl) && numPages > 0;

  return (
    <div className="flex h-full flex-col bg-slate-100 dark:bg-slate-900/40">
      {/* Header / controls */}
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          aria-label="Previous page"
          disabled={!hasPdf || currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          {hasPdf ? `${currentPage} / ${numPages}` : '– / –'}
        </span>
        <button
          type="button"
          aria-label="Next page"
          disabled={!hasPdf || currentPage >= numPages}
          onClick={() => goToPage(currentPage + 1)}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div className="mx-1 h-4 w-px bg-slate-300 dark:bg-slate-700" />

        <button
          type="button"
          aria-label="Zoom out"
          disabled={!hasPdf}
          onClick={() => zoom(-0.2)}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-10 text-center tabular-nums text-slate-500 dark:text-slate-400">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={!hasPdf}
          onClick={() => zoom(0.2)}
          className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fit width"
          title="Fit width"
          disabled={!hasPdf}
          onClick={() => setFitWidth(true)}
          className={`rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800 ${
            fitWidth ? 'text-sky-600 dark:text-sky-400' : ''
          }`}
        >
          <Maximize className="h-4 w-4" />
        </button>

        <div className="ml-auto flex items-center gap-1">
          <select
            aria-label="PDF color mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as PdfMode)}
            className="rounded border border-slate-300 bg-transparent px-1 py-0.5 text-xs dark:border-slate-700"
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
            className="rounded p-1 hover:bg-slate-200 disabled:opacity-40 dark:hover:bg-slate-800"
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => void compileProject()}
            disabled={compiling}
            className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-1 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {compiling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Compile
          </button>
        </div>
      </div>

      {/* Pages */}
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-auto"
        data-testid="pdf-scroll"
      >
        {!hasPdf ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            {compiling ? (
              <>
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Compiling…</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No preview yet</p>
                <p className="max-w-xs text-xs text-slate-400 dark:text-slate-500">
                  Press <kbd className="rounded border px-1">⌘↵</kbd> or Compile to build the PDF.
                </p>
                <button
                  type="button"
                  onClick={() => void compileProject()}
                  className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                >
                  Compile
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 p-3" style={{ filter: MODE_FILTER[mode] }}>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <div
                key={p}
                ref={(el) => {
                  if (el) pageRefs.current.set(p, el);
                  else pageRefs.current.delete(p);
                }}
                onClick={(e) => onPageClick(e, p)}
                className="relative shadow-md"
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
