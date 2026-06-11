'use client';

import { CircleAlert, FileSearch, Info, Loader2, Play, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import { reviewStyle } from '@latex-studio/shared';
import { useReviewStore } from '@/lib/reviewStore';
import type { ReviewAxis, ReviewFinding, ReviewSeverity } from '@/lib/types';

const SEV_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;
const SEV_COLOUR: Record<ReviewSeverity, string> = { error: 'text-red-500', warning: 'text-amber-500', info: 'text-sky-500' };
const AXES: ReviewAxis[] = ['maths', 'literature', 'background', 'prose'];

function fmtCx(cx: NonNullable<ReviewFinding['counterexample']>): string {
  const vals = Object.entries(cx.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}lhs=${cx.lhsVal}, rhs=${cx.rhsVal}`;
}

function Row({ finding }: { finding: ReviewFinding }) {
  const jumpTo = useReviewStore((s) => s.jumpTo);
  const explain = useReviewStore((s) => s.explain);
  const applyCorrection = useReviewStore((s) => s.applyCorrection);
  const canCorrect = useReviewStore((s) => s.canCorrect);
  const style = reviewStyle(finding.axis, finding.confidence);
  const Icon = SEV_ICON[finding.severity];

  return (
    <li className="mx-2 mb-1 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: style.hex }} title={style.colour} />
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${SEV_COLOUR[finding.severity]}`} />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => jumpTo(finding)}
            className="block w-full text-left text-xs text-zinc-700 hover:underline dark:text-zinc-200"
          >
            {finding.message}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
            <span className="rounded bg-zinc-100 px-1 font-medium dark:bg-zinc-800">{finding.axis}</span>
            <span>{finding.file}:{finding.lineSpan.fromLine}</span>
            <span className={style.machineVerified ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {style.machineVerified ? 'machine-verified' : 'verify'}
            </span>
            <button
              type="button"
              onClick={() => explain(finding)}
              className="inline-flex items-center gap-1 rounded border border-blue-300 px-1.5 py-0.5 text-blue-700 hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
            >
              <Sparkles className="h-3 w-3" /> Explain
            </button>
            {canCorrect(finding) && (
              <button
                type="button"
                data-testid="apply-correction"
                onClick={() => void applyCorrection(finding)}
                title={`Replace “${finding.quotedSpan}” with “${finding.suggestion}” — opens a diff to approve`}
                className="inline-flex items-center gap-1 rounded border border-emerald-300 px-1.5 py-0.5 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
              >
                <Wand2 className="h-3 w-3" /> Apply…
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-400">{style.label}</p>
          {finding.suggestion && <p className="text-[11px] text-emerald-600 dark:text-emerald-400">Suggestion: {finding.suggestion}</p>}
          {finding.counterexample && <p className="text-[11px] text-red-600 dark:text-red-400">Counterexample — {fmtCx(finding.counterexample)}</p>}
          {finding.reference && (
            <p className="text-[11px] text-zinc-500">
              [{finding.reference}]{finding.quotedSpan ? ` — “${finding.quotedSpan}”` : ''}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export function ReviewPanel() {
  const running = useReviewStore((s) => s.running);
  const error = useReviewStore((s) => s.error);
  const totals = useReviewStore((s) => s.totals);
  const findings = useReviewStore((s) => s.findings);
  const axisFilter = useReviewStore((s) => s.axisFilter);
  const confidenceFilter = useReviewStore((s) => s.confidenceFilter);
  const toggleAxis = useReviewStore((s) => s.toggleAxis);
  const runReview = useReviewStore((s) => s.runReview);
  const compileAndCheck = useReviewStore((s) => s.compileAndCheck);
  const reviewOnCompile = useReviewStore((s) => s.reviewOnCompile);
  const setReviewOnCompile = useReviewStore((s) => s.setReviewOnCompile);

  const visible = findings.filter((f) => axisFilter.size === 0 || axisFilter.has(f.axis));

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="flex h-10 flex-wrap items-center gap-2 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void runReview('file')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} File
        </button>
        <button
          type="button"
          onClick={() => void runReview('project')}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <FileSearch className="h-3 w-3" /> Project
        </button>
        <button
          type="button"
          data-testid="compile-and-check"
          onClick={() => void compileAndCheck()}
          disabled={running}
          title="Compile, then check the fresh PDF — highlights map onto the new compile"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300"
        >
          <Play className="h-3 w-3" /> Compile &amp; Check
        </button>
        {totals && (
          <span className="flex items-center gap-2 text-zinc-400">
            <span className={totals.refutedMaths > 0 ? 'font-medium text-red-500' : 'text-emerald-600 dark:text-emerald-400'}>
              {totals.refutedMaths} algebra error{totals.refutedMaths === 1 ? '' : 's'}
            </span>
            <span>· {findings.length} findings</span>
          </span>
        )}
        <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400" title="Re-run the review after every successful compile (costs model calls)">
          <input type="checkbox" checked={reviewOnCompile} onChange={(e) => setReviewOnCompile(e.target.checked)} className="h-3 w-3 accent-blue-500" />
          Review on compile
        </label>
      </div>

      {findings.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 px-3 py-1.5 text-[11px] dark:border-zinc-800">
          {AXES.map((a) => {
            const n = findings.filter((f) => f.axis === a).length;
            if (n === 0) return null;
            const active = axisFilter.has(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAxis(a)}
                className={`rounded px-1.5 py-0.5 font-medium ${active ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}`}
              >
                {a} {n}
              </button>
            );
          })}
          {(axisFilter.size > 0 || confidenceFilter.size > 0) && (
            <button type="button" onClick={() => axisFilter.forEach((a) => toggleAxis(a))} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
              clear
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto py-1.5">
        {error && <p className="px-3 py-3 text-xs text-red-600">{error}</p>}
        {!totals && !running && !error && (
          <p className="px-3 py-3 text-xs text-zinc-400">Run a document review — composes SymPy maths, en-GB spelling, and LLM checks into an annotated PDF.</p>
        )}
        {totals && visible.length === 0 && <p className="px-3 py-3 text-xs text-zinc-400">No findings match the filter.</p>}
        <ul>
          {visible.map((f) => (
            <Row key={f.id} finding={f} />
          ))}
        </ul>
        {totals && (
          <p className="px-3 py-2 text-[11px] text-zinc-400">
            Green (wrong equation, SymPy) and red (grammar/spelling, en-GB) are machine-verified. Yellow statements are LLM judgements
            that may be wrong either way — check them. No green means SymPy found no algebra error in what it could parse, not that the
            document is correct. Corrections open a diff for you to approve; nothing is changed without you accepting.
          </p>
        )}
      </div>
    </div>
  );
}
