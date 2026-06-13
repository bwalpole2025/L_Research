'use client';

import { useEffect, useState } from 'react';
import { Plus, Settings, Trash2, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
// (error-fix toggle lives in the AI section below)
import { useCompletionStore } from '@/lib/completionStore';
import { useDocumentModelStore } from '@/lib/documentModelStore';
import { useAutocompleteStore } from '@/lib/autocompleteStore';
import { resetUsage, topUsage, useAdaptiveStore, useUsageVersion } from '@/lib/usage';
import { usePreviewStore } from '@/lib/previewStore';
import { api, ApiError } from '@/lib/api';
import type { CompletionMode } from '@/lib/types';

interface IndexStatus {
  items: number;
  itemsWithText: number;
  indexedItems: number;
  chunks: number;
  model: string | null;
  embeddingAvailable: boolean;
}

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
  const storedProvider = useEditorStore((s) => s.aiProvider);
  const storedInstructions = useEditorStore((s) => s.aiInstructions);
  const saveSettings = useEditorStore((s) => s.saveSettings);
  const projectId = useEditorStore((s) => s.projectId);
  const projects = useEditorStore((s) => s.projects);
  const files = useEditorStore((s) => s.files);
  const currentProject = projects.find((p) => p.id === projectId);
  const storedRoot = currentProject?.rootFile ?? 'main.tex';
  const storedRunTarget = currentProject?.pythonRunTarget ?? '';
  const storedNetwork = currentProject?.networkEnabled ?? false;
  const storedEngine = currentProject?.texEngine ?? 'pdflatex';
  const storedHalt = currentProject?.haltOnError ?? false;
  const storedDraft = currentProject?.draftMode ?? false;
  const texPaths = files.filter((f) => /\.tex$/i.test(f.path)).map((f) => f.path);
  const pyPaths = files.filter((f) => /\.py$/i.test(f.path)).map((f) => f.path);
  const models = useAiStore((s) => s.models);
  const modelsLive = useAiStore((s) => s.modelsLive);
  const loadModels = useAiStore((s) => s.loadModels);
  const errorFixesEnabled = useAiStore((s) => s.errorFixesEnabled);
  const setErrorFixesEnabled = useAiStore((s) => s.setErrorFixesEnabled);
  const mathPreviewOn = usePreviewStore((s) => s.mathPreview);
  const setMathPreviewOn = usePreviewStore((s) => s.setMathPreview);
  const acEnabled = useAutocompleteStore((s) => s.enabled);
  const acSources = useAutocompleteStore((s) => s.sources);
  const setAcEnabled = useAutocompleteStore((s) => s.setEnabled);
  const setAcSource = useAutocompleteStore((s) => s.setSource);
  const adaptive = useAdaptiveStore((s) => s.adaptive);
  const setAdaptive = useAdaptiveStore((s) => s.setAdaptive);
  useUsageVersion((s) => s.v); // re-render the learned-usage list on hydrate/reset

  const compEnabled = useCompletionStore((s) => s.enabled);
  const compPerMode = useCompletionStore((s) => s.perMode);
  const compDebounce = useCompletionStore((s) => s.debounceMs);
  const docAware = useDocumentModelStore((s) => s.enabled);
  const setDocAware = useDocumentModelStore((s) => s.setEnabled);
  const includeLevel = useDocumentModelStore((s) => s.includeLevel);
  const setIncludeLevel = useDocumentModelStore((s) => s.setIncludeLevel);
  const gran = useDocumentModelStore((s) => s.granularityDefault);
  const setGran = useDocumentModelStore((s) => s.setGranularityDefault);
  const predictModel = useDocumentModelStore((s) => s.predictModel);
  const setPredictModel = useDocumentModelStore((s) => s.setPredictModel);
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
  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiInstructions, setAiInstructions] = useState('');
  const [rootFile, setRootFile] = useState('main.tex');
  const [pythonRunTarget, setPythonRunTarget] = useState('');
  const [networkEnabled, setNetworkEnabled] = useState(false);
  const [texEngine, setTexEngine] = useState<'pdflatex' | 'xelatex' | 'lualatex'>('pdflatex');
  const [haltOnError, setHaltOnError] = useState(false);
  const [draftMode, setDraftMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows(Object.entries(macros).map(([name, body]) => ({ name, body })));
    setAssume(assumptions);
    setModel(storedModel);
    setAiProvider(storedProvider);
    setAiInstructions(storedInstructions);
    setRootFile(storedRoot);
    setPythonRunTarget(storedRunTarget);
    setNetworkEnabled(storedNetwork);
    setTexEngine(storedEngine);
    setHaltOnError(storedHalt);
    setDraftMode(storedDraft);
    void loadModels();
    if (projectId) {
      api.libraryIndexStatus(projectId).then(setIndexStatus).catch(() => setIndexStatus(null));
    }
  }, [open, macros, assumptions, storedModel, storedProvider, storedInstructions, storedRoot, storedRunTarget, storedNetwork, storedEngine, storedHalt, storedDraft, loadModels, projectId]);

  const rebuildIndex = async () => {
    if (!projectId) return;
    setReindexing(true);
    try {
      await api.reindexLibrary(projectId);
      setIndexStatus(await api.libraryIndexStatus(projectId));
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Rebuild failed');
    } finally {
      setReindexing(false);
    }
  };

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
      await saveSettings({ macros: table, assumptions: assume, model, aiProvider, aiInstructions, pythonRunTarget, networkEnabled, texEngine, haltOnError, draftMode, ...(rootFile ? { rootFile } : {}) });
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
              Compiled document (root file)
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              The .tex file Compile builds. If it is missing — or is the untouched starter main.tex next to a real
              document — the next available document is compiled automatically and set here.
            </p>
            <select
              value={texPaths.includes(rootFile) ? rootFile : ''}
              onChange={(e) => setRootFile(e.target.value)}
              data-testid="root-file-select"
              className="mt-2 w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {!texPaths.includes(rootFile) && <option value="">{rootFile} (missing)</option>}
              {texPaths.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Compilation</h3>
            <p className="mt-1 text-xs text-slate-400">
              How Compile builds this project. The engine and modes are saved per project.
            </p>
            <label className="mt-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
              TeX engine
              <select
                value={texEngine}
                onChange={(e) => setTexEngine(e.target.value as 'pdflatex' | 'xelatex' | 'lualatex')}
                data-testid="tex-engine-select"
                className="mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="pdflatex">pdfLaTeX (default)</option>
                <option value="xelatex">XeLaTeX (system fonts, fontspec, Unicode)</option>
                <option value="lualatex">LuaLaTeX (fontspec, Lua, large memory)</option>
              </select>
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={haltOnError}
                onChange={(e) => setHaltOnError(e.target.checked)}
                data-testid="halt-on-error-toggle"
                className="h-4 w-4"
              />
              Stop on first error
            </label>
            <p className="ml-6 text-xs text-slate-400">Halt at the first error instead of recovering and continuing.</p>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={draftMode}
                onChange={(e) => setDraftMode(e.target.checked)}
                data-testid="draft-mode-toggle"
                className="h-4 w-4"
              />
              Draft / fast mode
            </label>
            <p className="ml-6 text-xs text-slate-400">Skip image rendering (graphicx draft) for a faster preview.</p>
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Python run</h3>
            <p className="mt-1 text-xs text-slate-400">
              The default <code>.py</code> the Run button executes (the sandbox). Leave blank to run whichever
              .py file is active. Figures a script writes to <code>figures/</code> are imported into the project.
            </p>
            <label className="mt-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Run target
              <select
                value={pyPaths.includes(pythonRunTarget) ? pythonRunTarget : ''}
                onChange={(e) => setPythonRunTarget(e.target.value)}
                data-testid="run-target-select"
                className="mt-1 w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="">Active .py file</option>
                {!pyPaths.includes(pythonRunTarget) && pythonRunTarget && <option value={pythonRunTarget}>{pythonRunTarget} (missing)</option>}
                {pyPaths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={networkEnabled}
                onChange={(e) => setNetworkEnabled(e.target.checked)}
                data-testid="run-network-toggle"
                className="h-3.5 w-3.5 accent-blue-500"
              />
              Allow network access in the sandbox
            </label>
            <p className="mt-1 text-xs text-slate-400">
              Off by default — runs have no network. Enable only for a script that must fetch data.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Library index (RAG document check)
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              The check may only claim a physics/citation discrepancy when a passage retrieved from this LOCAL index backs
              it. Embeddings run locally in mathcheck (bge-small-en-v1.5); no text leaves the machine.
            </p>
            <div className="mt-2 flex items-center gap-3 text-xs" data-testid="index-coverage">
              {indexStatus ? (
                <>
                  <span className={indexStatus.indexedItems > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}>
                    {indexStatus.indexedItems}/{indexStatus.items} article{indexStatus.items === 1 ? '' : 's'} embedded ·{' '}
                    {indexStatus.chunks} passages{indexStatus.model ? ` · ${indexStatus.model.split('/').pop()}` : ''}
                  </span>
                  {!indexStatus.embeddingAvailable && <span className="text-amber-600 dark:text-amber-400">embedding model unavailable</span>}
                </>
              ) : (
                <span className="text-slate-400">index status unavailable</span>
              )}
              <button
                type="button"
                data-testid="rebuild-index"
                onClick={() => void rebuildIndex()}
                disabled={reindexing || !indexStatus?.embeddingAvailable}
                className="rounded border border-slate-300 px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {reindexing ? 'Rebuilding…' : 'Rebuild index'}
              </button>
            </div>
          </section>

          <section className="mt-6">
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
              Runs on your subscription — no API keys. Pick which connected model connector powers chat, inline edit,
              review and co-derive. Connect/sign in on the <a href="/plugins" className="underline">Connectors</a> page.
            </p>
            <label className="mt-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Model provider
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                aria-label="AI provider"
                data-testid="ai-provider"
                className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
              >
                <option value="anthropic">Claude (claude login)</option>
                <option value="chatgpt">ChatGPT (Codex CLI)</option>
                <option value="gemini">Gemini (Gemini CLI)</option>
              </select>
            </label>
            <p className="mt-1 text-[11px] text-slate-400">
              {aiProvider === 'anthropic'
                ? 'Chat, edit, review and co-derive use Claude. SymPy still arbitrates all maths.'
                : `Chat, edit, review and co-derive use ${aiProvider === 'chatgpt' ? 'ChatGPT (Codex)' : 'Gemini'} — sign into its CLI on the Connectors page. SymPy still arbitrates all maths.`}
            </p>
            <label className={`mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300 ${aiProvider === 'anthropic' ? '' : 'opacity-50'}`}>
              Claude model
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="AI model"
                disabled={aiProvider !== 'anthropic'}
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
              {aiProvider !== 'anthropic'
                ? 'The model is chosen by the selected CLI / your subscription.'
                : modelsLive
                  ? 'Models reported by the Agent SDK on your plan.'
                  : 'Default set (the SDK was not reachable to list live models).'}
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
            <label className="mt-3 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={errorFixesEnabled}
                onChange={(e) => setErrorFixesEnabled(e.target.checked)}
                data-testid="toggle-error-fixes"
                className="h-3.5 w-3.5 accent-blue-500"
              />
              AI error fixes
            </label>
            <p className="mt-1 text-[11px] text-slate-400">
              Off removes every “Fix with Claude” action. Fixes are always proposed as an Accept/Reject diff — never applied
              without your approval.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              LaTeX autocomplete (offline)
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Deterministic IDE completion — `\` commands, your own macros, snippets, and context values (images, cite keys,
              labels, environments). No network, no model calls. When the dropdown is open it owns Tab; ghost text resumes
              when it closes.
            </p>
            <label className="mt-2 mr-4 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mathPreviewOn}
                onChange={(e) => setMathPreviewOn(e.target.checked)}
                data-testid="toggle-math-preview"
                className="h-3.5 w-3.5 accent-blue-500"
              />
              Live maths preview (KaTeX, no compile)
            </label>
            <label className="mt-2 inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={acEnabled}
                onChange={(e) => setAcEnabled(e.target.checked)}
                data-testid="toggle-autocomplete"
                className="h-3.5 w-3.5 accent-blue-500"
              />
              Enable autocomplete
            </label>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
              {(
                [
                  ['commands', '\\ commands + macros'],
                  ['snippets', 'Snippets (figure, align, …)'],
                  ['graphics', '\\includegraphics → images'],
                  ['inputFiles', '\\input → .tex files'],
                  ['citations', '\\cite → bib keys'],
                  ['labels', '\\ref → labels'],
                  ['environments', '\\begin → environments'],
                  ['packages', '\\usepackage → packages'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className={`inline-flex items-center gap-1.5 ${acEnabled ? '' : 'opacity-50'}`}>
                  <input
                    type="checkbox"
                    checked={acSources[key]}
                    disabled={!acEnabled}
                    onChange={(e) => setAcSource(key, e.target.checked)}
                    className="h-3 w-3 accent-blue-500"
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
              <label className={`inline-flex items-center gap-2 text-sm ${acEnabled ? '' : 'opacity-50'}`}>
                <input
                  type="checkbox"
                  checked={adaptive}
                  disabled={!acEnabled}
                  onChange={(e) => setAdaptive(e.target.checked)}
                  data-testid="toggle-adaptive"
                  className="h-3.5 w-3.5 accent-blue-500"
                />
                Adapt suggestions to my usage
              </label>
              <p className="mt-1 text-[11px] text-slate-400">
                Items you accept often and recently rank higher within their group (30-day half-life); matching always comes
                first, so popularity never surfaces a wrong item. Local usage data only — kept on this device and your local
                database, never sent anywhere external.
              </p>
              {adaptive &&
                (() => {
                  const learned = [
                    ...topUsage('app', 6).map((t) => ({ ...t, scope: 'all projects' })),
                    ...topUsage('project', 6).map((t) => ({ ...t, scope: 'this project' })),
                  ];
                  if (learned.length === 0) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-1" data-testid="usage-top">
                      {learned.map((t) => (
                        <span
                          key={`${t.scope}:${t.key}`}
                          title={`${t.scope} — decayed score ${t.score.toFixed(2)}`}
                          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        >
                          {t.key} ×{t.count}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  data-testid="usage-reset-project"
                  onClick={() => {
                    if (window.confirm('Reset learned usage for THIS project (cite keys, labels, file paths)?')) void resetUsage('project');
                  }}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                >
                  Reset learned usage (this project)
                </button>
                <button
                  type="button"
                  data-testid="usage-reset-app"
                  onClick={() => {
                    if (window.confirm('Reset learned usage across ALL projects (commands, environments, snippets)?')) void resetUsage('app');
                  }}
                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
                >
                  Reset learned usage (all projects)
                </button>
              </div>
            </div>
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

          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Document-aware prediction</h3>
            <p className="mt-1 text-xs text-slate-400">
              Grounds predictions in a cached context card (notation, outline, intent). Rebuilt on a slow debounce, not per keystroke.
            </p>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={docAware} onChange={(e) => setDocAware(e.target.checked)} className="h-3.5 w-3.5 accent-sky-500" />
              Use the document model (off = plain local-window completion)
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Include
              <select value={includeLevel} disabled={!docAware} onChange={(e) => setIncludeLevel(e.target.value as typeof includeLevel)} className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700">
                <option value="card">Card only</option>
                <option value="card+recent">Card + recent derivation</option>
                <option value="card+excerpt">Card + broader excerpt</option>
              </select>
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              “Predict next” default granularity
              <select value={gran} onChange={(e) => setGran(e.target.value as typeof gran)} className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700">
                <option value="auto">Auto (from cursor context)</option>
                <option value="prose">Prose</option>
                <option value="maths">Maths</option>
                <option value="structural">Structural</option>
              </select>
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600 dark:text-slate-300">
              “Predict next” model (a stronger model is fine — it is user-triggered, not per-keystroke)
              <select value={predictModel} onChange={(e) => setPredictModel(e.target.value)} className="mt-1 block w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700">
                {(completionModelOptions.includes(predictModel) ? completionModelOptions : [predictModel, ...completionModelOptions]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
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
