/**
 * Shared domain types for LaTeX Studio.
 *
 * These types describe the contracts crossing the app/service boundaries:
 *   - apps/web   <-> apps/api  (projects, files, compilation, AI completion)
 *   - apps/api   <-> services/mathcheck (SymPy verification)
 *
 * The package is consumed as TypeScript source (see package.json `exports`),
 * so there is no build step to keep in sync during development.
 */

/** A literal used by every service's health endpoint. */
export const HEALTH_OK = 'ok' as const;

export interface HealthResponse {
  status: typeof HEALTH_OK;
  /** Name of the responding service, e.g. "api" or "mathcheck". */
  service: string;
  /** Optional semantic version of the service. */
  version?: string;
}

// ─── Projects & files ────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  /** Relative path of the entry file latexmk compiles, e.g. "main.tex". */
  rootFile: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
  /** Mathcheck macro table: `{ "\\Bo": "B_0", "\\pdiff": "..." }`. */
  macros?: Record<string, string>;
  /** Mathcheck default assumptions, e.g. "all symbols real, k > 0". */
  assumptions?: string;
  /** AI model for chat/edit (subscription-accepted id/alias). */
  model?: string;
  /** Project-specific AI instructions, injected into the chat system prompt. */
  aiInstructions?: string;
}

export interface TexFile {
  id: string;
  projectId: string;
  /** Project-relative POSIX path, e.g. "chapters/intro.tex". */
  path: string;
  content: string;
  /** "utf8" for text, "base64" for uploaded binary files (figures, fonts, PDFs). */
  encoding: string;
  /** ISO-8601 timestamp. */
  updatedAt: string;
}

/** Lightweight, label-tagged versioning snapshot of a project's files. */
export interface Snapshot {
  id: string;
  projectId: string;
  label: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
  files: TexFile[];
}

// ─── Compilation ─────────────────────────────────────────────────────────────

export type CompileStatus = 'success' | 'error';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Project-relative file the diagnostic points at, when known. */
  file?: string;
  line?: number;
  column?: number;
}

export interface CompileResult {
  status: CompileStatus;
  /** Path/URL to the produced PDF, when status is "success". */
  pdfPath?: string;
  /** Raw latexmk / engine log. */
  log: string;
  diagnostics: Diagnostic[];
  durationMs: number;
}

/** Outcome of a POST /projects/:id/compile request. */
export type CompileResultStatus = 'success' | 'error' | 'timeout' | 'superseded';

export interface CompileResponse {
  status: CompileResultStatus;
  /** API-relative URL of the produced PDF (incl. cache-busting query), if any. */
  pdfUrl?: string;
  /** API-relative URL of the .synctex.gz, if any. */
  synctexUrl?: string;
  diagnostics: Diagnostic[];
  durationMs: number;
  /** Tail of the raw log (for debugging in the UI). */
  log?: string;
}

// ─── SyncTeX ─────────────────────────────────────────────────────────────────

/** Forward search: source file:line → location(s) in the PDF. */
export interface SyncForwardRequest {
  projectId: string;
  /** Project-relative source path, e.g. "chapters/intro.tex". */
  file: string;
  line: number;
  column?: number;
}

/** A highlightable rectangle on a PDF page, in PDF points (top-left origin). */
export interface SyncForwardBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SyncForwardResult {
  boxes: SyncForwardBox[];
}

/** Inverse search: a point in the PDF → source file:line. */
export interface SyncInverseRequest {
  projectId: string;
  page: number;
  /** PDF points from the page's top-left. */
  x: number;
  y: number;
}

export interface SyncInverseResult {
  file: string;
  line: number;
  column: number;
}

// ─── AI completion ───────────────────────────────────────────────────────────

export interface CompletionRequest {
  projectId: string;
  /** File being edited, project-relative. */
  filePath: string;
  /** Text before the cursor. */
  prefix: string;
  /** Text after the cursor. */
  suffix?: string;
  /** Optional natural-language instruction to steer the completion. */
  instruction?: string;
}

