import type {
  DerivationResult,
  EquivalenceResult,
  MathAuditBlock,
  MathAuditReport,
  MathAuditVerdict,
  MathParseResult,
  DerivationVerdict,
} from '@latex-studio/shared';
import { type MathBlock, extractMathBlocks, splitEquation } from './extract.js';

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

async function postMathcheck<T>(url: string, path: string, body: unknown, timeoutMs: number): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

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

  const blocks: MathBlock[] = files.flatMap((f) => extractMathBlocks(f.path, f.content));
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

  // Multi-step block ⇒ derivation.
  if (block.steps.length >= 2) {
    const key = `der|${block.steps.map((s) => norm(s.latex)).join('§')}|${ctx.assumptions}|${ctx.mk}`;
    let result = cacheGet<DerivationResult>(key);
    const cached = result !== undefined;
    let called = false;
    if (!result) {
      called = true;
      try {
        result = await postMathcheck<DerivationResult>(
          ctx.mathcheckUrl,
          '/check-derivation',
          { steps: block.steps.map((s) => s.latex), assumptions: ctx.assumptions, macros: ctx.macros },
          ctx.timeoutMs,
        );
        cacheSet(key, result);
      } catch {
        result = { steps: [], transitions: [], firstFailingPair: null, error: 'timeout' };
      }
    }
    const byTo = new Map(result.transitions.map((t) => [t.to, t]));
    const rows: MathAuditBlock[] = block.steps.map((step, i) => {
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
    return { rows, cached, called };
  }

  // Single step.
  const step = block.steps[0]!;
  const split = splitEquation(step.latex);
  if (split) {
    const key = `eq|${norm(split.lhs)}=${norm(split.rhs)}|${ctx.assumptions}|${ctx.mk}`;
    let result = cacheGet<EquivalenceResult>(key);
    const cached = result !== undefined;
    let called = false;
    if (!result) {
      called = true;
      try {
        result = await postMathcheck<EquivalenceResult>(
          ctx.mathcheckUrl,
          '/equivalent',
          { lhs: split.lhs, rhs: split.rhs, assumptions: ctx.assumptions, macros: ctx.macros },
          ctx.timeoutMs,
        );
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
      ],
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
      const res = await postMathcheck<MathParseResult>(
        ctx.mathcheckUrl,
        '/parse',
        { latex: step.latex, macros: ctx.macros },
        ctx.timeoutMs,
      );
      parseable = res.ok === true;
      cacheSet(key, parseable);
    } catch {
      parseable = false;
    }
  }
  return {
    rows: [row(step, parseable ? 'passed' : 'unknown', { method: parseable ? 'well-formed' : 'unparseable', cached })],
    cached,
    called,
  };
}
