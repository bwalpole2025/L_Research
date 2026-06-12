'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, FileText, Info, Loader2, Play, Sparkles, TriangleAlert, Wand2 } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import type { Diagnostic, DiagnosticSeverity } from '@/lib/types';

/**
 * OVERLEAF-STYLE DIAGNOSTICS PANEL — three-tier entries grouped red → orange →
 * yellow → grey, per-tier count badges, filter chips (errors + important shown
 * by default), raw-excerpt expanders, jump-to-first-error, a full raw-log view,
 * one-click recompile on rerun hints, and "Fix with Claude" on every red and
 * orange entry (the existing diff-and-accept approval flow).
 */

const TIER: Record<DiagnosticSeverity, { label: string; icon: typeof CircleAlert; border: string; iconColor: string; badge: string }> = {
  error: {
    label: 'Errors',
    icon: CircleAlert,
    border: 'border-l-red-500 dark:border-l-red-400',
    iconColor: 'text-red-500',
    badge: 'bg-red-500 text-white',
  },
  'warning-important': {
    label: 'Important',
    icon: TriangleAlert,
    border: 'border-l-orange-500 dark:border-l-orange-400',
    iconColor: 'text-orange-500',
    badge: 'bg-orange-500 text-white',
  },
  'warning-minor': {
    label: 'Minor',
    icon: TriangleAlert,
    border: 'border-l-yellow-500 dark:border-l-yellow-400',
    iconColor: 'text-yellow-500',
    badge: 'bg-yellow-500 text-black',
  },
  info: {
    label: 'Info',
    icon: Info,
    border: 'border-l-zinc-400 dark:border-l-zinc-500',
    iconColor: 'text-zinc-400',
    badge: 'bg-zinc-400 text-white',
  },
};

const TIERS: DiagnosticSeverity[] = ['error', 'warning-important', 'warning-minor', 'info'];

