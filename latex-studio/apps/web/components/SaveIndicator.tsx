'use client';

import type { SaveStatus } from '@/lib/types';

const LABELS: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  dirty: 'Unsaved changes',
  error: 'Save failed',
};

const DOT: Record<SaveStatus, string> = {
  saved: 'bg-emerald-500',
  saving: 'bg-amber-400 animate-pulse',
  dirty: 'bg-slate-400',
  error: 'bg-red-500',
};

export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <span
      data-testid="save-indicator"
      data-status={status}
      className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"
      title={LABELS[status]}
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
