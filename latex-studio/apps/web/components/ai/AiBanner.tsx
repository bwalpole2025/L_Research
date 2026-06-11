'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useAiStore } from '@/lib/aiStore';

/** Shown when AI features are disabled (credit exhausted / auth / unavailable). */
export function AiBanner() {
  const status = useAiStore((s) => s.status);
  const refreshStatus = useAiStore((s) => s.refreshStatus);
  if (status.available) return null;

  return (
    <div
      data-testid="ai-banner"
      data-reason={status.reason ?? ''}
      className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{status.message ?? 'AI features are temporarily unavailable.'}</span>
      <button
        type="button"
        onClick={() => void refreshStatus()}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-400 bg-white/40 px-2 text-xs transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:hover:bg-amber-500/10"
      >
        <RefreshCw className="h-3 w-3" /> Retry
      </button>
    </div>
  );
}
