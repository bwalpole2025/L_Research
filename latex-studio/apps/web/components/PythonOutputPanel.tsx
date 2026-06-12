'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Loader2, Square, Trash2, X } from 'lucide-react';
import type { RunArtifact } from '@latex-studio/shared';
import { api } from '@/lib/api';
import { useEditorStore } from '@/lib/store';
import { useRunStore } from '@/lib/runStore';

/**
 * Python "Run" output window: a live console (stdout/stderr distinct), a status
 * line, and a strip of figure thumbnails. Tracebacks that reference a project .py
 * are click-to-jump to the line in the editor.
 */

const TRACEBACK = /File "([^"]+)", line (\d+)/;

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
  const { running, status, segments, exitCode, durationMs, figures, clear, stop } = useRunStore();
  const revealLocation = useEditorStore((s) => s.revealLocation);
  const [lightbox, setLightbox] = useState<RunArtifact | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
          <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--ls-muted)]">Figures</div>
          <div className="flex flex-wrap gap-2">
            {figures.map((f) => (
              <button
                key={f.path}
                type="button"
                data-testid="run-figure"
                onClick={() => setLightbox(f)}
                title={f.path}
                className="overflow-hidden rounded-md border border-[var(--ls-line)] bg-[var(--ls-surface-muted)] transition-colors hover:border-[var(--ls-brand)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={api.runArtifactUrl(f.url)} alt={f.name} className="h-20 w-auto max-w-[200px] object-contain" />
              </button>
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={api.runArtifactUrl(lightbox.url)} alt={lightbox.name} className="max-h-full max-w-full rounded-lg bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
