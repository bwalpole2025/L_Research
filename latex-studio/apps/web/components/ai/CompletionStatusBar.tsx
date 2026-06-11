'use client';

import Link from 'next/link';
import { BarChart3, Check, Sparkles, X } from 'lucide-react';
import { useCompletionStore } from '@/lib/completionStore';

/** Thin status bar: completion latency, rolling p95, accept/reject, paused state. */
export function CompletionStatusBar() {
  const enabled = useCompletionStore((s) => s.enabled);
  const setEnabled = useCompletionStore((s) => s.setEnabled);
  const lastLatencyMs = useCompletionStore((s) => s.lastLatencyMs);
  const lastVariant = useCompletionStore((s) => s.lastVariant);
  const accepted = useCompletionStore((s) => s.accepted);
  const rejected = useCompletionStore((s) => s.rejected);
  const pausedReason = useCompletionStore((s) => s.pausedReason);
  const p95 = useCompletionStore((s) => s.p95());

  return (
    <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        aria-pressed={enabled}
        data-testid="toggle-completions"
        title={enabled ? 'Disable inline completions' : 'Enable inline completions'}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-800"
      >
        <Sparkles className="h-3 w-3" />
        Completions
        <span
          className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${
            pausedReason ? 'bg-amber-500' : enabled ? 'bg-emerald-500' : 'bg-slate-400'
          }`}
          aria-hidden
        />
      </button>

      {pausedReason ? (
        <span className="text-amber-600 dark:text-amber-400">
          paused — {pausedReason === 'credit_exhausted' ? 'Agent SDK credit exhausted' : pausedReason}
        </span>
      ) : (
        <>
          {lastLatencyMs !== null && (
            <span data-testid="last-latency">
              {lastLatencyMs} ms{lastVariant ? ` (${lastVariant})` : ''}
            </span>
          )}
          {p95 > 0 && <span title="rolling p95 (last 100)">p95 {p95} ms</span>}
        </>
      )}

      <span className="ml-auto inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1">
          <Check className="h-3 w-3 text-emerald-500" /> {accepted}
        </span>
        <span className="inline-flex items-center gap-1">
          <X className="h-3 w-3 text-slate-400" /> {rejected}
        </span>
        <Link
          href="/stats"
          target="_blank"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-800"
          title="Completion stats"
        >
          <BarChart3 className="h-3 w-3" /> Stats
        </Link>
      </span>
    </div>
  );
}
