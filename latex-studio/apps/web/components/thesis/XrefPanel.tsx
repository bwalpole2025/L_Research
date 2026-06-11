'use client';

import { useEffect, useState } from 'react';
import { CircleAlert, Info, RefreshCw } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore } from '@/lib/thesisStore';
import type { XrefDiagnostic } from '@/lib/types';

function Row({ diag }: { diag: XrefDiagnostic }) {
  const reveal = useEditorStore((s) => s.revealLocation);
  const Icon = diag.severity === 'error' ? CircleAlert : Info;
  return (
    <li className={`mx-2 mb-1 overflow-hidden rounded-md border border-l-2 border-zinc-200 bg-white shadow-[0_1px_0_rgba(18,25,38,0.03)] dark:border-zinc-800 dark:bg-zinc-900/40 ${diag.severity === 'error' ? 'border-l-red-500 dark:border-l-red-400' : 'border-l-blue-500 dark:border-l-blue-400'}`}>
      <button
        type="button"
        onClick={() => void reveal(diag.file, diag.line)}
        className="flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/70"
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${diag.severity === 'error' ? 'text-red-500' : 'text-blue-500'}`} />
        <span className="min-w-0 flex-1">
          <span className="text-zinc-700 dark:text-zinc-200">{diag.message}</span>
          <span className="ml-2 whitespace-nowrap text-[11px] text-zinc-400">
            {diag.file}:{diag.line}
          </span>
          {diag.locations && diag.locations.length > 1 && (
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              also at {diag.locations.map((l) => `${l.file}:${l.line}`).join(', ')}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

export function XrefPanel() {
  const xref = useThesisStore((s) => s.xref);
  const refresh = useThesisStore((s) => s.refreshXref);
  const projectId = useEditorStore((s) => s.projectId);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const activeContent = useEditorStore((s) => (s.activeFileId ? s.contents[s.activeFileId] : undefined));
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 600);
    return () => clearTimeout(t);
  }, [projectId, activeFileId, activeContent, refresh]);

  const errors = (xref?.diagnostics ?? []).filter((d) => d.severity === 'error');
  const info = (xref?.diagnostics ?? []).filter((d) => d.severity === 'info');

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="flex h-10 items-center gap-3 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">References</span>
        {xref && (
          <span className="flex items-center gap-2 text-zinc-400">
            <span className="text-red-500">{xref.totals.error} errors</span>
            <span className="text-blue-500">{xref.totals.info} info</span>
          </span>
        )}
        <button
          type="button"
          onClick={() => void refresh()}
          title="Recompute"
          className="ml-auto rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-auto text-sm">
        {xref && errors.length === 0 && info.length === 0 && (
          <p className="px-3 py-3 text-xs text-emerald-600 dark:text-emerald-400">No reference problems.</p>
        )}
        <ul className="py-1.5">
          {errors.map((d, i) => (
            <Row key={`e${i}`} diag={d} />
          ))}
        </ul>
        {info.length > 0 && (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => setShowInfo((v) => !v)}
              className="text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              {showInfo ? '▾' : '▸'} {info.length} info (unused labels, un-referenceable equations)
            </button>
            {showInfo && (
              <ul className="mt-1">
                {info.map((d, i) => (
                  <Row key={`i${i}`} diag={d} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
