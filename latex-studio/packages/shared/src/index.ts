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
