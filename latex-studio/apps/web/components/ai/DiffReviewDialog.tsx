'use client';

import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { Check, GitCompareArrows, X } from 'lucide-react';
import { useAiStore } from '@/lib/aiStore';
import { useEditorStore } from '@/lib/store';
import { latexLanguageSupport } from '../editor/latex';
import { editorTheme } from '../editor/theme';

/** Side-by-side merge view of the original vs. Claude's proposed replacement. */
export function DiffReviewDialog() {
  const diff = useAiStore((s) => s.pendingDiff);
  const accept = useAiStore((s) => s.acceptDiff);
  const reject = useAiStore((s) => s.rejectDiff);
  const theme = useEditorStore((s) => s.theme);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!diff || !hostRef.current) return;
    const readOnly = [
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      lineNumbers(),
      latexLanguageSupport(),
      editorTheme(theme),
      EditorView.lineWrapping,
    ];
    const mv = new MergeView({
      a: { doc: diff.original, extensions: readOnly },
      b: { doc: diff.replacement, extensions: readOnly },
      parent: hostRef.current,
      gutter: true,
      highlightChanges: true,
    });
    return () => mv.destroy();
  }, [diff, theme]);

  if (!diff) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={reject}
      onKeyDown={(e) => {
        if (e.key === 'Escape') reject();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) accept();
      }}
      role="dialog"
      aria-label="Review change"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <GitCompareArrows className="h-4 w-4 text-sky-500" />
            {diff.source === 'fix' ? 'Fix with Claude' : 'Edit with Claude'}
            <span className="font-normal text-slate-400">· {diff.filePath}</span>
          </h2>
          <span className="text-[11px] text-slate-400">original → proposed</span>
        </div>

        <div ref={hostRef} data-testid="diff-merge" className="min-h-0 flex-1 overflow-auto text-sm" />

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={reject}
            data-testid="diff-reject"
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" /> Reject
          </button>
          <button
            type="button"
            onClick={accept}
            data-testid="diff-accept"
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            <Check className="h-4 w-4" /> Accept
          </button>
        </div>
      </div>
    </div>
  );
}