// ─── Math verification (services/mathcheck) ──────────────────────────────────

export interface MathCheckRequest {
  /** A LaTeX or plain mathematical expression to verify. */
  expression: string;
  /** Optional expression the result is expected to equal. */
  expected?: string;
  /** Optional variable substitutions for numeric checks. */
  variables?: Record<string, number>;
}

export interface MathCheckResult {
  ok: boolean;
  /** SymPy-simplified form of the expression, when parseable. */
  simplified?: string;
  /** Whether `expression` is equivalent to `expected`, when provided. */
  equalsExpected?: boolean;
  /** Error message when verification failed. */
  error?: string;
}

// ─── Mathcheck: parse / equivalence / derivation ─────────────────────────────

/** Request to parse a single LaTeX expression. */
export interface MathParseRequest {
  latex: string;
  macros?: Record<string, string>;
}

export interface MathParseResult {
  ok: boolean;
  parser?: string;
  sympySrepr?: string;
  prettyPrinted?: string;
  error?: string;
}

/** A scalar value in a counterexample (real number, or a string for complex). */
export type MathValue = number | string;

export interface MathCounterexample {
  values: Record<string, MathValue>;
  lhsVal: MathValue;
  rhsVal: MathValue;
}

export interface EquivalenceRequest {
  lhs: string;
  rhs: string;
  assumptions?: string;
  macros?: Record<string, string>;
}

export interface EquivalenceResult {
  /** true / false established; "unknown" when nothing could establish it. */
  equivalent: boolean | 'unknown';
  method: string;
  counterexample?: MathCounterexample;
  error?: string;
}

export type DerivationVerdict = 'ok' | 'fail' | 'unknown' | 'unparseable';

export interface DerivationStep {
  index: number;
  latex: string;
  parser?: string | null;
  parsed?: string | null;
  error?: string | null;
}

export interface DerivationTransition {
  from: number;
  to: number;
  verdict: DerivationVerdict;
  method?: string;
  counterexample?: MathCounterexample;
  /** Simplified `step[from] - step[to]`, when computable. */
  difference?: string;
  error?: string;
}

export interface DerivationRequest {
  steps: string[];
  assumptions?: string;
  macros?: Record<string, string>;
}

export interface DerivationResult {
  steps: DerivationStep[];
  transitions: DerivationTransition[];
  /** Index of the `from` step of the first non-ok transition, or null. */
  firstFailingPair: number | null;
  error?: string;
}

// ─── Verification vs LLM-context channels (hard separation) ──────────────────
//
// Two disjoint channels, enforced by types:
//  · LLM-CONTEXT: prose, outline, macro table, assumptions, reference text.
//    Goes ONLY into the LLM prompt — never to mathcheck.
//  · VERIFICATION: strings sent to mathcheck. Only display-math extracted from
//    .tex math environments, explicitly selected inline maths, or LaTeX maths
//    the LLM proposed inside a parsed step field — and only after the
//    isPlausibleMathExpression guard accepts them.

/** LLM-CONTEXT channel: prompt material only. Structurally unpassable to the mathcheck client. */
export interface LlmContextChunk {
  kind: 'prose' | 'outline' | 'macro-table' | 'assumptions' | 'reference';
  text: string;
}

/** Where a verification candidate came from (all are maths-bearing by construction). */
export type VerificationSource = 'display-math' | 'inline-math-selected' | 'llm-step' | 'user-target';

declare const VERIFICATION: unique symbol;

/**
 * VERIFICATION channel: the ONLY type the mathcheck client accepts. The brand is
 * a non-exported unique symbol, so the sole way to obtain one is
 * makeVerificationCandidate — which runs the isPlausibleMathExpression guard.
 * An LlmContextChunk (e.g. reference text) is not structurally passable.
 */
export interface VerificationCandidate {
  readonly latex: string;
  readonly source: VerificationSource;
  readonly [VERIFICATION]: true;
}

export type MathGuardResult = { ok: true } | { ok: false; reason: string };

