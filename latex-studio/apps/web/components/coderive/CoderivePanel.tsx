'use client';

import { useState } from 'react';
import { CheckCircle2, CircleHelp, Loader2, XCircle } from 'lucide-react';
import { useCoderiveStore } from '@/lib/coderiveStore';
import type { CoderiveCandidate, CoderiveSkipped, CoderiveStatus, ContextBundleSummary, DocumentVerification, MathAuditVerdict } from '@/lib/types';
import { Markdown } from '../ai/Markdown';

const BADGE: Record<CoderiveStatus, { icon: typeof CheckCircle2; cls: string; label: string }> = {
  verified: { icon: CheckCircle2, cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', label: '✓ verified (SymPy)' },
  unverified: { icon: XCircle, cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', label: '✗ unverified' },
  unknown: { icon: CircleHelp, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', label: '? unknown' },
};

function fmtCx(cx: NonNullable<CoderiveCandidate['counterexample']>): string {
  const vals = Object.entries(cx.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}lhs=${cx.lhsVal}, rhs=${cx.rhsVal}`;
}

function CandidateCard({ candidate }: { candidate: CoderiveCandidate }) {
  const insert = useCoderiveStore((s) => s.insert);
  const badge = BADGE[candidate.status];
  const Icon = badge.icon;

  return (
    <li className="mx-2 mb-2 rounded-md border border-zinc-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(18,25,38,0.03)] dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
          <Icon className="h-3 w-3" /> {badge.label}
        </span>
        {candidate.retriesUsed > 0 && <span className="text-[11px] text-zinc-400">{candidate.retriesUsed} retr{candidate.retriesUsed === 1 ? 'y' : 'ies'}</span>}
        <span className="text-[11px] text-zinc-400">SymPy: {candidate.method}</span>
      </div>

      <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950">
        <Markdown content={`$$${candidate.latex}$$`} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
        {candidate.technique && <span className="rounded bg-zinc-100 px-1.5 font-medium dark:bg-zinc-800">{candidate.technique}</span>}
        {candidate.groundedIn.map((k) => (
          <span key={k} className="rounded bg-blue-100 px-1.5 font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" title="cite key the proposal drew on">
            {k}
          </span>
        ))}
        {candidate.rationale && <span className="italic">{candidate.rationale}</span>}
      </div>

      {candidate.status === 'unverified' && candidate.counterexample && (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">SymPy counterexample — {fmtCx(candidate.counterexample)}</p>
      )}
      {candidate.attributionUnverified && candidate.groundedIn.length > 0 && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">attribution unverified — confirm against source (the cited source text was not provided)</p>
      )}

      <div className="mt-1.5">
        {candidate.status === 'verified' ? (
          <button
            type="button"
            onClick={() => void insert(candidate)}
            className="rounded-md border border-emerald-300 px-2 py-0.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 dark:border-emerald-500/40 dark:text-emerald-300 dark:hover:bg-emerald-500/10"
          >
            Insert (diff)
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void insert(candidate, true)}
            className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            title="Inserts with an amber 'unverified' underline — SymPy did not confirm this step"
          >
            Insert anyway (unverified)
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Proposals the maths guard rejected (bibliography text, prose, …). Shown for
 * transparency only — never sent to SymPy, deliberately NO insert affordance.
 */
function SkippedList({ skipped }: { skipped: CoderiveSkipped[] }) {
  if (skipped.length === 0) return null;
  return (
    <div className="border-t border-zinc-100 px-3 py-2 dark:border-zinc-800" data-testid="coderive-skipped">
      <p className="text-[11px] font-medium text-zinc-400">not a maths expression — skipped (never sent to the verifier)</p>
      <ul className="mt-1 space-y-0.5">
        {skipped.map((s, i) => (
          <li key={`${s.latex}:${i}`} className="flex items-baseline gap-2 text-[11px] text-zinc-400">
            <span className="rounded bg-zinc-100 px-1 font-medium dark:bg-zinc-800">{s.reason}</span>
            <code className="truncate font-mono">{s.latex}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

const AUDIT_BADGE: Record<MathAuditVerdict, { cls: string; label: string; icon: typeof CheckCircle2 }> = {
  passed: { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', label: '✓ SymPy', icon: CheckCircle2 },
  failing: { cls: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', label: '✗ SymPy', icon: XCircle },
  unknown: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', label: '? SymPy', icon: CircleHelp },
};

/**
 * Whole-document verification ("verify-document" intent). SymPy's verdict on each
 * equation is authoritative; the AI comment is context only. Deliberately has NO
 * insert affordance — these are findings about existing algebra, not proposals.
 */
function DocumentVerificationView({ dv }: { dv: DocumentVerification }) {
  const comments = new Map(dv.comments.map((c) => [c.id, c.comment]));
  const t = dv.report.totals;
  // Show the equations SymPy could not pass; passing ones are summarised in the totals.
  const findings = dv.report.blocks.filter((b) => b.verdict !== 'passed');

  return (
    <div data-testid="coderive-docverify">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-3 py-2 text-[11px] dark:border-zinc-800">
        <span className="font-medium text-zinc-500 dark:text-zinc-400">SymPy checked {t.checked} equation(s):</span>
        <span className="text-emerald-600 dark:text-emerald-400">{t.passed} ✓</span>
        <span className="text-red-600 dark:text-red-400">{t.failing} ✗</span>
        <span className="text-amber-600 dark:text-amber-400">{t.unknown} ?</span>
      </div>

      {findings.length === 0 ? (
        <p className="px-3 py-3 text-xs text-emerald-600 dark:text-emerald-400">
          SymPy verified every equation it could parse. Nothing failed or was left undecided.
        </p>
      ) : (
        <ul className="py-2">
          {findings.map((b) => {
            const badge = AUDIT_BADGE[b.verdict];
            const Icon = badge.icon;
            const comment = comments.get(b.id);
            return (
              <li
                key={b.id}
                data-testid="docverify-finding"
                className="mx-2 mb-2 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40"
              >
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${badge.cls}`}>
                    <Icon className="h-3 w-3" /> {badge.label}
                  </span>
                  <span className="font-mono text-zinc-400">
                    {b.file}:{b.lineStart}
                  </span>
                  {b.method && <span className="text-zinc-400">{b.method}</span>}
                </div>
                <div className="mt-2 overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950">
                  <Markdown content={`$$${b.latex}$$`} />
                </div>
                {b.verdict === 'failing' && b.counterexample && (
                  <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">SymPy counterexample — {fmtCx(b.counterexample)}</p>
                )}
                {comment && (
                  <p className="mt-1 text-[11px] text-sky-700 dark:text-sky-300">
                    <span className="font-medium">AI context (not a verdict):</span> {comment}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="px-3 py-2 text-[11px] text-zinc-400">
        Every verdict here comes from SymPy, over the equations actually in your document — bibliography and prose are never sent to
        the verifier. A ✗ means the two sides are not algebraically equal; a ? means SymPy could not decide (often an asymptotic step,
        an undefined macro, or a definition rather than an identity). The AI notes are hypotheses to guide you, never correctness rulings.
      </p>
    </div>
  );
}

function ContextUsed({ ctx }: { ctx: ContextBundleSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
        {open ? '▾' : '▸'} context used ({ctx.references.length} ref{ctx.references.length === 1 ? '' : 's'}, {ctx.macroCount} macros)
      </button>
      {open && (
        <div className="mt-2 space-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
          <p>Macros: {ctx.macroCount} · assumptions: {ctx.assumptions || '(none)'} · document window: {ctx.documentWindowChars} chars</p>
          {ctx.references.length > 0 && (
            <ul>
              {ctx.references.map((r) => (
                <li key={r.key}>
                  <span className="font-mono text-blue-600 dark:text-blue-400">{r.key}</span>{' '}
                  <span
                    className={
                      r.provenance === 'full-text'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : r.provenance === 'metadata-only'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-zinc-400'
                    }
                  >
                    {r.provenance}
                  </span>
                  {r.passageCount > 0 && ` · ${r.passageCount} passage(s) from ${r.sourceFile}`}
                  {r.provenance !== 'full-text' && ' · content not provided to the model'}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer">document window preview</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-950">{ctx.windowPreview}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

export function CoderivePanel() {
  const running = useCoderiveStore((s) => s.running);
  const progress = useCoderiveStore((s) => s.progress);
  const rounds = useCoderiveStore((s) => s.rounds);
  const response = useCoderiveStore((s) => s.response);
  const error = useCoderiveStore((s) => s.error);
  const intent = useCoderiveStore((s) => s.intent);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)] text-sm">
      <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">Co-derive</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">{intent}</span>
        {running && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
        {running && progress && <span className="text-[11px] text-zinc-400" data-testid="coderive-progress">{progress}</span>}
      </div>

      <div className="flex-1 overflow-auto">
        {error && <p className="px-3 py-3 text-xs text-red-600">{error}</p>}
        {!response && !running && !error && (
          <p className="px-3 py-3 text-xs text-zinc-400">No candidates yet.</p>
        )}

        {/* Whole-document verification renders its own findings view. */}
        {response?.documentVerification && <DocumentVerificationView dv={response.documentVerification} />}

        {!response?.documentVerification && (running || (response && response.rounds.length > 1)) && rounds.length > 0 && (
          <ol className="border-b border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {rounds.map((r) => {
              const v = (s: string) => r.verdicts.filter((x) => x.status === s).length;
              return (
                <li key={r.round}>
                  Round {r.round}: proposed {r.proposalCount} → <span className="text-emerald-600 dark:text-emerald-400">{v('verified')}✓</span>{' '}
                  <span className="text-red-600 dark:text-red-400">{v('unverified')}✗</span> <span className="text-amber-600 dark:text-amber-400">{v('unknown')}?</span>
                  {v('unverified') > 0 && r.round < rounds.length && ' — feeding counterexample back…'}
                </li>
              );
            })}
          </ol>
        )}

        {response && !response.documentVerification && (
          <>
            <ul className="py-2">
              {response.candidates.map((c, i) => (
                <CandidateCard key={`${c.latex}:${i}`} candidate={c} />
              ))}
              {response.candidates.length === 0 && <li className="px-3 py-3 text-xs text-zinc-400">No proposals.</li>}
            </ul>
            <SkippedList skipped={response.skipped ?? []} />
            <ContextUsed ctx={response.context} />
            <p className="px-3 py-2 text-[11px] text-zinc-400">
              A ✓ means SymPy proved algebraic equivalence under the stated assumptions — <em>not</em> that the modelling, the
              chosen step, the asymptotics, or any citation is correct. Those remain for you to check.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
