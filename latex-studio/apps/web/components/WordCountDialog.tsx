'use client';

import { useEffect, useState } from 'react';
import { Hash, Loader2, X } from 'lucide-react';
import type { WordCountResult } from '@latex-studio/shared';
import { useEditorStore } from '@/lib/store';
import { api, ApiError } from '@/lib/api';

/**
 * WORD COUNT — a LaTeX-aware count via texcount on the server (it follows
 * \input/\include, ignores markup, and splits words in text / headers /
 * captions). Shows the document total and a per-file/included-file breakdown.
 */
export function WordCountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useEditorStore((s) => s.projectId);
  const [data, setData] = useState<WordCountResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    setData(null);
    setError(null);
    setLoading(true);
    api
      .wordCount(projectId)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not count words.'))
      .finally(() => setLoading(false));
  }, [open, projectId]);

  if (!open) return null;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose} data-testid="wordcount-dialog">
      <div className="w-full max-w-[520px] overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface-raised)] shadow-[var(--ls-shadow-soft)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--ls-line)] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
            <Hash className="h-4 w-4 text-[var(--ls-muted)]" /> Word count
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-[var(--ls-muted)] hover:text-[var(--ls-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-[var(--ls-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Counting…
          </div>
        )}
        {error && <p className="px-5 py-8 text-center text-[13px] text-[#e05c7e]">{error}</p>}

        {data && (
          <div className="px-5 py-4">
            <div className="mb-3 flex items-baseline gap-2">
              <span data-testid="wordcount-total" className="text-[28px] font-semibold tabular-nums text-[var(--ls-text)]">{fmt(data.total.words)}</span>
              <span className="text-[13px] text-[var(--ls-muted)]">words in text</span>
            </div>
            <p className="mb-4 text-[12.5px] text-[var(--ls-muted)]">
              + {fmt(data.total.headers)} in headings · {fmt(data.total.captions)} in captions
            </p>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--ls-line)] text-left text-[11px] uppercase tracking-wide text-[var(--ls-muted)]">
                  <th className="py-1.5 font-medium">File</th>
                  <th className="py-1.5 text-right font-medium">Text</th>
                  <th className="py-1.5 text-right font-medium">Head</th>
                  <th className="py-1.5 text-right font-medium">Capt</th>
                </tr>
              </thead>
              <tbody data-testid="wordcount-files">
                {data.files.map((f) => (
                  <tr key={f.file} className="border-b border-[var(--ls-line)] last:border-0">
                    <td className="truncate py-1.5 pr-2 text-[var(--ls-text)]" title={f.file}>{f.file}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ls-text)]">{fmt(f.words)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ls-muted)]">{fmt(f.headers)}</td>
                    <td className="py-1.5 text-right tabular-nums text-[var(--ls-muted)]">{fmt(f.captions)}</td>
                  </tr>
                ))}
                {data.files.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-[var(--ls-muted)]">No counted files.</td></tr>
                )}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-[var(--ls-muted)]">Counted with texcount (follows \input/\include; ignores LaTeX markup).</p>
          </div>
        )}
      </div>
    </div>
  );
}
