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
  error: 'border-l-red-500',
  warning: 'border-l-amber-500',
  info: 'border-l-sky-500',
} as const;

const ICON_COLOR = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-sky-500',
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
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900">
        <span className="font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Problems
        </span>
        <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1">
            <CircleAlert className="h-3.5 w-3.5 text-red-500" /> {errors}
          </span>
          <span className="inline-flex items-center gap-1">
            <TriangleAlert className="h-3.5 w-3.5 text-amber-500" /> {warnings}
          </span>
        </span>
        <span className="ml-auto flex items-center gap-2 text-slate-400">
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
          <p className="px-3 py-3 text-xs text-slate-400">
            {compileStatus ? 'No problems.' : 'Compile to see diagnostics.'}
          </p>
        ) : (
          <ul>
            {diagnostics.map((d, i) => {
              const Icon = ICON[d.severity];
              const clickable = d.line !== undefined;
              const fixable = d.severity === 'error' && aiAvailable;
              return (
                <li key={i} className={`group flex items-stretch border-l-2 ${BORDER[d.severity]}`}>
                  <button
                    type="button"
                    onClick={() => jump(d)}
                    disabled={!clickable}
                    className={`flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left ${
                      clickable ? 'hover:bg-slate-100 dark:hover:bg-slate-800/60' : 'cursor-default'
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_COLOR[d.severity]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="break-words text-slate-700 dark:text-slate-200">{d.message}</span>
                      {(d.file || d.line !== undefined) && (
                        <span className="ml-2 whitespace-nowrap text-xs text-slate-400">
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
                      className="mr-2 my-1 inline-flex shrink-0 items-center gap-1 self-center rounded border border-sky-300 px-1.5 py-0.5 text-[11px] text-sky-700 opacity-0 transition-opacity hover:bg-sky-50 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50 dark:border-sky-800 dark:text-sky-300 dark:hover:bg-sky-950/40"
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
