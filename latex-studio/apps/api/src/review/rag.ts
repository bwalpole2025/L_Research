import type { PrismaClient } from '@prisma/client';
import type { ModelProvider, RetrievedPassage, ReviewFinding } from '@latex-studio/shared';
import { retrievePassages } from '../rag/retrieve.js';
import type { LibraryRef } from '../coderive/references.js';

/**
 * RAG-grounded axes. THE RULE: the LLM may only assert a discrepancy when it is
 * backed by a passage retrieved from the project's library. No retrieval = no
 * contradiction claim. The LLM never sees free rein — it can only reference the
 * passages the server retrieved, by index, and every rag finding is built through
 * makeRagFinding(), which refuses to construct one without evidence.
 */

export interface RagDeps {
  prisma: PrismaClient;
  projectId: string;
  mathcheckUrl: string;
  modelProvider: ModelProvider;
  model: string;
  /** citeKey → linked library item (loadLibraryResolver). */
  libraryItems: Map<string, LibraryRef>;
  signal?: AbortSignal;
}

/** The ONLY constructor for evidence-backed RAG findings. Throws without passages. */
export function makeRagFinding(
  base: Omit<ReviewFinding, 'confidence' | 'retrievedPassages'>,
  verdict: 'contradiction' | 'supported',
  passages: RetrievedPassage[],
): ReviewFinding {
  if (passages.length === 0) {
    throw new Error('RAG invariant violated: a rag finding requires at least one retrieved passage');
  }
  return {
    ...base,
    confidence: verdict === 'contradiction' ? 'rag-contradiction' : 'rag-supported',
    retrievedPassages: passages,
  };
}

// ── Claim extraction (axis C) ─────────────────────────────────────────────────

const EXTRACT_SYSTEM =
  'Extract CHECKABLE assertions from the LaTeX prose: statements of physical fact, definitions, or claimed ' +
  'results that a reference book could confirm or contradict (e.g. "surface tension scales inversely with...", ' +
  '"the Basset force opposes unsteady relative motion"). Skip equations, citations themselves, hedged opinions, ' +
  'and structural text. Use the line numbers given. Output ONLY a JSON array of at most 8 items: ' +
  '[{"line": number, "claim": string}]. The claim must be a self-contained sentence.';

export interface ExtractedClaim {
  line: number;
  claim: string;
}

