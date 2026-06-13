'use client';

import { useState } from 'react';
import { Download, Loader2, Package, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store';

/**
 * EXPORT PROJECT — download the source tree as a .zip, optionally including the
 * last compiled PDF and the linked literature PDFs. The fetch goes through the
 * same authenticated /api proxy as the PDF download, so no token reaches markup.
 */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectId = useEditorStore((s) => s.projectId);
  const projects = useEditorStore((s) => s.projects);
  const [includePdf, setIncludePdf] = useState(false);
  const [includeLit, setIncludeLit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  const name = projects.find((p) => p.id === projectId)?.name ?? 'project';

  const download = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (includePdf) qs.set('pdf', '1');
      if (includeLit) qs.set('literature', '1');
      const url = `/api/projects/${projectId}/export${qs.toString() ? `?${qs}` : ''}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${name.replace(/[^\w.-]+/g, '-') || 'project'}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 4000);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const row = 'flex items-center gap-2.5 rounded-[9px] px-2 py-2 text-[13.5px] text-[var(--ls-text)]';
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onClose} data-testid="export-dialog">
      <div className="w-full max-w-[440px] overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface-raised)] shadow-[var(--ls-shadow-soft)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--ls-line)] px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
            <Package className="h-4 w-4 text-[var(--ls-muted)]" /> Export project
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-[var(--ls-muted)] hover:text-[var(--ls-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="mb-3 text-[12.5px] text-[var(--ls-muted)]">Download the project's source files (.tex, .bib, figures, …) as a .zip.</p>
          <label className={row}>
            <input type="checkbox" data-testid="export-include-pdf" checked={includePdf} onChange={(e) => setIncludePdf(e.target.checked)} className="h-4 w-4" />
            Include the last compiled PDF
          </label>
          <label className={row}>
            <input type="checkbox" data-testid="export-include-lit" checked={includeLit} onChange={(e) => setIncludeLit(e.target.checked)} className="h-4 w-4" />
            Include literature PDFs (under <code>literature/</code>)
          </label>
          {error && <p className="mt-2 text-[12.5px] text-[#e05c7e]">{error}</p>}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              data-testid="export-download"
              onClick={() => void download()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-[9px] bg-[#4e68f5] px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download .zip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
