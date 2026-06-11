import {
  makeVerificationCandidate,
  type DerivationResult,
  type EquivalenceResult,
  type MathAuditBlock,
  type MathAuditReport,
  type MathAuditVerdict,
  type MathParseResult,
  type DerivationVerdict,
  type VerificationCandidate,
} from '@latex-studio/shared';
import { checkDerivation, checkEquivalent, parseExpression } from '../coderive/mathcheck.js';
import { type MathBlock, extractMathBlocks, isBibliographyFile, splitEquation } from './extract.js';

export interface AuditInputFile {
  path: string;
  content: string;
}

export interface AuditOptions {
  mathcheckUrl: string;
  macros: Record<string, string>;
  assumptions: string;
  concurrency?: number;
  timeoutMs?: number;
}

/** In-memory verdict cache keyed on normalised content + settings (ADR-007). */
const verdictCache = new Map<string, unknown>();
const CACHE_CAP = 5000;

export function clearAuditCache(): void {
  verdictCache.clear();
}

function cacheGet<T>(key: string): T | undefined {
  return verdictCache.get(key) as T | undefined;
}
function cacheSet(key: string, value: unknown): void {
  if (verdictCache.size >= CACHE_CAP) {
    const first = verdictCache.keys().next().value;
    if (first !== undefined) verdictCache.delete(first);
  }
  verdictCache.set(key, value);
}

const norm = (s: string): string => s.replace(/\s+/g, '');
const macrosKey = (m: Record<string, string>): string =>
  JSON.stringify(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));

