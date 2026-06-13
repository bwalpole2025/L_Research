'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, FilePlus, FileText, Loader2, Square, Trash2, X } from 'lucide-react';
import type { DiagnosticSeverity, RunArtifact } from '@latex-studio/shared';
import { api } from '@/lib/api';
import { useEditorStore } from '@/lib/store';
import { useRunStore } from '@/lib/runStore';
import { usePythonCheckStore } from '@/lib/pythonCheckStore';

/**
 * Python "Run" output window: a live console (stdout/stderr distinct), a status
 * line, and a strip of figure thumbnails. Tracebacks that reference a project .py
 * are click-to-jump to the line in the editor.
 */

const TRACEBACK = /File "([^"]+)", line (\d+)/;

// Extensions a browser will render directly in <img>. PDFs (the default capture
// format, vector — best for LaTeX) cannot, so they get a thumbnail/tile instead.
const IMG_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'];
const isImgName = (name: string): boolean => IMG_EXTS.some((e) => name.toLowerCase().endsWith(e));
const isPdfName = (name: string): boolean => name.toLowerCase().endsWith('.pdf');
const extLabel = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? 'FILE' : name.slice(dot + 1).toUpperCase();
};
/** A displayable raster URL for an artefact: its PNG preview, or itself if `<img>`-able. */
function thumbUrlFor(f: RunArtifact): string | null {
  if (f.previewUrl) return api.runArtifactUrl(f.previewUrl);
  if (isImgName(f.name)) return api.runArtifactUrl(f.url);
  return null;
}

const SEV_DOT: Record<DiagnosticSeverity, string> = {
  error: 'bg-rose-500',
  'warning-important': 'bg-amber-500',
  'warning-minor': 'bg-yellow-400',
  info: 'bg-sky-400',
};

interface Row {
  stream: 'stdout' | 'stderr';
  text: string;
  jump?: { path: string; line: number };
}

function statusLine(status: string, exitCode: number | null, durationMs: number | null): { text: string; tone: string } {
  const secs = durationMs != null ? ` · ${(durationMs / 1000).toFixed(2)} s` : '';
  switch (status) {
    case 'running':
      return { text: `Running…${secs}`, tone: 'text-[var(--ls-brand)]' };
    case 'success':
      return { text: `Success (exit 0)${secs}`, tone: 'text-emerald-500' };
    case 'failed':
      return { text: `Failed (exit ${exitCode ?? '?'})${secs}`, tone: 'text-rose-500' };
    case 'timed-out':
      return { text: `Timed out${secs}`, tone: 'text-rose-500' };
    case 'stopped':
      return { text: `Stopped${secs}`, tone: 'text-amber-500' };
    default:
      return { text: 'No run yet — press Run on a .py file.', tone: 'text-[var(--ls-muted)]' };
  }
}

