'use client';

import { useState } from 'react';
import { CheckCircle2, ClipboardCopy, Download, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { useThesisStore } from '@/lib/thesisStore';
import type { PreSubmitSummary } from '@/lib/types';

function toMarkdown(s: PreSubmitSummary): string {
  return [
    `# Pre-submit check — ${s.projectName}`,
    '',
    `_Generated ${s.generatedAt}_`,
    '',
    `**${s.ready ? '✅ READY' : '❌ NOT READY'}**`,
    '',
    '| Check | Result |',
    '| --- | --- |',
    `| Compile | ${s.compile.status} (${s.compile.errors} errors, ${s.compile.warnings} warnings) |`,
    `| Maths audit | ${s.maths.failing} failing, ${s.maths.unknown} unknown, ${s.maths.passed} passed |`,
    `| Prose | ${s.prose.error} errors, ${s.prose.warning} warnings, ${s.prose.info} info |`,
    `| References | ${s.xref.error} errors, ${s.xref.info} info |`,
    '',
  ].join('\n');
}

function StatRow({ label, value, bad }: { label: string; value: string; bad: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-2 text-sm dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={bad ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'}>
        {value}
      </span>
    </div>
  );
}

export function PreSubmitDialog() {
  const open = useThesisStore((s) => s.preSubmitOpen);
  const close = useThesisStore((s) => s.closePreSubmit);
  const summary = useThesisStore((s) => s.preSubmit);
  const running = useThesisStore((s) => s.preSubmitting);
  const rerun = useThesisStore((s) => s.runPreSubmit);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const copy = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(summary));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked */
    }
  };

  const download = () => {
    if (!summary) return;
    const blob = new Blob([toMarkdown(summary)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pre-submit-${summary.projectName.replace(/\s+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={close}>
      <div
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Pre-submit check"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 className="text-sm font-semibold">Pre-submit check</h2>
          <button type="button" onClick={close} aria-label="Close" className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4">
          {running && !summary ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Compiling, auditing, checking prose &amp; references…
            </div>
          ) : summary ? (
            <>
              <div
                data-testid="presubmit-ready"
                data-ready={summary.ready}
                className={`mb-3 flex items-center gap-2 rounded px-3 py-2 text-sm font-medium ${
                  summary.ready
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                }`}
              >
                {summary.ready ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                {summary.ready ? 'Ready to submit' : 'Not ready — issues remain'}
              </div>
              <StatRow label="Compile" value={`${summary.compile.status} · ${summary.compile.errors} err / ${summary.compile.warnings} warn`} bad={summary.compile.status !== 'success'} />
              <StatRow label="Maths audit" value={`${summary.maths.failing} failing · ${summary.maths.unknown} unknown · ${summary.maths.passed} passed`} bad={summary.maths.failing > 0} />
              <StatRow label="Prose" value={`${summary.prose.error} err · ${summary.prose.warning} warn · ${summary.prose.info} info`} bad={summary.prose.error > 0} />
              <StatRow label="References" value={`${summary.xref.error} errors · ${summary.xref.info} info`} bad={summary.xref.error > 0} />
            </>
          ) : (
            <p className="py-8 text-sm text-slate-400">No summary.</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={() => void rerun()}
            disabled={running}
            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-4 w-4" /> Re-run
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              disabled={!summary}
              className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <ClipboardCopy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy markdown'}
            </button>
            <button
              type="button"
              onClick={download}
              disabled={!summary}
              data-testid="presubmit-export"
              className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <Download className="h-4 w-4" /> Export .md
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