/** BibTeX field names whose `name = {…}` / `name = "…"` lines are never maths. */
const BIBTEX_FIELDS =
  'author|title|year|journal|publisher|editor|volume|number|pages|doi|booktitle|month|note|url|isbn|issn|address|edition|series|school|institution|organization|howpublished|chapter|abstract|keywords|file|eprint|archiveprefix|primaryclass|date-added|date-modified|read|rating|date|language|crossref|annote|key';

const BIBTEX_FIELD_RE = new RegExp(`^\\s*(?:${BIBTEX_FIELDS})\\s*=\\s*(?:\\{[\\s\\S]*\\}|"[\\s\\S]*")\\s*,?\\s*$`, 'i');

/** Any `ident = {…},` line (trailing comma + fully braced value) is BibTeX-shaped, whatever the field. */
const BIBTEX_SHAPE_RE = /^\s*[\w-]+\s*=\s*\{[^{}=]*\}\s*,\s*$/;

const BIBTEX_ENTRY_RE = /@\s*(?:article|book|inproceedings|incollection|techreport|phdthesis|mastersthesis|misc|unpublished|proceedings|inbook|booklet|manual|conference|online|electronic|patent|periodical|standard|string|comment|preamble)\s*[{(]/i;

/** A lone structural LaTeX command (cite/ref/label/sectioning/preamble) is not maths. */
const STRUCTURAL_LATEX_RE =
  /^\s*\\(?:usepackage|RequirePackage|documentclass|input|include|section\*?|subsection\*?|subsubsection\*?|chapter\*?|paragraph\*?|cite[a-zA-Z]*|parencite|textcite|ref|eqref|cref|Cref|pageref|label|caption|footnote|bibliography(?:style)?|addbibresource|includegraphics|item|maketitle|tableofcontents|begin|end)\b(?:\s*(?:\[[^\]]*\])?\s*\{[^{}]*\})*\s*,?\s*$/;

/**
 * Guard run before EVERY mathcheck call: rejects strings that look
 * non-mathematical (BibTeX fields/entries, prose, comments, empty/punctuation),
 * with the reason. SymPy stays the arbiter of correctness for everything that
 * passes; this only filters out what is plainly not a maths expression.
 */
export function isPlausibleMathExpression(s: string): MathGuardResult {
  const t = s.trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.startsWith('%')) return { ok: false, reason: 'latex-comment' };
  if (BIBTEX_ENTRY_RE.test(t)) return { ok: false, reason: 'bibtex-entry' };
  if (BIBTEX_FIELD_RE.test(t)) return { ok: false, reason: 'bibtex-field' };
  if (BIBTEX_SHAPE_RE.test(t)) return { ok: false, reason: 'bibtex-field-shaped' };
  if (STRUCTURAL_LATEX_RE.test(t)) return { ok: false, reason: 'structural-latex' };

  // Empty or punctuation-only once LaTeX commands and braces are stripped.
  const stripped = t.replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}]/g, ' ');
  if (!/[A-Za-z0-9]/.test(stripped)) return { ok: false, reason: 'no-content' };

  // Mostly natural-language prose: several real words and not a single maths
  // token anywhere. Digits alone do not count ("vol. 2, chap. 22" is prose);
  // an operator, relation, or LaTeX command does.
  const words = stripped.match(/[A-Za-z]{3,}/g) ?? [];
  const wordChars = words.reduce((n, w) => n + w.length, 0);
  const hasMathToken = /[=+\-*/^_<>|!]|\\[a-zA-Z]/.test(t);
  if (words.length >= 2 && wordChars >= 12 && !hasMathToken) return { ok: false, reason: 'prose' };

  return { ok: true };
}

/**
 * The ONLY constructor of VerificationCandidate. Returns the rejection reason
 * instead when the guard refuses — callers must drop the string (never send it
 * to mathcheck, never surface it as an insertable step).
 */