export function PythonOutputPanel() {
  const { running, status, runId, segments, exitCode, durationMs, figures, clear, stop, importFigure } = useRunStore();
  const revealLocation = useEditorStore((s) => s.revealLocation);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const files = useEditorStore((s) => s.files);
  const pyByFile = usePythonCheckStore((s) => s.byFile);
  const pyChecking = usePythonCheckStore((s) => s.checking);
  const pyError = usePythonCheckStore((s) => s.error);
  const lastCheckedPath = usePythonCheckStore((s) => s.lastCheckedPath);
  const activePath = files.find((f) => f.id === activeFileId)?.path;
  const pyDiags = activePath ? pyByFile[activePath] ?? [] : [];
  const showCheck = pyChecking || pyDiags.length > 0 || (!!pyError) || (!!activePath && lastCheckedPath === activePath);
  const [lightbox, setLightbox] = useState<RunArtifact | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // A fresh run clears the "added to files" marks.
  useEffect(() => setAdded(new Set()), [runId]);

  // figure-kind artefacts already live in figures/ (auto-imported); scratch ones don't.
  const inFiles = (f: RunArtifact) => f.kind === 'figure' || added.has(f.path);
  const addOne = async (f: RunArtifact): Promise<void> => {
    if (inFiles(f) || adding) return;
    setAdding(f.path);
    const ok = await importFigure(f.path);
    setAdding(null);
    if (ok) setAdded((s) => new Set(s).add(f.path));
  };
  const addAll = async (): Promise<void> => {
    for (const f of figures) {
      if (inFiles(f)) continue;
      setAdding(f.path);
      const ok = await importFigure(f.path);
      if (ok) setAdded((s) => new Set(s).add(f.path));
    }
    setAdding(null);
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const seg of segments) {
      const lines = seg.text.split('\n');
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      for (const line of lines) {
        const m = TRACEBACK.exec(line);
        const file = m?.[1];
        const lineNo = m?.[2];
        let jump: Row['jump'];
        if (file && lineNo && file.toLowerCase().endsWith('.py')) {
          jump = { path: file.replace(/^\/workspace\//, '').replace(/^\.\//, ''), line: Number(lineNo) };
        }
        out.push({ stream: seg.stream, text: line, ...(jump ? { jump } : {}) });
      }
    }
    return out;
  }, [segments]);

  // Autoscroll to the newest output.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const info = statusLine(status, exitCode, durationMs);
  const copy = () => void navigator.clipboard?.writeText(segments.map((s) => s.text).join('')).catch(() => undefined);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      {/* Status + actions */}
      <div className="flex h-9 flex-none items-center justify-between gap-3 border-b border-[var(--ls-line)] px-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-brand)]" />}
          <span className={info.tone}>{info.text}</span>
        </div>
        <div className="flex items-center gap-1">
          {running && (
            <button
              type="button"
              data-testid="run-stop"
              onClick={() => void stop()}
              className="inline-flex items-center gap-1 rounded-md border border-rose-400 px-2 py-1 text-[11.5px] text-rose-500 transition-colors hover:bg-rose-500/10"
            >
              <Square className="h-3 w-3" /> Stop
            </button>
          )}
          <button type="button" aria-label="Copy output" onClick={copy} className="rounded-md p-1.5 text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button type="button" aria-label="Clear output" onClick={clear} className="rounded-md p-1.5 text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Error-check diagnostics (AI + deterministic syntax) for the active .py file */}
      {showCheck && (
        <div data-testid="python-problems" className="max-h-44 flex-none overflow-auto border-b border-[var(--ls-line)] px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-muted)]">
            <span>Problems{pyDiags.length > 0 ? ` (${pyDiags.length})` : ''}</span>
            {pyChecking && <Loader2 className="h-3 w-3 animate-spin text-[var(--ls-brand)]" />}
          </div>
          {pyError ? (
            <div className="text-[12px] text-rose-500">{pyError}</div>
          ) : !pyChecking && pyDiags.length === 0 ? (
            <div className="text-[12px] text-emerald-500">No problems found.</div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {pyDiags.map((d, i) => (
                <button
                  key={i}
                  type="button"
                  data-testid="python-problem"
                  onClick={() => d.line && activePath && void revealLocation(activePath, d.line, d.column)}
                  className="flex items-start gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-[var(--ls-surface-muted)]"
                >
                  <span className={`mt-[5px] h-2 w-2 flex-none rounded-full ${SEV_DOT[d.severity]}`} aria-hidden />
                  <span className="flex-none tabular-nums text-[var(--ls-muted)]">L{d.line ?? '?'}</span>
                  <span className="text-[var(--ls-text)]">{d.message}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Console */}
      <div ref={scrollRef} data-testid="python-console" className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.5]" style={{ fontFamily: 'var(--ls-mono)' }}>
        {rows.length === 0 ? (
          <div className="text-[var(--ls-muted)]">stdout and stderr will stream here.</div>
        ) : (
          rows.map((r, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words ${r.stream === 'stderr' ? 'text-rose-500' : 'text-[var(--ls-text)]'}`}>
              {r.jump ? (
                <button
                  type="button"
                  onClick={() => void revealLocation(r.jump!.path, r.jump!.line)}
                  className="text-left text-[var(--ls-brand)] underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  {r.text}
                </button>
              ) : (
                r.text || ' '
              )}
            </div>
          ))
        )}
      </div>

      {/* Figures strip */}
      {figures.length > 0 && (
        <div className="flex-none border-t border-[var(--ls-line)] px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-muted)]">Figures</span>
            {figures.some((f) => !inFiles(f)) && (
              <button
                type="button"
                data-testid="figure-add-all"
                disabled={adding !== null}
                onClick={() => void addAll()}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--ls-line)] px-2 py-0.5 text-[11px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)] disabled:opacity-50"
              >
                <FilePlus className="h-3 w-3" /> Add all to files
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {figures.map((f) => (
              <div key={f.path} className="flex flex-col gap-1">
                <button
                  type="button"
                  data-testid="run-figure"
                  onClick={() => setLightbox(f)}
                  title={f.path}
                  className="overflow-hidden rounded-md border border-[var(--ls-line)] bg-[var(--ls-surface-muted)] transition-colors hover:border-[var(--ls-brand)]"
                >
                  {(() => {
                    const thumb = thumbUrlFor(f);
                    return thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={f.name} className="h-20 w-auto max-w-[200px] object-contain" />
                    ) : (
                      // PDF/vector with no raster preview — a labelled document tile.
                      <div className="flex h-20 w-[116px] flex-col items-center justify-center gap-1 text-[var(--ls-muted)]">
                        <FileText className="h-6 w-6" />
                        <span className="text-[10px] font-semibold tracking-wide">{extLabel(f.name)}</span>
                      </div>
                    );
                  })()}
                </button>
                {inFiles(f) ? (
                  <span className="inline-flex items-center justify-center gap-1 text-[10.5px] text-emerald-500" title={`figures/${f.name}`}>
                    <Check className="h-3 w-3" /> In files
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="figure-add"
                    disabled={adding !== null}
                    onClick={() => void addOne(f)}
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-[var(--ls-line)] px-2 py-0.5 text-[10.5px] text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)] disabled:opacity-50"
                  >
                    {adding === f.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <FilePlus className="h-3 w-3" />} Add to files
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enlarge lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setLightbox(null)}>
          <button type="button" aria-label="Close" className="absolute right-4 top-4 rounded-md p-2 text-white/80 hover:text-white" onClick={() => setLightbox(null)}>
            <X className="h-5 w-5" />
          </button>
          {isPdfName(lightbox.name) ? (
            // Render the real PDF, not the raster thumbnail.
            <iframe
              title={lightbox.name}
              src={api.runArtifactUrl(lightbox.url)}
              className="h-full w-full max-w-5xl rounded-lg bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbUrlFor(lightbox) ?? api.runArtifactUrl(lightbox.url)}
              alt={lightbox.name}
              className="max-h-full max-w-full rounded-lg bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