async function mapPool<I, O>(items: I[], limit: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const results = new Array<O>(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = index;
      index += 1;
      if (i >= items.length) break;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const VERDICT_MAP: Record<DerivationVerdict, MathAuditVerdict> = {
  ok: 'passed',
  fail: 'failing',
  unknown: 'unknown',
  unparseable: 'unknown',
};

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface BlockOutcome {
  rows: MathAuditBlock[];
  cached: boolean;
  called: boolean;
}

/** Audit every display-math block across the given files. */
export async function auditMaths(files: AuditInputFile[], opts: AuditOptions): Promise<MathAuditReport> {
  const { mathcheckUrl, macros, assumptions } = opts;
  const concurrency = opts.concurrency ?? 4;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const mk = macrosKey(macros);

  // Bibliography data (.bib/.bst) is never scanned for maths; extractMathBlocks
  // additionally blanks thebibliography/filecontents/BibTeX regions in .tex files.
  const blocks: MathBlock[] = files
    .filter((f) => !isBibliographyFile(f.path))
    .flatMap((f) => extractMathBlocks(f.path, f.content));
  // Drop empty blocks (no content lines).
  const nonEmpty = blocks.filter((b) => b.steps.length > 0);

  const outcomes = await mapPool(nonEmpty, concurrency, (block) =>
    auditBlock(block, { mathcheckUrl, macros, assumptions, timeoutMs, mk }),
  );

  const rows = outcomes.flatMap((o) => o.rows);
  const report: MathAuditReport = {
    blocks: rows,
    totals: {
      failing: rows.filter((r) => r.verdict === 'failing').length,
      unknown: rows.filter((r) => r.verdict === 'unknown').length,
      passed: rows.filter((r) => r.verdict === 'passed').length,
      checked: outcomes.filter((o) => o.called).length,
      cached: outcomes.filter((o) => o.cached).length,
    },
    byFile: {},
  };
  for (const r of rows) {
    if (r.verdict !== 'passed') report.byFile[r.file] = (report.byFile[r.file] ?? 0) + 1;
  }
  return report;
}

interface BlockCtx {
  mathcheckUrl: string;
  macros: Record<string, string>;
  assumptions: string;
  timeoutMs: number;
  mk: string;
}

interface GuardedStep {
  step: { latex: string; line: number };
  cand: VerificationCandidate;
}

async function auditBlock(block: MathBlock, ctx: BlockCtx): Promise<BlockOutcome> {
  const row = (
    step: { latex: string; line: number },
    verdict: MathAuditVerdict,
    extra: Partial<MathAuditBlock> = {},
  ): MathAuditBlock => ({
    id: `${block.file}:${step.line}:${shortHash(norm(step.latex))}`,
    file: block.file,
    lineStart: step.line,
    lineEnd: step.line,
    verdict,
    latex: step.latex,
    ...extra,
  });

  // Maths guard before EVERY mathcheck call. A step the guard refuses (prose or
  // bibliography text inside a math env) is reported honestly as unknown —
  // never silently dropped, and never sent to the verifier.
  const rejectedRows: MathAuditBlock[] = [];
  const kept: GuardedStep[] = [];
  for (const step of block.steps) {
    const made = makeVerificationCandidate(step.latex, 'display-math');
    if (made.rejected !== undefined) {
      rejectedRows.push(
        row(step, 'unknown', { method: 'non-math-skipped', message: `not a maths expression (${made.rejected}) — not sent to the verifier` }),
      );
    } else {
      kept.push({ step, cand: made.candidate });
    }
  }
  const byLine = (a: MathAuditBlock, b: MathAuditBlock): number => a.lineStart - b.lineStart;
  if (kept.length === 0) return { rows: rejectedRows.sort(byLine), cached: false, called: false };

  // Multi-step block ⇒ derivation (over the guard-passed steps).
  if (kept.length >= 2) {
    const key = `der|${kept.map((k) => norm(k.cand.latex)).join('§')}|${ctx.assumptions}|${ctx.mk}`;
    let result = cacheGet<DerivationResult>(key);
    const cached = result !== undefined;
    let called = false;
    if (!result) {
      called = true;
      try {
        result = await checkDerivation(ctx.mathcheckUrl, kept.map((k) => k.cand), ctx.assumptions, ctx.macros, ctx.timeoutMs);
        cacheSet(key, result);
      } catch {
        result = { steps: [], transitions: [], firstFailingPair: null, error: 'timeout' };
      }
    }
    const byTo = new Map(result.transitions.map((t) => [t.to, t]));
    const rows: MathAuditBlock[] = kept.map(({ step }, i) => {
      const parseErr = result?.steps[i]?.error;
      if (parseErr) return row(step, 'unknown', { method: 'unparseable', message: parseErr, cached });
      if (i === 0) return row(step, 'passed', { method: 'start', cached });
      const t = byTo.get(i);
      if (!t) return row(step, 'unknown', { method: 'unknown', cached });
      const v = VERDICT_MAP[t.verdict];
      return row(step, v, {
        method: t.method ?? t.verdict,
        ...(t.counterexample ? { counterexample: t.counterexample } : {}),
        cached,
      });
    });
    return { rows: [...rows, ...rejectedRows].sort(byLine), cached, called };
  }

  // Single step.
  const { step, cand } = kept[0]!;
  const split = splitEquation(step.latex);
  const lhs = split ? makeVerificationCandidate(split.lhs, 'display-math') : undefined;
  const rhs = split ? makeVerificationCandidate(split.rhs, 'display-math') : undefined;
  if (split && lhs?.candidate && rhs?.candidate) {
    const key = `eq|${norm(split.lhs)}=${norm(split.rhs)}|${ctx.assumptions}|${ctx.mk}`;
    let result = cacheGet<EquivalenceResult>(key);
    const cached = result !== undefined;
    let called = false;
    if (!result) {
      called = true;
      try {
        result = await checkEquivalent(ctx.mathcheckUrl, lhs.candidate, rhs.candidate, ctx.assumptions, ctx.macros, ctx.timeoutMs);
        cacheSet(key, result);
      } catch {
        result = { equivalent: 'unknown', method: 'timeout' };
      }
    }
    const verdict: MathAuditVerdict =
      result.equivalent === true ? 'passed' : result.equivalent === false ? 'failing' : 'unknown';
    return {
      rows: [
        row(step, verdict, {
          method: result.method,
          ...(result.counterexample ? { counterexample: result.counterexample } : {}),
          cached,
        }),
        ...rejectedRows,
      ].sort(byLine),
      cached,
      called,
    };
  }

  // Lone expression (no relation) — verify it at least parses.
  const key = `parse|${norm(step.latex)}|${ctx.mk}`;
  let parseable = cacheGet<boolean>(key);
  const cached = parseable !== undefined;
  let called = false;
  if (parseable === undefined) {
    called = true;
    try {
      const res: MathParseResult = await parseExpression(ctx.mathcheckUrl, cand, ctx.macros, ctx.timeoutMs);
      parseable = res.ok === true;
      cacheSet(key, parseable);
    } catch {
      parseable = false;
    }
  }
  return {
    rows: [
      row(step, parseable ? 'passed' : 'unknown', { method: parseable ? 'well-formed' : 'unparseable', cached }),
      ...rejectedRows,
    ].sort(byLine),
    cached,
    called,
  };
}