export function makeVerificationCandidate(
  latex: string,
  source: VerificationSource,
): { candidate: VerificationCandidate; rejected?: undefined } | { candidate?: undefined; rejected: string } {
  const verdict = isPlausibleMathExpression(latex);
  if (!verdict.ok) return { rejected: verdict.reason };
  return { candidate: { latex: latex.trim(), source } as VerificationCandidate };
}

// ─── Model provider (AI features) ────────────────────────────────────────────
//
// All AI features depend ONLY on this interface (see docs/decisions.md ADR-004).
// The browser never talks to the SDK — every call goes through apps/api.

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** System prompt: app description + project AI instructions + budgeted context. */
  system?: string;
  /** The conversation transcript (our stored history is the source of truth). */
  messages: ChatMessageInput[];
  model?: string;
}

/** One streamed chunk of assistant text. */
export interface ChatDelta {
  text: string;
}

export interface EditRequest {
  instruction: string;
  /** The exact region to rewrite. */
  selection: string;
  /** Surrounding text (read-only reference; not rewritten). */
  context?: string;
  model?: string;
}

/** The provider contract every AI route depends on. */
export interface ModelProvider {
  chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta>;
  complete(req: CompletionRequest, signal: AbortSignal): Promise<string>;
  editRegion(req: EditRequest, signal?: AbortSignal): Promise<string>;
}

/** Classified failure modes surfaced to the UI. */
export type AiErrorKind = 'auth' | 'credit_exhausted' | 'unavailable' | 'invalid' | 'other';

