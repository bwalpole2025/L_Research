'use client';

import { CircleAlert, FileSearch, Link2, Sigma, Sparkles, SpellCheck, type LucideIcon } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore, type BottomTab } from '@/lib/thesisStore';
import { DiagnosticsPanel } from '../DiagnosticsPanel';
import { MathsAuditPanel } from './MathsAuditPanel';
import { ProsePanel } from './ProsePanel';
import { XrefPanel } from './XrefPanel';
import { CoderivePanel } from '../coderive/CoderivePanel';
import { useCoderiveStore } from '@/lib/coderiveStore';
import { ReviewPanel } from '../review/ReviewPanel';
import { useReviewStore } from '@/lib/reviewStore';

const TABS: { key: BottomTab; label: string; icon: LucideIcon }[] = [
  { key: 'problems', label: 'Problems', icon: CircleAlert },
  { key: 'maths', label: 'Maths audit', icon: Sigma },
  { key: 'prose', label: 'Prose', icon: SpellCheck },
  { key: 'refs', label: 'References', icon: Link2 },
  { key: 'coderive', label: 'Co-derive', icon: Sparkles },
  { key: 'review', label: 'Review', icon: FileSearch },
];

export function BottomPanelTabs() {
  const tab = useThesisStore((s) => s.bottomTab);
  const setTab = useThesisStore((s) => s.setBottomTab);
  const problems = useEditorStore((s) => s.diagnostics.length);
  const audit = useThesisStore((s) => s.auditReport);
  const prose = useThesisStore((s) => s.proseReport);
  const xref = useThesisStore((s) => s.xref);
  const coderive = useCoderiveStore((s) => s.response);
  const review = useReviewStore((s) => s.findings);
  const reviewRefuted = useReviewStore((s) => s.totals?.refutedMaths ?? 0);
  const hasErrorDiagnostic = useEditorStore((s) => s.diagnostics.some((d) => d.severity === 'error'));

  const counts: Record<BottomTab, number> = {
    problems,
    maths: audit ? audit.totals.failing + audit.totals.unknown : 0,
    prose: prose ? prose.diagnostics.length : 0,
    refs: xref ? xref.totals.error : 0,
    coderive: coderive ? coderive.candidates.filter((c) => c.status === 'verified').length : 0,
    review: review.length,
  };
  const danger: Record<BottomTab, boolean> = {
    problems: hasErrorDiagnostic,
    maths: (audit?.totals.failing ?? 0) > 0,
    prose: (prose?.totals.error ?? 0) > 0,
    refs: (xref?.totals.error ?? 0) > 0,
    coderive: false,
    review: reviewRefuted > 0,
  };

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-2 pt-1.5 text-xs dark:border-zinc-800" role="tablist">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            data-testid={`tab-${t.key}`}
            onClick={() => setTab(t.key)}
            className={`flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 font-medium transition-colors ${
              tab === t.key
                ? 'border-zinc-200 bg-[var(--ls-surface)] text-zinc-950 dark:border-zinc-800 dark:text-zinc-50'
                : 'border-transparent text-zinc-500 hover:bg-white/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/80 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${tab === t.key ? 'text-blue-500' : 'text-zinc-400'}`} />
            {t.label}
            {counts[t.key] > 0 && (
              <span
                className={`rounded px-1.5 text-[10px] font-semibold ${
                  danger[t.key]
                    ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                    : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                {counts[t.key]}
              </span>
            )}
          </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'problems' && <DiagnosticsPanel />}
        {tab === 'maths' && <MathsAuditPanel />}
        {tab === 'prose' && <ProsePanel />}
        {tab === 'refs' && <XrefPanel />}
        {tab === 'coderive' && <CoderivePanel />}
        {tab === 'review' && <ReviewPanel />}
      </div>
    </div>
  );
}
