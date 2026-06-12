'use client';

import type { SaveStatus } from '@/lib/types';

const LABELS: Record<SaveStatus, string> = {
  saved: 'All changes saved',
  saving: 'Saving…',
  dirty: 'Unsaved changes',
  error: 'Save failed',
};

const DOT: Record<SaveStatus, string> = {
  saved: 'bg-emerald-500',
  saving: 'bg-amber-400 animate-pulse',
  dirty: 'bg-zinc-400',
  error: 'bg-red-500',
};

/** The quiet status line under the document title: "● All changes saved". */
export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span
      data-testid="save-indicator"
      data-status={status}
      className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-zinc-400 dark:text-[#5d688a]"
      title={LABELS[status]}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[status]}`} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