export interface ModelHealth {
  provider: string;
  model: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Whether AI features are currently usable, for the banner + gating. */
export interface AiStatus {
  available: boolean;
  reason?: AiErrorKind;
  message?: string;
}

export interface AiModelsResponse {
  /** Default model id/alias. */
  default: string;
  /** Allowed model identifiers (live from the SDK when available, else a fallback set). */
  models: string[];
  /** True when the list came from the live SDK rather than the static fallback. */
  live: boolean;
}

// ─── Chat persistence (we own the transcript) ────────────────────────────────

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** A per-call AI latency/outcome record (subscription overhead visibility). */
export interface AiCallLogEntry {
  id: string;
  route: string;
  model: string;
  latencyMs: number;
  ok: boolean;
  errorKind?: string | null;
  createdAt: string;
}

// ─── AI request payloads (web → api) ─────────────────────────────────────────

/** Per-query editor context for chat (assembled into the system prompt server-side). */
export interface ChatContext {
  activeFile?: string;
  selection?: string;
  cursorLine?: number;
  pinnedPaths?: string[];
}

export interface ChatSendRequest {
  threadId?: string;
  message: string;
  context?: ChatContext;
}

export interface InlineEditRequest {
  filePath: string;
  selection: string;
  /** ~80 surrounding lines for context. */
  context: string;
  instruction: string;
}

export interface FixFromLogRequest {
  filePath: string;
  /** The offending region of source to rewrite. */
  region: string;
  diagnostic: { message: string; line?: number };
  /** Excerpt of the compile log. */
  logExcerpt: string;
}

/** Response from /edit and /fix: a parsed replacement for the region. */
export interface ReplacementResponse {
  replacement: string;
}

// ─── Inline completions (ghost text) ─────────────────────────────────────────

export type CompletionMode = 'prose' | 'inline-math' | 'display-align' | 'preamble';

export interface CompletionInlineRequest {
  /** ~2000 prefix tokens up to the cursor. */
  prefix: string;
  /** ~500 suffix tokens after the cursor. */
  suffix?: string;
  mode: CompletionMode;
  /** Override the completion model (else the server default). */
  model?: string;
  /** Per-route provider override (else COMPLETIONS_PROVIDER). */
  provider?: 'agent-sdk' | 'api';
  /** Force a fresh, non-warm call (baseline benchmarking). */
  baseline?: boolean;
  /** Cached document context card (document-aware prediction) — always cheap to include. */
  contextCard?: string;
  /** Where the cursor is (e.g. "mid-derivation", "after \\begin{proof}", "in the abstract"). */
  position?: string;
}

// ─── Document-aware prediction (DocumentModel + multi-granularity predict-next) ─

export interface DocumentModelResponse {
  /** Compact, budgeted context card included in every prediction prompt. */
  card: string;
  /** Macro + glossary symbols, for the client notation post-filter. */
  notationSymbols: string[];
  outline: { title: string; level: number }[];
  builtAt: string;
}

export type PredictGranularity = 'auto' | 'prose' | 'maths' | 'structural';

export interface PredictNextRequest {
  fileId: string;
  cursorLine: number;
  granularity: PredictGranularity;
  card?: string;
  position?: string;
  model?: string;
  overrides?: FileOverrides;
}

export interface PredictNextResponse {
  prediction: string;
  kind: 'prose' | 'maths' | 'structural';
  /** For maths predictions: the step(s) split out for SymPy chain verification. */
  steps?: string[];
}

export type CompletionVariant = 'warm' | 'cold' | 'baseline';

export interface CompletionResult {
  completion: string;
  latencyMs: number;
  variant: CompletionVariant;
  provider: string;
  model: string;
}

// ─── /stats aggregates ───────────────────────────────────────────────────────

export interface LatencyStats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

export interface AiStatsBucket {
  provider: string;
  model: string;
  variant: string;
  okRate: number;
  stats: LatencyStats;
}

export interface DailyCount {
  date: string;
  count: number;
}

export interface AiStatsResponse {
  /** Per (provider, model, variant) latency percentiles for /complete. */
  buckets: AiStatsBucket[];
  /** Completions per day (all variants). */
  daily: DailyCount[];
  totalCompletions: number;
}

// ─── Phase 7: thesis authoring tools ─────────────────────────────────────────

export type AuditScope = 'file' | 'project';

/** Per-file content overrides for unsaved buffers (path → live content). */
export type FileOverrides = Record<string, string>;

// Feature 1 — chapter-wide maths audit
export type MathAuditVerdict = 'failing' | 'unknown' | 'passed';

export interface AuditMathsRequest {
  scope: AuditScope;
  fileId?: string;
  overrides?: FileOverrides;
}

export interface MathAuditBlock {
  id: string;
  file: string;
  /** 1-based inclusive line span of the offending step/equation. */
  lineStart: number;
  lineEnd: number;
  verdict: MathAuditVerdict;
  method?: string;
  counterexample?: MathCounterexample;
  /** The equation / step LaTeX this row refers to. */
  latex: string;
  message?: string;
  cached?: boolean;
}

export interface MathAuditReport {
  blocks: MathAuditBlock[];
  totals: { failing: number; unknown: number; passed: number; checked: number; cached: number };
  /** Per-file unverified (failing + unknown) counts for gutter badges. */
  byFile: Record<string, number>;
}

export interface ExplainStepRequest {
  latex: string;
  previousLatex?: string;
  method?: string;
  counterexample?: MathCounterexample;
  /** The block's file + line, so the server can include surrounding context. */
  file?: string;
  line?: number;
  /** Live editor buffers, so context reflects unsaved edits. */
  overrides?: FileOverrides;
}

// Feature 2 — LaTeX-aware prose checking
export type ProseSeverity = 'error' | 'warning' | 'info';

export interface ProseRuleToggles {
  spelling: boolean;
  enGbConsistency: boolean;
  hyphenation: boolean;
  doubleSpace: boolean;
  quotes: boolean;
  languageTool: boolean;
}

export interface ProseCheckRequest {
  scope: AuditScope;
  fileId?: string;
  rules?: Partial<ProseRuleToggles>;
  overrides?: FileOverrides;
}

export interface ProseDiagnostic {
  file: string;
  line: number;
  column: number;
  endColumn?: number;
  severity: ProseSeverity;
  /** 'spelling' | 'en-gb' | 'double-space' | 'quotes' | 'hyphenation' | 'languagetool' */
  rule: string;
  message: string;
  suggestions: string[];
  /** The flagged token, for "add to dictionary" / safe apply. */
  word?: string;
}

export interface ProseCheckReport {
  diagnostics: ProseDiagnostic[];
  /** Which engines ran, and whether everything stayed local (privacy assertion). */
  engine: { spelling: string; grammar: string | null; local: boolean };
  totals: { error: number; warning: number; info: number };
}

// Feature 3 — outline + cross-reference health
export type OutlineKind = 'part' | 'chapter' | 'section' | 'subsection' | 'subsubsection';

export interface OutlineLabel {
  name: string;
  line: number;
}

export interface OutlineNode {
  id: string;
  level: number;
  kind: OutlineKind;
  title: string;
  file: string;
  line: number;
  labels: OutlineLabel[];
  children: OutlineNode[];
}

export interface OutlineResponse {
  roots: OutlineNode[];
}

export type XrefRule =
  | 'undefined-ref'
  | 'duplicate-label'
  | 'missing-cite'
  | 'unused-label'
  | 'unlabelled-equation';

export interface XrefDiagnostic {
  file: string;
  line: number;
  severity: 'error' | 'info';
  rule: XrefRule;
  message: string;
  key?: string;
  /** All definition locations (for duplicate labels). */
  locations?: { file: string; line: number }[];
}

export interface XrefReport {
  diagnostics: XrefDiagnostic[];
  totals: { error: number; info: number };
}

export interface ThesisRequest {
  overrides?: FileOverrides;
}

// Combined pre-submit dashboard
export interface PreSubmitSummary {
  projectName: string;
  generatedAt: string;
  compile: { status: string; errors: number; warnings: number; durationMs: number | null };
  maths: { failing: number; unknown: number; passed: number };
  prose: { error: number; warning: number; info: number };
  xref: { error: number; info: number };
  ready: boolean;
}

// ─── Co-derivation engine (LLM proposes · SymPy verifies — SymPy is the arbiter) ─

export type CoderiveIntent = 'fill-gap' | 'next-step' | 'reach-goal' | 'justify' | 'verify-document';

export interface CoderiveAnchorRange {
  /** Primary line: next-step cursor / reach-goal current / fill-gap line A / justify "from". */
  fromLine: number;
  /** Secondary line: fill-gap line C / justify "to". */
  toLine?: number;
}

export interface CoderiveRequest {
  /** Required for the generative intents; omitted for "verify-document" (whole document). */
  fileId?: string;
  intent: CoderiveIntent;
  /** Required for the generative intents; omitted for "verify-document". */
  anchorRange?: CoderiveAnchorRange;
  /** Target expression for "reach-goal". */
  target?: string;
  /** Live editor buffers so context + anchors reflect unsaved edits. */
  overrides?: FileOverrides;
}

/** A raw LLM proposal — BEFORE SymPy renders any verdict. The LLM never decides correctness. */
export interface CandidateProposal {
  latex: string;
  claimedEqualTo: string;
  technique: string;
  groundedIn: string[];
  rationale: string;
}

/** verified = SymPy proved algebraic equivalence; unverified = SymPy refuted; unknown = SymPy could not decide. */
export type CoderiveStatus = 'verified' | 'unverified' | 'unknown';

export interface CoderiveCandidate {
  latex: string;
  status: CoderiveStatus;
  /** The SymPy method that produced the verdict (e.g. "symbolic", "sample", "parse-error"). */
  method: string;
  counterexample?: MathCounterexample;
  technique: string;
  groundedIn: string[];
  rationale: string;
  claimedEqualTo: string;
  retriesUsed: number;
  /** True when groundedIn cites a key whose source text was NOT provided to the LLM. */
  attributionUnverified: boolean;
}

export type ReferenceProvenance = 'full-text' | 'metadata-only' | 'not-found';

export interface ReferenceContext {
  key: string;
  author?: string;
  title?: string;
  year?: string;
  abstract?: string;
  /** Best-matching passages from the cited work's source, when it is in the project. */
  passages?: string[];
  sourceFile?: string;
  provenance: ReferenceProvenance;
  /** Resolved via a linked Literature-library article (provenance "full-text (library)"). */
  library?: boolean;
}

/** Full context handed to the LLM (server-internal; summarised for the UI). */
export interface ContextBundle {
  macros: Record<string, string>;
  assumptions: string;
  documentWindow: string;
  references: ReferenceContext[];
  intent: CoderiveIntent;
  anchors: { from?: string; to?: string; goal?: string };
}

/** What the UI shows in the collapsible "context used" disclosure. */
export interface ContextBundleSummary {
  macroCount: number;
  assumptions: string;
  documentWindowChars: number;
  windowPreview: string;
  references: Array<{ key: string; provenance: ReferenceProvenance; sourceFile?: string; passageCount: number; library?: boolean }>;
}

// ─── Literature library (separate tree, wired into citation resolution) ──────

export interface LibraryFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  createdAt: string;
}