export function DiagnosticsPanel() {
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const compiling = useEditorStore((s) => s.compiling);
  const compileStatus = useEditorStore((s) => s.compileStatus);
  const compileDurationMs = useEditorStore((s) => s.compileDurationMs);
  const compileError = useEditorStore((s) => s.compileError);
  const compileLog = useEditorStore((s) => s.compileLog);
  const pdfUrl = useEditorStore((s) => s.pdfUrl);
  const projects = useEditorStore((s) => s.projects);
  const projectId = useEditorStore((s) => s.projectId);
  const revealLocation = useEditorStore((s) => s.revealLocation);
  const compileProject = useEditorStore((s) => s.compileProject);
  const requestFix = useAiStore((s) => s.requestFix);
  const suggestAllFixes = useAiStore((s) => s.suggestAllFixes);
  const aiAvailable = useAiStore((s) => s.status.available);
  const editBusy = useAiStore((s) => s.editBusy);
  const errorFixesEnabled = useAiStore((s) => s.errorFixesEnabled);
  const fixNotice = useAiStore((s) => s.fixNotice);
  const offerRecompile = useAiStore((s) => s.offerRecompile);
  const clearRecompileOffer = useAiStore((s) => s.clearRecompileOffer);

  // Default view: errors + important. Minor/info are opt-in chips.
  const [shown, setShown] = useState<Record<DiagnosticSeverity, boolean>>({
    error: true,
    'warning-important': true,
    'warning-minor': false,
    info: false,
  });
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [showRawLog, setShowRawLog] = useState(false);

  const rootFile = projects.find((p) => p.id === projectId)?.rootFile ?? 'main.tex';
  const counts = useMemo(() => {
    const c: Record<DiagnosticSeverity, number> = { error: 0, 'warning-important': 0, 'warning-minor': 0, info: 0 };
    for (const d of diagnostics) c[d.severity] = (c[d.severity] ?? 0) + 1;
    return c;
  }, [diagnostics]);

  const jump = (d: Diagnostic) => {
    if (d.line === undefined) return;
    void revealLocation(d.file ?? rootFile, d.line, d.column);
  };

  const firstError = diagnostics.find((d) => d.severity === 'error' && d.line !== undefined);
  const needsRerun = diagnostics.some((d) => d.rerunHint);

  const summary = compiling
    ? 'compiling…'
    : compileStatus === 'success'
      ? (counts['warning-important'] ?? 0) + (counts['warning-minor'] ?? 0) > 0
        ? `Compiled with ${(counts['warning-important'] ?? 0) + (counts['warning-minor'] ?? 0)} warning${(counts['warning-important'] ?? 0) + (counts['warning-minor'] ?? 0) === 1 ? '' : 's'}`
        : 'Compiled cleanly'
      : compileStatus
        ? `Failed — ${counts.error ?? 0} error${(counts.error ?? 0) === 1 ? '' : 's'}${pdfUrl ? ' · PDF shown is the last successful build' : ''}`
        : 'Compile to see diagnostics.';

  const toggleExpand = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      {/* ── Header: badges · chips · summary · actions ── */}
      <div className="flex h-10 flex-none items-center gap-2 overflow-x-auto border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">Problems</span>

        {/* Filter chips with per-tier count badges */}
        {TIERS.map((t) => (
          <button
            key={t}
            type="button"
            data-testid={`diag-chip-${t}`}
            aria-pressed={shown[t]}
            onClick={() => setShown((s) => ({ ...s, [t]: !s[t] }))}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors ${
              shown[t]
                ? 'border-zinc-300 bg-white text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200'
                : 'border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
          >
            {TIER[t]!.label}
            <span data-testid={`diag-count-${t}`} className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold ${(counts[t] ?? 0) > 0 ? TIER[t]!.badge : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400'}`}>
              {counts[t]}
            </span>
          </button>
        ))}

        {firstError && (
          <button
            type="button"
            data-testid="jump-first-error"
            onClick={() => jump(firstError)}
            className="inline-flex items-center gap-1 rounded border border-red-300 px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            <CircleAlert className="h-3 w-3" /> First error
          </button>
        )}
        {(counts.error ?? 0) > 1 && aiAvailable && errorFixesEnabled && (
          <button
            type="button"
            data-testid="fix-all-errors"
            onClick={() => void suggestAllFixes()}
            disabled={editBusy}
            title="Suggest fixes for all errors — each is approved independently"
            className="inline-flex items-center gap-1 rounded border border-blue-300 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
          >
            <Wand2 className="h-3 w-3" /> Fix all
          </button>
        )}
        {(needsRerun || offerRecompile) && (
          <button
            type="button"
            data-testid="recompile-after-fix"
            onClick={() => {
              clearRecompileOffer();
              void compileProject();
            }}
            title={needsRerun ? 'References changed — a rerun resolves them' : 'Recompile to see whether the accepted fix resolved the error'}
            className="inline-flex items-center gap-1 rounded border border-emerald-300 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
          >
            <Play className="h-3 w-3" /> Recompile
          </button>
        )}

        <span className="ml-auto flex flex-none items-center gap-2 text-zinc-400">
          <button
            type="button"
            data-testid="toggle-raw-log"
            aria-pressed={showRawLog}
            onClick={() => setShowRawLog((v) => !v)}
            disabled={!compileLog}
            className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] disabled:opacity-40 ${
              showRawLog
                ? 'border-zinc-400 bg-zinc-100 text-zinc-700 dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-200'
                : 'border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800'
            }`}
          >
            <FileText className="h-3 w-3" /> Raw log
          </button>
          {compiling && (
            <span className="inline-flex items-center gap-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> compiling…
            </span>
          )}
          {!compiling && compileStatus && (
            <span data-testid="compile-summary" className={compileStatus === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
              {summary}
              {compileDurationMs != null ? ` · ${(compileDurationMs / 1000).toFixed(1)}s` : ''}
            </span>
          )}
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-auto text-sm">
        {fixNotice && (
          <p data-testid="fix-notice" className="border-b border-zinc-100 px-3 py-1.5 text-[11px] text-amber-700 dark:border-zinc-800 dark:text-amber-300">
            {fixNotice}
          </p>
        )}
        {showRawLog ? (
          <pre data-testid="raw-log" className="whitespace-pre-wrap px-3 py-2 font-mono text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {compileLog ?? 'No log captured yet.'}
          </pre>
        ) : compileError ? (
          <p className="px-3 py-3 text-sm text-red-600 dark:text-red-400">{compileError}</p>
        ) : diagnostics.length === 0 ? (
          <p className="px-3 py-3 text-xs text-zinc-400">{compileStatus ? 'No problems.' : 'Compile to see diagnostics.'}</p>
        ) : (
          <ul className="py-1.5">
            {diagnostics.map((d, i) => {
              if (!shown[d.severity]) return null;
              const tier = TIER[d.severity]!;
              const Icon = tier.icon;
              const clickable = d.line !== undefined;
              const fixable = (d.severity === 'error' || d.severity === 'warning-important') && !d.rerunHint && aiAvailable && errorFixesEnabled;
              const isOpen = expanded.has(i);
              return (
                <li key={i} data-testid={`diag-${d.severity}`} className={`group mx-2 mb-1 overflow-hidden rounded-md border border-l-2 border-zinc-200 bg-white shadow-[0_1px_0_rgba(18,25,38,0.03)] dark:border-zinc-800 dark:bg-zinc-900/40 ${tier.border}`}>
                  <div className="flex items-stretch">
                    {d.rawExcerpt && (
                      <button type="button" onClick={() => toggleExpand(i)} aria-label="Show raw log excerpt" className="flex items-center pl-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => jump(d)}
                      disabled={!clickable}
                      className={`flex min-w-0 flex-1 items-start gap-2 px-2.5 py-1.5 text-left ${clickable ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/70' : 'cursor-default'}`}
                    >
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tier.iconColor}`} />
                      <span className="min-w-0 flex-1">
                        <span className="break-words text-zinc-700 dark:text-zinc-200">{d.message}</span>
                        {(d.file || d.line !== undefined) && (
                          <span className="ml-2 whitespace-nowrap text-xs text-zinc-400">
                            {d.file ?? rootFile}
                            {d.line !== undefined ? `:${d.line}` : ''}
                          </span>
                        )}
                      </span>
                    </button>
                    {d.rerunHint && (
                      <button
                        type="button"
                        data-testid="diag-rerun"
                        onClick={() => void compileProject()}
                        title="A rerun (not an edit) resolves this"
                        className="my-1 mr-2 inline-flex shrink-0 items-center gap-1 self-center rounded border border-emerald-300 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
                      >
                        <Play className="h-3 w-3" /> Recompile
                      </button>
                    )}
                    {fixable && (
                      <button
                        type="button"
                        onClick={() => void requestFix(d)}
                        disabled={editBusy}
                        title="Fix with Claude"
                        data-testid="fix-with-claude"
                        className="my-1 mr-2 inline-flex shrink-0 items-center gap-1 self-center rounded border border-blue-300 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 opacity-0 transition-opacity hover:bg-blue-50 focus:opacity-100 group-hover:opacity-100 disabled:opacity-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10"
                      >
                        <Sparkles className="h-3 w-3" /> Fix
                      </button>
                    )}
                  </div>
                  {isOpen && d.rawExcerpt && (
                    <pre data-testid="diag-excerpt" className="overflow-x-auto border-t border-zinc-100 bg-zinc-50 px-3 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                      {d.rawExcerpt}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
