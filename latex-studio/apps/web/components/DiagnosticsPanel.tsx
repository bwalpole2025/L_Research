'use client';

import { CircleAlert, Info, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import type { Diagnostic } from '@/lib/types';

const ICON = {
  error: CircleAlert,
  warning: TriangleAlert,
  info: Info,
} as const;

const BORDER = {
  error: 'border-l-red-500 dark:border-l-red-400',
  warning: 'border-l-amber-500 dark:border-l-amber-400',
  info: 'border-l-blue-500 dark:border-l-blue-400',
} as const;

const ICON_COLOR = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
} as const;

export function DiagnosticsPanel() {
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const compiling = useEditorStore((s) => s.compiling);
  const compileStatus = useEditorStore((s) => s.compileStatus);
  const compileDurationMs = useEditorStore((s) => s.compileDurationMs);
  const compileError = useEditorStore((s) => s.compileError);
  const projects = useEditorStore((s) => s.projects);
  const projectId = useEditorStore((s) => s.projectId);
  const revealLocation = useEditorStore((s) => s.revealLocation);
  const requestFix = useAiStore((s) => s.requestFix);
  const aiAvailable = useAiStore((s) => s.status.available);
  const editBusy = useAiStore((s) => s.editBusy);

  const rootFile = projects.find((p) => p.id === projectId)?.rootFile ?? 'main.tex';
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;

  const jump = (d: Diagnostic) => {
    if (d.line === undefined) return;
    void revealLocation(d.file ?? rootFile, d.line, d.column);
  };

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="flex h-10 items-center gap-3 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">
          Problems
        </span>
        <span className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <CircleAlert className="h-3.5 w-3.5 text-red-500" /> {errors}
          </span>
          <span className="inline-flex items-center gap-1">
            <TriangleAlert className="h-3.5 w-3.5 text-amber-500" /> {warnings}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2 text-zinc-400">
          {compiling && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> compiling…
            </span>
          )}
          {!compiling && compileStatus && (
            <span
              data-testid="compile-status"
              data-status={compileStatus}
              className={
                compileStatus === 'success'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }
            >
              {compileStatus}
              {compileDurationMs != null ? ` · ${(compileDurationMs / 1000).toFixed(1)}s` : ''}
            </span>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-auto text-sm">
        {compileError ? (
          <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{compileError}</p>
        ) : diagnostics.length === 0 ? (
          <p className="px-3 py-3 text-xs text-zinc-400">
            {compileStatus ? 'No problems.' : 'Compile to see diagnostics.'}
          </p>
        ) : (
          <ul className="py-1.5">
            {diagnostics.map((d, i) => {
              const Icon = ICON[d.severity];
              const clickable = d.line !== undefined;
              const fixable = d.severity === 'error' && aiAvailable;
              return (
                <li key={i} className={`group mx-2 mb-1 flex items-stretch overflow-hidden rounded-md border border-l-2 border-zinc-200 bg-white shadow-[0_1px_0_rgba(18,25,38,0.03)] dark:border-zinc-800 dark:bg-zinc-900/40 ${BORDER[d.severity]}`}>
                  <button
                    type="button"
                    onClick={() => jump(d)}
                    disabled={!clickable}
                    className={`flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left ${
                      clickable ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/70' : 'cursor-default'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOR[d.severity]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="break-words text-zinc-700 dark:text-zinc-200">{d.message}</span>
                      {(d.file || d.line !== undefined) && (
                        <span className="ml-2 whitespace-nowrap text-xs text-zinc-400">
                          {d.file ?? rootFile}
                          {d.line !== undefined ? `:${d.line}` : ''}
                        </span>
                      )}
                    </span>
                  </button>
                  {fixable && (
                    <button
                      type="button"
                      onClick={() => void requestFix(d)}
                      disabled={editBusy}
                      title="Fix with Claude"
                      data-testid="fix-with-claude"
                      className="my-1 mr-2 inline-flex shrink-0 items-center gap-1 self-center rounded border border-blue-300 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 opacity-0 transition-opacity hover:bg-blue-50 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
                    >
                      <Sparkles className="h-3 w-3" /> Fix
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