export interface LiteratureItem {
  id: string;
  projectId: string;
  folderId: string | null;
  title: string;
  authors: string;
  year: string;
  citeKey: string | null;
  fileName: string;
  fileSizeBytes: number;
  doi: string | null;
  abstract: string | null;
  /** Whether extractedText is cached (i.e. the article's full text is available). */
  hasText: boolean;
  pageCount?: number;
  extractedAt: string | null;
  addedAt: string;
}

export interface LibraryTreeResponse {
  folders: LibraryFolder[];
  items: LiteratureItem[];
  trashCount: number;
}

export interface TrashItem {
  id: string;
  kind: 'file' | 'folder' | 'literature';
  label: string;
  deletedAt: string;
}

/** Per-cite-key linkage indicator for the bibliography view + editor affordance. */
export interface CiteLink {
  citeKey: string;
  linked: boolean;
  /** linked AND extracted text available. */
  hasText: boolean;
  itemId?: string;
  title?: string;
}

export interface CoderiveRound {
  round: number;
  proposalCount: number;
  /** Proposals rejected by the maths guard this round (never sent to SymPy, never insertable). */
  skippedCount?: number;
  verdicts: Array<{ latex: string; status: CoderiveStatus; method: string; refutedReason?: string }>;
}

/** A proposal the maths guard rejected — never sent to mathcheck, never insertable. */
export interface CoderiveSkipped {
  latex: string;
  /** Internal guard reason ("bibtex-field", "prose", …). */
  reason: string;
}

