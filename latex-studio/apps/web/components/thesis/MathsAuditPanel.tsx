'use client';

import { useState } from 'react';
import { CircleAlert, HelpCircle, Loader2, Play, Sparkles } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore } from '@/lib/thesisStore';
import type { MathAuditBlock, MathCounterexample } from '@/lib/types';
import { Markdown } from '../ai/Markdown';

function fmtCounter(c: MathCounterexample): string {
  const vals = Object.entries(c.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}lhs=${c.lhsVal}, rhs=${c.rhsVal}`;
}

function Row({ block }: { block: MathAuditBlock }) {
  const reveal = useEditorStore((s) => s.revealLocation);
  const explain = useThesisStore((s) => s.explainStep);
  const explaining = useThesisStore((s) => s.explaining);
  const explanation = useThesisStore((s) => s.explanations[block.id]);
  const failing = block.verdict === 'failing';
  const Icon = failing ? CircleAlert : HelpCircle;

  return (
    <li className={`mx-2 mb-1 overflow-hidden rounded-md border border-l-2 border-zinc-200 bg-white shadow-[0_1px_0_rgba(18,25,38,0.03)] dark:border-zinc-800 dark:bg-zinc-900/40 ${failing ? 'border-l-red-500 dark:border-l-red-400' : 'border-l-amber-500 dark:border-l-amber-400'}`}>
      <div className="flex items-start gap-2 px-3 py-1.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${failing ? 'text-red-500' : 'text-amber-500'}`} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => void reveal(block.file, block.lineStart)}
            className="block w-full truncate text-left font-mono text-xs text-zinc-700 hover:underline dark:text-zinc-200"
            title={block.latex}
          >
            {block.latex || '(empty)'}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
            <span>
              {block.file}:{block.lineStart}
            </span>
            {block.method && <span className="rounded bg-zinc-100 px-1.5 font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">{block.method}</span>}
            {block.counterexample && <span className="text-red-500">{fmtCounter(block.counterexample)}</span>}
            {failing && (
              <button
                type="button"
                disabled={explaining === block.id}
                onClick={() => void explain(block)}
                className="inline-flex items-center gap-1 rounded border border-blue-300 px-1.5 py-0.5 font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
              >
                {explaining === block.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Explain with Claude
              </button>
            )}
          </div>
          {explanation && (
            <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
              <Markdown content={explanation} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export function MathsAuditPanel() {
  const report = useThesisStore((s) => s.auditReport);
  const auditing = useThesisStore((s) => s.auditing);
  const error = useThesisStore((s) => s.auditError);
  const runAudit = useThesisStore((s) => s.runAudit);
  const [showPassed, setShowPassed] = useState(false);

  const blocks = report?.blocks ?? [];
  const failing = blocks.filter((b) => b.verdict === 'failing');
  const unknown = blocks.filter((b) => b.verdict === 'unknown');
  const passed = blocks.filter((b) => b.verdict === 'passed');

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void runAudit('file')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {auditing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} File
        </button>
        <button
          type="button"
          onClick={() => void runAudit('project')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Project
        </button>
        {report && (
          <span className="ml-auto flex items-center gap-2 text-zinc-400">
            <span className="text-red-500">{report.totals.failing} failing</span>
            <span className="text-amber-500">{report.totals.unknown} unknown</span>
            <span className="text-emerald-600 dark:text-emerald-400">{report.totals.passed} passed</span>
            <span title="equations served from cache">· {report.totals.cached} cached</span>
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto text-sm">
        {error && <p className="px-3 py-3 text-xs text-red-600">{error}</p>}
        {!report && !auditing && !error && (
          <p className="px-3 py-3 text-xs text-zinc-400">No audit report yet.</p>
        )}
        {report && failing.length === 0 && unknown.length === 0 && (
          <p className="px-3 py-3 text-xs text-emerald-600 dark:text-emerald-400">No failing or unknown steps.</p>
        )}
        <ul className="py-1.5">
          {failing.map((b) => (
            <Row key={b.id} block={b} />
          ))}
          {unknown.map((b) => (
            <Row key={b.id} block={b} />
          ))}
        </ul>
        {passed.length > 0 && (
          <div className="px-3 py-2">
            <button
              type="button"
              onClick={() => setShowPassed((v) => !v)}
              className="text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            >
              {showPassed ? '▾' : '▸'} {passed.length} passed
            </button>
            {showPassed && (
              <ul className="mt-1">
                {passed.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 px-2 py-0.5 text-[11px] text-zinc-400">
                    <span className="truncate font-mono">{b.latex}</span>
                    <span className="ml-auto shrink-0">
                      {b.file}:{b.lineStart}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
