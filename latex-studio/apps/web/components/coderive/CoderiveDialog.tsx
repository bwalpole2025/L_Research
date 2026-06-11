'use client';

import { Sparkles, X } from 'lucide-react';
import { INTENTS, useCoderiveStore } from '@/lib/coderiveStore';
import { useThesisStore } from '@/lib/thesisStore';

export function CoderiveDialog() {
  const open = useCoderiveStore((s) => s.dialogOpen);
  const close = useCoderiveStore((s) => s.closeDialog);
  const intent = useCoderiveStore((s) => s.intent);
  const setIntent = useCoderiveStore((s) => s.setIntent);
  const target = useCoderiveStore((s) => s.target);
  const setTarget = useCoderiveStore((s) => s.setTarget);
  const run = useCoderiveStore((s) => s.run);
  const error = useCoderiveStore((s) => s.error);
  const setBottomTab = useThesisStore((s) => s.setBottomTab);

  if (!open) return null;
  const active = INTENTS.find((i) => i.id === intent)!;

  const start = () => {
    setBottomTab('coderive');
    void run();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={close}>
      <div
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Co-derive"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-sky-500" /> Co-derive
          </h2>
          <button type="button" onClick={close} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="grid grid-cols-2 gap-2">
            {INTENTS.map((i) => (
              <button
                key={i.id}
                type="button"
                data-testid={`intent-${i.id}`}
                onClick={() => setIntent(i.id)}
                className={`rounded border px-3 py-2 text-left text-sm ${
                  intent === i.id
                    ? 'border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
                    : 'border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
                }`}
              >
                {i.label}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{active.help}</p>

          {active.needsTarget && (
            <label className="mt-3 block text-xs text-slate-500 dark:text-slate-400">
              Target expression (LaTeX)
              <input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="e.g. \frac{U}{\sqrt{gL}}"
                className="mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 font-mono text-sm dark:border-slate-700"
              />
            </label>
          )}

          <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            Every proposal is checked by SymPy. A green tick means the expression is algebraically equal to what it claims — nothing
            about modelling, intent, or citation accuracy.
          </p>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button type="button" onClick={close} className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button
            type="button"
            onClick={start}
            data-testid="coderive-run"
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Co-derive
          </button>
        </div>
      </div>
    </div>
  );
}