export interface CoderiveResponse {
  intent: CoderiveIntent;
  candidates: CoderiveCandidate[];
  /** "Not a maths expression — skipped": shown for transparency, with no insert affordance. */
  skipped: CoderiveSkipped[];
  context: ContextBundleSummary;
  rounds: CoderiveRound[];
  anchors: { from?: string; to?: string; goal?: string };
  /** Present only for the "verify-document" intent (whole-document SymPy sweep). */
  documentVerification?: DocumentVerification;
}

/**
 * AI commentary on ONE audited equation. Context only — explicitly NOT a verdict.
 * SymPy's verdict on the same equation (in the report) is the authoritative call;
 * this never changes it.
 */
export interface DocAuditComment {
  /** Matches a MathAuditBlock.id in the report. */
  id: string;
  comment: string;
}

/**
 * Whole-document algebra check for co-derive's "verify-document" mode. The report
 * is the machine-checked truth (SymPy over every display equation, the same
 * guarded engine the Maths Audit uses — bibliography is never scanned). The AI
 * supplies context for the equations SymPy could not pass; it is the arbiter of
 * nothing.
 */
export interface DocumentVerification {
  report: MathAuditReport;
  /** AI context for non-passing equations (may be empty when the model is unavailable). */
  comments: DocAuditComment[];
  commentaryProvided: boolean;
  /** How many equations were sent for AI commentary (bounded). */
  commentedCount: number;
}

// ─── Document Review (compose the engines → annotated review PDF) ─────────────

export type ReviewAxis = 'maths' | 'literature' | 'background' | 'prose';

