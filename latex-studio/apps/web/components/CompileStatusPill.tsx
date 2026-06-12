'use client';

import { CircleCheck, CircleAlert, Loader2, TriangleAlert } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore } from '@/lib/thesisStore';

/**
 * PERSISTENT COMPILE STATUS — green "Compiled" / orange "Compiled — N warnings"
 * / red "Failed — N errors", always visible next to the Compile button.
 * Clicking opens the Problems panel and jumps to the first error if there is one.
 */
export function CompileStatusPill() {
  const compiling = useEditorStore((s) => s.compiling);
  const compileStatus = useEditorStore((s) => s.compileStatus);
  const pdfUrl = useEditorStore((s) => s.pdfUrl);
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const revealLocation = useEditorStore((s) => s.revealLocation);
  const projects = useEditorStore((s) => s.projects);
  const projectId = useEditorStore((s) => s.projectId);
  const setBottomTab = useThesisStore((s) => s.setBottomTab);

  if (!compiling && !compileStatus) return null;

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity.startsWith('warning')).length;

  const open = () => {
    setBottomTab('problems');
    const first = diagnostics.find((d) => d.severity === 'error' && d.line !== undefined);
    if (first) {
      const rootFile = projects.find((p) => p.id === projectId)?.rootFile ?? 'main.tex';
      void revealLocation(first.file ?? rootFile, first.line!, first.column);
    }
  };

  const tone = compiling
    ? 'border-zinc-300 text-zinc-500 dark:border-[#2a3247] dark:text-[#98a2bb]'
    : compileStatus !== 'success'
      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'
      : warnings > 0
        ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-500/10 dark:text-orange-300'
        : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300';

  const label = compiling
    ? 'Compiling…'
    : compileStatus !== 'success'
      ? `Failed — ${errors} error${errors === 1 ? '' : 's'}`
      : warnings > 0
        ? `Compiled — ${warnings} warning${warnings === 1 ? '' : 's'}`
        : 'Compiled';

  const Icon = compiling ? Loader2 : compileStatus !== 'success' ? CircleAlert : warnings > 0 ? TriangleAlert : CircleCheck;

  return (
    <button
      type="button"
      data-testid="compile-status"
      data-status={compiling ? 'compiling' : (compileStatus ?? '')}
      onClick={open}
      title={
        !compiling && compileStatus !== 'success' && pdfUrl
          ? 'This run produced no PDF — the viewer shows the LAST SUCCESSFUL build. Click for details.'
          : 'Open the Problems panel'
      }
      className={`flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[12.5px] font-medium transition-colors ${tone}`}
    >
      <Icon className={`h-3.5 w-3.5 ${compiling ? 'animate-spin' : ''}`} />
      <span className="hidden lg:inline">{label}</span>
      <span className="lg:hidden">{compiling ? '…' : errors > 0 ? errors : warnings > 0 ? warnings : '✓'}</span>
    </button>
  );
}
