import type { AiErrorKind, ContextBundle, ModelProvider, ReviewAxis, ReviewConfidence, ReviewFinding, ReviewSeverity, ReviewTotals } from '@latex-studio/shared';
import { mathsFindings, spellingFindings } from './axes.js';
import { llmReviewFindings } from './llm.js';
import { classifyAiError } from '../providers/index.js';

export interface ReviewEngineInput {
  texFiles: { path: string; content: string }[];
  /** Shared context: macros, assumptions, and references (with provenance). */
  bundle: ContextBundle;
  customWords: string[];
  mathcheckUrl: string;
  modelProvider: ModelProvider;
  model: string;
  deterministicOnly: boolean;
}

/** `${file}:${hash}` → cached LLM findings (re-review only re-checks changed files). */
const llmCache = new Map<string, ReviewFinding[]>();
export function clearReviewCache(): void {
  llmCache.clear();
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(33, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function dedupe(findings: ReviewFinding[]): ReviewFinding[] {
  const seen = new Set<string>();
  const out: ReviewFinding[] = [];
  for (const f of findings) {
    const key = `${f.file}:${f.lineSpan.fromLine}:${f.axis}:${f.message.slice(0, 48).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

export function reviewTotals(findings: ReviewFinding[]): ReviewTotals {
  const byAxis: Record<ReviewAxis, number> = { maths: 0, literature: 0, background: 0, prose: 0 };
  const bySeverity: Record<ReviewSeverity, number> = { error: 0, warning: 0, info: 0 };
  const byConfidence: Partial<Record<ReviewConfidence, number>> = {};
  let refutedMaths = 0;
  for (const f of findings) {
    byAxis[f.axis] += 1;
    bySeverity[f.severity] += 1;
    byConfidence[f.confidence] = (byConfidence[f.confidence] ?? 0) + 1;
    if (f.axis === 'maths' && f.confidence === 'refuted') refutedMaths += 1;
  }
  return { byAxis, bySeverity, byConfidence, refutedMaths };
}

export interface ReviewResult {
  findings: ReviewFinding[];
  /** Set when an LLM axis call failed — deterministic findings still returned. */
  aiError: AiErrorKind | null;
}

export async function runReview(input: ReviewEngineInput, signal?: AbortSignal): Promise<ReviewResult> {
  const opts = { mathcheckUrl: input.mathcheckUrl, macros: input.bundle.macros, assumptions: input.bundle.assumptions };

  // Axes 1 (maths/SymPy) and 4-spelling (deterministic) run directly, always.
  const [maths, spelling] = await Promise.all([
    mathsFindings(input.texFiles, opts),
    spellingFindings(input.texFiles, input.customWords),
  ]);

  // Axes 2, 3, 4-prose: the LLM proposes, per file, cached by content. An LLM
  // failure (e.g. credit exhausted) never sinks the deterministic review.
  let llm: ReviewFinding[] = [];
  let aiError: AiErrorKind | null = null;
  if (!input.deterministicOnly) {
    const perFile = await Promise.all(
      input.texFiles.map(async (f) => {
        const key = `${f.path}:${hash(f.content)}`;
        const cached = llmCache.get(key);
        if (cached) return cached;
        try {
          const found = await llmReviewFindings(input.modelProvider, input.model, f.path, f.content, input.bundle, signal);
          llmCache.set(key, found);
          return found;
        } catch (err) {
          if (!aiError) aiError = classifyAiError(err);
          return [] as ReviewFinding[];
        }
      }),
    );
    llm = perFile.flat();
  }

  return { findings: dedupe([...maths, ...spelling, ...llm]), aiError };
}