function parseJsonArray(text: string): unknown[] {
  const stripped = text.replace(/```(?:json)?/gi, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const arr = JSON.parse(stripped.slice(start, end + 1));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function chat(deps: RagDeps, system: string, user: string): Promise<string> {
  let text = '';
  for await (const delta of deps.modelProvider.chatStream(
    { system, messages: [{ role: 'user', content: user }], model: deps.model },
    deps.signal,
  )) {
    text += delta.text;
  }
  return text;
}

export async function extractClaims(deps: RagDeps, file: string, content: string): Promise<ExtractedClaim[]> {
  const lines = content.split('\n');
  const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n').slice(0, 24000);
  const out = parseJsonArray(await chat(deps, EXTRACT_SYSTEM, `File ${file}:\n${numbered}\n\nReturn the JSON array now.`));
  const claims: ExtractedClaim[] = [];
  for (const item of out) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const line = typeof o.line === 'number' && o.line >= 1 && o.line <= lines.length ? Math.floor(o.line) : null;
    const claim = typeof o.claim === 'string' ? o.claim.trim() : '';
    if (line && claim.length > 12) claims.push({ line, claim });
    if (claims.length >= 8) break;
  }
  return claims;
}

// ── Judging (axes B2 + C) ─────────────────────────────────────────────────────

const JUDGE_SYSTEM =
  'You judge claims ONLY against the retrieved passages provided for each claim — never from memory. ' +
  'For each claim id, decide: "contradicts" (a passage conflicts with the claim), "supports" (a passage ' +
  'confirms it), or "not-addressed" (the passages do not cover it). When you answer contradicts or supports ' +
  'you MUST set "passageIndex" to the 0-based index of the decisive passage for that claim and "quote" a short ' +
  'verbatim excerpt from it. If the passages are silent, answer not-addressed — you may NOT use outside knowledge. ' +
  'Output ONLY a JSON array: [{"id": string, "verdict": "contradicts"|"supports"|"not-addressed", ' +
  '"passageIndex"?: number, "quote"?: string, "reason"?: string}].';

export interface JudgeItem {
  id: string;
  claim: string;
  passages: RetrievedPassage[];
}

export interface JudgeResult {
  verdict: 'contradicts' | 'supports' | 'not-addressed';
  passageIndex?: number;
  quote?: string;
  reason?: string;
}

export async function judgeClaims(deps: RagDeps, items: JudgeItem[]): Promise<Map<string, JudgeResult>> {
  const judged = new Map<string, JudgeResult>();
  if (items.length === 0) return judged;
  const blocks = items.map((it) => {
    const ps = it.passages
      .map((p, i) => `  [${i}] (${p.sourceTitle ?? p.literatureItemId}, p.${p.page || '?'}) ${p.text.slice(0, 600)}`)
      .join('\n');
    return `claim id=${it.id}\n  CLAIM: ${it.claim}\n  PASSAGES:\n${ps}`;
  });
  const out = parseJsonArray(await chat(deps, JUDGE_SYSTEM, `${blocks.join('\n\n')}\n\nReturn the JSON array now.`));
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const raw of out) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    const item = byId.get(id);
    if (!item) continue; // the model cannot invent claim ids
    const verdict = o.verdict === 'contradicts' || o.verdict === 'supports' || o.verdict === 'not-addressed' ? o.verdict : null;
    if (!verdict) continue;
    const idx = typeof o.passageIndex === 'number' ? Math.floor(o.passageIndex) : -1;
    const validIdx = idx >= 0 && idx < item.passages.length;
    // A contradiction/support WITHOUT a valid passage index degrades to not-addressed:
    // the model may not flag a discrepancy it cannot point to in the evidence.
    const effective: JudgeResult['verdict'] = verdict !== 'not-addressed' && !validIdx ? 'not-addressed' : verdict;
    judged.set(id, {
      verdict: effective,
      ...(validIdx ? { passageIndex: idx } : {}),
      ...(typeof o.quote === 'string' && o.quote.trim() ? { quote: o.quote.trim().slice(0, 300) } : {}),
      ...(typeof o.reason === 'string' && o.reason.trim() ? { reason: o.reason.trim().slice(0, 300) } : {}),
    });
  }
  return judged;
}

// ── Axis C: physics / "is this right" against the WHOLE library ──────────────

export async function physicsFindings(deps: RagDeps, texFiles: { path: string; content: string }[]): Promise<ReviewFinding[]> {
  const findings: ReviewFinding[] = [];
  const toJudge: Array<JudgeItem & { file: string; line: number; claim: string }> = [];

  for (const f of texFiles) {
    const claims = await extractClaims(deps, f.path, f.content).catch(() => []);
    for (const c of claims) {
      const passages = await retrievePassages(deps.prisma, deps.mathcheckUrl, deps.projectId, c.claim, { k: 4 }).catch(() => []);
      const id = `physics:${f.path}:${c.line}:${toJudge.length}`;
      if (passages.length === 0) {
        // NO RETRIEVAL → no claim of error. A low-key, honest note only.
        findings.push({
          id,
          axis: 'background',
          category: 'physics',
          severity: 'info',
          confidence: 'no-library-source',
          file: f.path,
          lineSpan: { fromLine: c.line, toLine: c.line },
          message: `No source in the library covers this claim — not checked (and not implied correct): “${c.claim.slice(0, 160)}”`,
        });
        continue;
      }
      toJudge.push({ id, claim: c.claim, passages, file: f.path, line: c.line });
    }
  }

  const judged = await judgeClaims(deps, toJudge).catch(() => new Map<string, JudgeResult>());
  for (const item of toJudge) {
    const r = judged.get(item.id);
    if (!r || r.verdict === 'not-addressed') {
      findings.push({
        id: item.id,
        axis: 'background',
        category: 'physics',
        severity: 'info',
        confidence: 'no-library-source',
        file: item.file,
        lineSpan: { fromLine: item.line, toLine: item.line },
        message: `The retrieved library passages do not address this claim — not checked: “${item.claim.slice(0, 160)}”`,
      });
      continue;
    }
    const evidence = r.passageIndex !== undefined ? [item.passages[r.passageIndex]!] : item.passages.slice(0, 1);
    findings.push(
      makeRagFinding(
        {
          id: item.id,
          axis: 'background',
          category: 'physics',
          severity: r.verdict === 'contradicts' ? 'warning' : 'info',
          file: item.file,
          lineSpan: { fromLine: item.line, toLine: item.line },
          message:
            r.verdict === 'contradicts'
              ? `Claim appears to CONTRADICT the library: “${item.claim.slice(0, 140)}”${r.reason ? ` — ${r.reason}` : ''}`
              : `Claim is supported by the library: “${item.claim.slice(0, 140)}”`,
          ...(r.quote ? { quotedSpan: r.quote } : {}),
        },
        r.verdict === 'contradicts' ? 'contradiction' : 'supported',
        evidence,
      ),
    );
  }
  return findings;
}

// ── Axis B2: citation-content against THE CITED item ─────────────────────────

const CITE_RE = /\\(?:cite|citep|citet|parencite|textcite)\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;

/** The sentence-ish claim around a cite (same line ± neighbours, LaTeX lightly stripped). */
function claimAround(lines: string[], lineIdx: number): string {
  const text = [lines[lineIdx - 1] ?? '', lines[lineIdx] ?? '', lines[lineIdx + 1] ?? ''].join(' ');
  return text
    .replace(/\\(?:cite|citep|citet|parencite|textcite)\s*(?:\[[^\]]*\]\s*)*\{[^}]*\}/g, '')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, ' ')
    .replace(/[{}$~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

export async function citationContentFindings(deps: RagDeps, texFiles: { path: string; content: string }[]): Promise<ReviewFinding[]> {
  const findings: ReviewFinding[] = [];
  const toJudge: Array<JudgeItem & { file: string; line: number; key: string; claim: string }> = [];
  let count = 0;

  for (const f of texFiles) {
    const lines = f.content.split('\n');
    for (let i = 0; i < lines.length && count < 12; i++) {
      CITE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CITE_RE.exec(lines[i]!)) !== null && count < 12) {
        const keys = (m[1] ?? '').split(',').map((k) => k.trim()).filter(Boolean);
        const claim = claimAround(lines, i);
        if (claim.length < 24) continue;
        for (const key of keys) {
          const id = `cite:${f.path}:${i + 1}:${key}`;
          const item = deps.libraryItems.get(key);
          if (!item) continue; // unlinked keys are b1/structural territory, not content checks
          count += 1;
          const passages = await retrievePassages(deps.prisma, deps.mathcheckUrl, deps.projectId, claim, {
            literatureItemId: item.itemId,
            k: 3,
          }).catch(() => []);
          if (passages.length === 0) {
            findings.push({
              id,
              axis: 'literature',
              category: 'citation-content',
              severity: 'info',
              confidence: 'attribution-unverified',
              file: f.path,
              lineSpan: { fromLine: i + 1, toLine: i + 1 },
              message: `Attribution unverified — no retrievable passage from [${key}] covers this claim (source text ${item.extractedText ? 'indexed but silent here' : 'not extracted/indexed'}).`,
              reference: key,
            });
            continue;
          }
          toJudge.push({ id, claim, passages, file: f.path, line: i + 1, key });
        }
      }
    }
  }

  const judged = await judgeClaims(deps, toJudge).catch(() => new Map<string, JudgeResult>());
  for (const item of toJudge) {
    const r = judged.get(item.id);
    if (!r || r.verdict === 'not-addressed') {
      findings.push({
        id: item.id,
        axis: 'literature',
        category: 'citation-content',
        severity: 'info',
        confidence: 'attribution-unverified',
        file: item.file,
        lineSpan: { fromLine: item.line, toLine: item.line },
        message: `The retrieved passages from [${item.key}] do not address this claim — attribution unverified.`,
        reference: item.key,
      });
      continue;
    }
    const evidence = r.passageIndex !== undefined ? [item.passages[r.passageIndex]!] : item.passages.slice(0, 1);
    findings.push(
      makeRagFinding(
        {
          id: item.id,
          axis: 'literature',
          category: 'citation-content',
          severity: r.verdict === 'contradicts' ? 'warning' : 'info',
          file: item.file,
          lineSpan: { fromLine: item.line, toLine: item.line },
          message:
            r.verdict === 'contradicts'
              ? `The cited source [${item.key}] appears to CONTRADICT this claim${r.reason ? ` — ${r.reason}` : ''}.`
              : `The cited source [${item.key}] supports this claim.`,
          reference: item.key,
          ...(r.quote ? { quotedSpan: r.quote } : {}),
        },
        r.verdict === 'contradicts' ? 'contradiction' : 'supported',
        evidence,
      ),
    );
  }
  return findings;
}
