'use client';

import type { SaveStatus } from '@/lib/types';

const LABELS: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  dirty: 'Unsaved changes',
  error: 'Save failed',
};

const DOT: Record<SaveStatus, string> = {
  saved: 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]',
  saving: 'bg-amber-400 animate-pulse shadow-[0_0_0_3px_rgba(245,158,11,0.14)]',
  dirty: 'bg-zinc-400 shadow-[0_0_0_3px_rgba(113,113,122,0.14)]',
  error: 'bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.14)]',
};

export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span
      data-testid="save-indicator"
      data-status={status}
      className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      title={LABELS[status]}
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