/**
 * Only `verified`/`refuted`/`verified-typo` are machine-established. The
 * `llm-*` confidences are model judgements that may be wrong in either direction.
 */
export type ReviewConfidence =
  | 'verified'
  | 'refuted'
  | 'unknown'
  | 'llm-judgement'
  | 'llm-judgement-low'
  | 'verified-typo'
  | 'llm-suggestion';

export type ReviewSeverity = 'error' | 'warning' | 'info';

export interface ReviewFinding {
  id: string;
  axis: ReviewAxis;
  category: string;
  severity: ReviewSeverity;
  confidence: ReviewConfidence;
  file: string;
  lineSpan: { fromLine: number; toLine: number };
  message: string;
  suggestion?: string;
  counterexample?: MathCounterexample;
  /** Cite key the literature finding was checked against. */
  reference?: string;
  /** The reference span quoted/checked (literature axis). */
  quotedSpan?: string;
}

export interface ReviewRequest {
  scope: AuditScope;
  fileId?: string;
  /** Skip the LLM axes (2/3/4-prose) — deterministic maths + spelling only. */
  deterministicOnly?: boolean;
  overrides?: FileOverrides;
}

export interface ReviewTotals {
  byAxis: Record<ReviewAxis, number>;
  bySeverity: Record<ReviewSeverity, number>;
  byConfidence: Partial<Record<ReviewConfidence, number>>;
  /** Machine-verified algebra errors (the only "certain" red count). */
  refutedMaths: number;
}

export interface ReviewResponse {
  findings: ReviewFinding[];
  totals: ReviewTotals;
  /** Provenance of each cited reference the review resolved (for the "context used" disclosure). */
  references: Array<{ key: string; provenance: ReferenceProvenance; sourceFile?: string; passageCount: number; library?: boolean }>;
  /** URL of the annotated review PDF, when one was produced. */
  reviewPdfUrl?: string;
  /** True when findings were mapped onto the PDF and an annotated copy was written. */
  annotated: boolean;
  generatedAt: string;
}

/** Colour + human-readable confidence label, shared by the PDF annotator and the UI. */
export interface ReviewStyle {
  colour: string; // legend name
  hex: string;
  rgb: [number, number, number]; // 0–1, for PyMuPDF
  label: string; // confidence in words
  machineVerified: boolean;
}

// Colour scheme (machine-certain categories are green + red; LLM judgements are
// yellow; grey is an honest "couldn't decide"):
//  · wrong equation (SymPy-refuted algebra) → light green
//  · wrong statement (literature/background/prose LLM) → light yellow
//  · wrong grammar/spelling (deterministic en-GB) → red (drawn as an underline)
export function reviewStyle(axis: ReviewAxis, confidence: ReviewConfidence): ReviewStyle {
  if (axis === 'maths' && confidence === 'refuted')
    return { colour: 'light green', hex: '#86efac', rgb: [0.53, 0.94, 0.67], label: 'SymPy-verified algebra error', machineVerified: true };
  if (axis === 'maths')
    return { colour: 'grey', hex: '#9ca3af', rgb: [0.61, 0.64, 0.69], label: 'SymPy could not decide (unknown) — not an error and not a pass', machineVerified: false };
  if (confidence === 'verified-typo')
    return { colour: 'red', hex: '#ef4444', rgb: [0.94, 0.27, 0.27], label: 'Deterministic spell/grammar (en-GB)', machineVerified: true };
  if (axis === 'literature')
    return { colour: 'light yellow', hex: '#fde68a', rgb: [0.99, 0.9, 0.54], label: 'LLM judgement — verify against the cited source', machineVerified: false };
  if (axis === 'background')
    return { colour: 'light yellow', hex: '#fde68a', rgb: [0.99, 0.9, 0.54], label: 'LLM judgement, low confidence — verify against a real source', machineVerified: false };
  return { colour: 'light yellow', hex: '#fde68a', rgb: [0.99, 0.9, 0.54], label: 'LLM prose suggestion — may be wrong', machineVerified: false };
}
