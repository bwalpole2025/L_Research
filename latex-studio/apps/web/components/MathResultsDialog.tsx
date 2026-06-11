'use client';

import { AlertTriangle, Check, HelpCircle, Loader2, Sigma, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import type { DerivationTransition, DerivationVerdict } from '@/lib/types';

const ICON = {
  ok: Check,
  fail: X,
  unknown: HelpCircle,
  unparseable: AlertTriangle,
} as const;

const COLOR: Record<DerivationVerdict, string> = {
  ok: 'text-emerald-500',
  fail: 'text-red-500',
  unknown: 'text-amber-500',
  unparseable: 'text-amber-600',
};

function transitionNote(t: DerivationTransition): string {
  if (t.verdict === 'ok') return `consistent${t.method ? ` (${t.method})` : ''}`;
  if (t.verdict === 'unknown') return `couldn't establish equivalence${t.method ? ` (${t.method})` : ''}`;
  if (t.verdict === 'unparseable') return t.error ?? "couldn't parse";
  return 'not equal to the previous step';
}

export function MathResultsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const result = useEditorStore((s) => s.mathResult);
  const checking = useEditorStore((s) => s.mathChecking);
  const error = useEditorStore((s) => s.mathError);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Derivation check"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sigma className="h-4 w-4" /> Derivation check
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-2 py-2" data-testid="math-results">
          {checking ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking…
            </div>
          ) : error ? (
            <p className="px-3 py-6 text-center text-sm text-amber-600 dark:text-amber-400">{error}</p>
          ) : !result ? (
            <p className="px-3 py-6 text-center text-sm text-slate-400">
              Select a derivation (or put the cursor in an align block) and run Check derivation.
            </p>
          ) : (
            <ol className="flex flex-col">
              {result.steps.map((step, i) => {
                const incoming = i > 0 ? result.transitions[i - 1] : undefined;
                const verdict: DerivationVerdict = step.error
                  ? 'unparseable'
                  : (incoming?.verdict ?? 'ok');
                const Icon = ICON[verdict];
                const firstFail =
                  result.firstFailingPair !== null && incoming?.from === result.firstFailingPair;
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-2 rounded px-3 py-2 ${
                      firstFail ? 'bg-red-50 ring-1 ring-red-300 dark:bg-red-950/30 dark:ring-red-800' : ''
                    }`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${COLOR[verdict]}`} />
                    <div className="min-w-0 flex-1">
                      <code className="break-words text-xs text-slate-700 dark:text-slate-200">
                        {step.latex}
                      </code>
                      {incoming && verdict !== 'ok' && (
                        <p className={`mt-0.5 text-xs ${COLOR[verdict]}`}>{transitionNote(incoming)}</p>
                      )}
                      {step.error && (
                        <p className="mt-0.5 break-words text-xs text-amber-600 dark:text-amber-400">
                          {step.error.split('\n')[0]}
                        </p>
                      )}
                      {incoming?.counterexample && (
                        <div className="mt-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          counterexample:{' '}
                          {Object.entries(incoming.counterexample.values)
                            .map(([k, v]) => `${k} = ${v}`)
                            .join(', ') || '(constants)'}{' '}
                          ⟹ lhs = {String(incoming.counterexample.lhsVal)}, rhs ={' '}
                          {String(incoming.counterexample.rhsVal)}
                        </div>
                      )}
                      {incoming?.difference && verdict !== 'ok' && (
                        <p className="mt-0.5 text-xs text-slate-400">difference: {incoming.difference}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
