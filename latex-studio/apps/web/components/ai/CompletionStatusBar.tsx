'use client';

import Link from 'next/link';
import { BarChart3, BrainCircuit, Check, Loader2, Sparkles, WandSparkles, X } from 'lucide-react';
import { useCompletionStore } from '@/lib/completionStore';
import { useDocumentModelStore } from '@/lib/documentModelStore';

function ago(ts: number | null): string {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

/** Thin status bar: completion latency, rolling p95, accept/reject, doc-model, predict. */
export function CompletionStatusBar() {
  const enabled = useCompletionStore((s) => s.enabled);
  const setEnabled = useCompletionStore((s) => s.setEnabled);
  const lastLatencyMs = useCompletionStore((s) => s.lastLatencyMs);
  const lastVariant = useCompletionStore((s) => s.lastVariant);
  const accepted = useCompletionStore((s) => s.accepted);
  const rejected = useCompletionStore((s) => s.rejected);
  const pausedReason = useCompletionStore((s) => s.pausedReason);
  const p95 = useCompletionStore((s) => s.p95());
  const docAware = useDocumentModelStore((s) => s.enabled);
  const setDocAware = useDocumentModelStore((s) => s.setEnabled);
  const builtAt = useDocumentModelStore((s) => s.builtAt);
  const predicting = useDocumentModelStore((s) => s.predicting);
  const predictTrigger = useDocumentModelStore((s) => s.predictTrigger);

  return (
    <div className="flex h-8 items-center gap-3 border-t border-zinc-200 bg-[var(--ls-surface-raised)] px-3 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        aria-pressed={enabled}
        data-testid="toggle-completions"
        title={enabled ? 'Disable inline completions' : 'Enable inline completions'}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Sparkles className="h-3 w-3" />
        Completions
        <span
          className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${
            pausedReason ? 'bg-amber-500' : enabled ? 'bg-emerald-500' : 'bg-zinc-400'
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

      <button
        type="button"
        onClick={() => setDocAware(!docAware)}
        aria-pressed={docAware}
        data-testid="toggle-docaware"
        title={docAware ? 'Document-aware prediction on — predictions use the cached context card' : 'Document-aware prediction off — plain 5S local window'}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <BrainCircuit className="h-3 w-3" />
        Doc-aware
        <span className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${docAware ? 'bg-emerald-500' : 'bg-zinc-400'}`} aria-hidden />
      </button>
      {docAware && <span data-testid="docmodel-refreshed" title="DocumentModel last refreshed">card {ago(builtAt)}</span>}
      <button
        type="button"
        data-testid="predict-next"
        onMouseDown={(e) => e.preventDefault()} // keep editor focus so Tab/Esc reach the ghost
        onClick={() => predictTrigger?.()}
        disabled={!predictTrigger || predicting}
        title="Predict next (⌘⇧Space)"
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        {predicting ? <Loader2 className="h-3 w-3 animate-spin" /> : <WandSparkles className="h-3 w-3" />} Predict next
      </button>

      <span className="ml-auto inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1">
          <Check className="h-3 w-3 text-emerald-500" /> {accepted}
        </span>
        <span className="inline-flex items-center gap-1">
          <X className="h-3 w-3 text-zinc-400" /> {rejected}
        </span>
        <Link
          href="/stats"
          target="_blank"
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="Completion stats"
        >
          <BarChart3 className="h-3 w-3" /> Stats
        </Link>
      </span>
    </div>
  );
}
