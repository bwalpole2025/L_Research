'use client';

import { BookPlus, CircleAlert, Info, Loader2, Play, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore } from '@/lib/thesisStore';
import type { ProseDiagnostic, ProseRuleToggles, ProseSeverity } from '@/lib/types';

const SEV_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const SEV_COLOR: Record<ProseSeverity, string> = {
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-blue-500',
};
const SEV_BORDER: Record<ProseSeverity, string> = {
  error: 'border-l-red-500 dark:border-l-red-400',
  warning: 'border-l-amber-500 dark:border-l-amber-400',
  info: 'border-l-blue-500 dark:border-l-blue-400',
};

const RULES: { key: keyof ProseRuleToggles; label: string }[] = [
  { key: 'spelling', label: 'Spelling' },
  { key: 'enGbConsistency', label: 'en-GB' },
  { key: 'doubleSpace', label: 'Double space' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'hyphenation', label: 'Hyphenation' },
  { key: 'languageTool', label: 'Grammar (LT)' },
];

function Row({ diag }: { diag: ProseDiagnostic }) {
  const reveal = useEditorStore((s) => s.revealLocation);
  const applyFix = useThesisStore((s) => s.applyProseFix);
  const addWord = useThesisStore((s) => s.addToDictionary);
  const Icon = SEV_ICON[diag.severity];

  return (
    <li className={`mx-2 mb-1 flex items-start gap-2 overflow-hidden rounded-md border border-l-2 border-zinc-200 bg-white px-3 py-1.5 shadow-[0_1px_0_rgba(18,25,38,0.03)] dark:border-zinc-800 dark:bg-zinc-900/40 ${SEV_BORDER[diag.severity]}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SEV_COLOR[diag.severity]}`} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => void reveal(diag.file, diag.line, diag.column)}
          className="block text-left text-zinc-700 hover:underline dark:text-zinc-200"
        >
          {diag.message}
        </button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
          <span>
            {diag.file}:{diag.line}
          </span>
          <span className="rounded bg-zinc-100 px-1.5 font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">{diag.rule}</span>
          {diag.suggestions.slice(0, 4).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void applyFix(diag, s)}
              className="rounded border border-emerald-300 px-1.5 py-0.5 font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
              title="Apply this fix"
            >
              {s}
            </button>
          ))}
          {diag.word && diag.rule === 'spelling' && (
            <button
              type="button"
              onClick={() => void addWord(diag.word!)}
              className="inline-flex items-center gap-1 rounded border border-zinc-300 px-1.5 py-0.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title="Add to project dictionary"
            >
              <BookPlus className="h-3 w-3" /> Add to dictionary
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export function ProsePanel() {
  const report = useThesisStore((s) => s.proseReport);
  const prosing = useThesisStore((s) => s.prosing);
  const error = useThesisStore((s) => s.proseError);
  const runProse = useThesisStore((s) => s.runProse);
  const rules = useThesisStore((s) => s.proseRules);
  const setRule = useThesisStore((s) => s.setProseRule);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="flex min-h-10 flex-wrap items-center gap-2 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 py-1.5 text-xs dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void runProse('file')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {prosing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} File
        </button>
        <button
          type="button"
          onClick={() => void runProse('project')}
          className="inline-flex h-7 items-center rounded-md border border-zinc-200 bg-white px-2 font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Project
        </button>
        <span className="flex flex-wrap items-center gap-1.5">
          {RULES.map((r) => (
            <label key={r.key} className="inline-flex h-6 items-center gap-1 rounded border border-zinc-200 bg-white px-1.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={rules[r.key]}
                onChange={(e) => setRule(r.key, e.target.checked)}
                className="h-3 w-3 accent-blue-600"
              />
              {r.label}
            </label>
          ))}
        </span>
        {report && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400" title={`spelling: ${report.engine.spelling}, grammar: ${report.engine.grammar ?? 'off'}`}>
            <ShieldCheck className="h-3 w-3" /> local
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto text-sm">
        {error && <p className="px-3 py-3 text-xs text-red-600">{error}</p>}
        {!report && !prosing && !error && (
          <p className="px-3 py-3 text-xs text-zinc-400">No prose report yet.</p>
        )}
        {report && report.diagnostics.length === 0 && (
          <p className="px-3 py-3 text-xs text-emerald-600 dark:text-emerald-400">No prose issues.</p>
        )}
        <ul className="py-1.5">
          {(report?.diagnostics ?? []).map((d, i) => (
            <Row key={`${d.file}:${d.line}:${d.column}:${i}`} diag={d} />
          ))}
        </ul>
      </div>
    </div>
  );
}
