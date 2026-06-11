'use client';

import { X } from 'lucide-react';

const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: 'Editor',
    rows: [
      ['⌘ / Ctrl + ↵', 'Compile'],
      ['⌘ / Ctrl + ⇧ + ↵', 'Check derivation'],
      ['⌘ / Ctrl + K', 'Edit selection with Claude'],
      ['⌘ / Ctrl + S', 'Save snapshot'],
    ],
  },
  {
    title: 'Inline completions',
    rows: [
      ['Tab', 'Accept ghost suggestion'],
      ['Esc', 'Dismiss suggestion'],
      ['Alt + ]', 'Alternative suggestion'],
    ],
  },
  {
    title: 'Thesis tools',
    rows: [
      ['⌘ / Ctrl + ⇧ + A', 'Audit maths (current file)'],
      ['⌘ / Ctrl + ⇧ + L', 'Prose check (current file)'],
      ['⌘ / Ctrl + ⇧ + S', 'Pre-submit check'],
      ['⌘ / Ctrl + ⇧ + D', 'Co-derive (LLM proposes · SymPy verifies)'],
      ['⌘ / Ctrl + ⇧ + O', 'Toggle outline'],
      ['⌘ / Ctrl + /', 'This reference'],
    ],
  },
];

export function KeyboardReference({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Keyboard reference"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold">Keyboard reference</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto px-4 py-3">
          {GROUPS.map((g) => (
            <section key={g.title} className="mb-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.title}</h3>
              <dl className="space-y-1">
                {g.rows.map(([key, desc]) => (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <dt className="text-slate-600 dark:text-slate-300">{desc}</dt>
                    <dd>
                      <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {key}
                      </kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
