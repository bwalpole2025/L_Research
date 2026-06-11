'use client';

import { useEffect, useState } from 'react';
import { Plus, Settings, Trash2, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { useCompletionStore } from '@/lib/completionStore';
import { ApiError } from '@/lib/api';
import type { CompletionMode } from '@/lib/types';

const COMPLETION_MODES: { mode: CompletionMode; label: string }[] = [
  { mode: 'prose', label: 'Prose' },
  { mode: 'inline-math', label: 'Inline math' },
  { mode: 'display-align', label: 'Display/align' },
  { mode: 'preamble', label: 'Preamble' },
];

interface MacroRow {
  name: string;
  body: string;
}

export function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const macros = useEditorStore((s) => s.macros);
  const assumptions = useEditorStore((s) => s.assumptions);
  const storedModel = useEditorStore((s) => s.model);
  const storedInstructions = useEditorStore((s) => s.aiInstructions);
  const saveSettings = useEditorStore((s) => s.saveSettings);
  const models = useAiStore((s) => s.models);
  const modelsLive = useAiStore((s) => s.modelsLive);
  const loadModels = useAiStore((s) => s.loadModels);

  const compEnabled = useCompletionStore((s) => s.enabled);
  const compPerMode = useCompletionStore((s) => s.perMode);
  const compDebounce = useCompletionStore((s) => s.debounceMs);
  const compModel = useCompletionStore((s) => s.model);
  const compProvider = useCompletionStore((s) => s.provider);
  const compBaseline = useCompletionStore((s) => s.baseline);
  const setCompEnabled = useCompletionStore((s) => s.setEnabled);
  const setCompMode = useCompletionStore((s) => s.setModeEnabled);
  const setCompDebounce = useCompletionStore((s) => s.setDebounce);
  const setCompModel = useCompletionStore((s) => s.setModel);
  const setCompProvider = useCompletionStore((s) => s.setProvider);
  const setCompBaseline = useCompletionStore((s) => s.setBaseline);

  const [rows, setRows] = useState<MacroRow[]>([]);
  const [assume, setAssume] = useState('');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [aiInstructions, setAiInstructions] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(Object.entries(macros).map(([name, body]) => ({ name, body })));
    setAssume(assumptions);
    setModel(storedModel);
    setAiInstructions(storedInstructions);
    void loadModels();
  }, [open, macros, assumptions, storedModel, storedInstructions, loadModels]);

  if (!open) return null;

  const modelOptions = models.includes(model) ? models : [model, ...models];
  const completionModelOptions = models.includes(compModel) ? models : [compModel, ...models];

  const save = async () => {
    const table: Record<string, string> = {};
    for (const r of rows) {
      const name = r.name.trim();
      if (!name) continue;
      table[name.startsWith('\\') ? name : `\\${name}`] = r.body;
    }
    setBusy(true);
    try {
      await saveSettings({ macros: table, assumptions: assume, model, aiInstructions });
      onClose();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Project settings"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4" /> Project settings
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Macro table
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Expanded before math-checking. Use <code>#1</code>…<code>#9</code> for parameters, e.g.{' '}
              <code>\pdiff</code> → <code>{'\\frac{\\partial #1}{\\partial #2}'}</code>.
            </p>
            <div className="mt-2 space-y-2">
              {rows.length === 0 && (
                <p className="text-xs text-slate-400">No macros yet.</p>
              )}
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={row.name}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
                    }
                    placeholder="\Bo"
                    aria-label="Macro name"
                    className="w-32 rounded border border-slate-300 bg-transparent px-2 py-1 font-mono text-sm dark:border-slate-700"
                  />
                  <span className="text-slate-400">→</span>
                  <input
                    value={row.body}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, body: e.target.value } : r)))
                    }
                    placeholder="B_0"
                    aria-label="Macro body"
                    className="flex-1 rounded border border-slate-300 bg-transparent px-2 py-1 font-mono text-sm dark:border-slate-700"
                  />
                  <button
                    type="button"
                    aria-label="Remove macro"
                    onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-red-600 dark:hover:bg-slate-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setRows((rs) => [...rs, { name: '', body: '' }])}
              className="mt-2 inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add macro
            </button>
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Default assumptions
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Applied to every check. e.g. <code>all symbols real, k &gt; 0</code>.
            </p>
            <input
              value={assume}
              onChange={(e) => setAssume(e.target.value)}
              placeholder="all symbols real, k > 0"
              aria-label="Default assumptions"
              className="mt-2 w-full rounded border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
            />
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              AI
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Billed to your Claude subscription via <code>claude login</code> — no API key.
            </p>
            <label className="mt-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Model
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="AI model"
                className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
              >
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-[11px] text-slate-400">
              {modelsLive ? 'Models reported by the Agent SDK on your plan.' : 'Default set (the SDK was not reachable to list live models).'}
            </p>
            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Project AI instructions
              <textarea
                value={aiInstructions}
                onChange={(e) => setAiInstructions(e.target.value)}
                rows={3}
                placeholder="e.g. This is a general-relativity paper; prefer index notation and the (-+++) signature."
                aria-label="Project AI instructions"
                className="mt-1 block w-full resize-none rounded border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
              />
            </label>
            <p className="mt-1 text-[11px] text-slate-400">Added to the chat system prompt for this project.</p>
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Inline completions
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Ghost-text suggestions (Tab to accept, Esc to dismiss, Alt+] for an alternative). Stored on this device.
            </p>

            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={compEnabled}
                onChange={(e) => setCompEnabled(e.target.checked)}
                aria-label="Enable inline completions"
                className="h-3.5 w-3.5 accent-sky-500"
              />
              Enable ghost-text completions
            </label>

            <div className="mt-2 grid grid-cols-2 gap-1">
              {COMPLETION_MODES.map(({ mode, label }) => (
                <label key={mode} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={compPerMode[mode]}
                    disabled={!compEnabled}
                    onChange={(e) => setCompMode(mode, e.target.checked)}
                    className="h-3.5 w-3.5 accent-sky-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Debounce: {compDebounce} ms
              <input
                type="range"
                min={0}
                max={1000}
                step={50}
                value={compDebounce}
                onChange={(e) => setCompDebounce(Number(e.target.value))}
                aria-label="Completion debounce"
                className="mt-1 block w-full accent-sky-500"
              />
            </label>

            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Completion model (fastest / Haiku-class recommended)
              <select
                value={compModel}
                onChange={(e) => setCompModel(e.target.value)}
                aria-label="Completion model"
                className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
              >
                {completionModelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Provider for completions only
              <select
                value={compProvider}
                onChange={(e) => setCompProvider(e.target.value === 'api' ? 'api' : 'agent-sdk')}
                aria-label="Completion provider override"
                className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
              >
                <option value="agent-sdk">agent-sdk (Claude subscription)</option>
                <option value="api">api (metered — for the /complete route only)</option>
              </select>
            </label>
            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
              Measured: completions on agent-sdk run ~2.8 s p50 (warm) and exceed the 1.5 s p95 budget — the SDK&apos;s
              per-call overhead. Switching this route to <code>api</code> avoids the subprocess overhead. See the{' '}
              <a href="/stats" target="_blank" rel="noreferrer" className="underline">
                /stats
              </a>{' '}
              baseline-vs-warm comparison.
            </p>

            <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={compBaseline}
                onChange={(e) => setCompBaseline(e.target.checked)}
                className="h-3.5 w-3.5 accent-sky-500"
              />
              Force baseline (no warm pool) — for latency comparison on /stats
            </label>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
