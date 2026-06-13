import type {
  AiCallLogEntry,
  AiErrorKind,
  AiModelsResponse,
  AiStatsBucket,
  AiStatsResponse,
  AiStatus,
  AuditScope,
  ChatMessage,
  ChatThread,
  CompileResultStatus,
  CompletionInlineRequest,
  CompletionMode,
  CandidateProposal,
  CoderiveAnchorRange,
  CoderiveCandidate,
  CoderiveIntent,
  CoderiveRequest,
  CoderiveResponse,
  CoderiveRound,
  CoderiveSkipped,
  CoderiveStatus,
  DocAuditComment,
  DocumentVerification,
  CompletionResult,
  CompletionVariant,
  ContextBundleSummary,
  DailyCount,
  CiteLink,
  LibraryFolder,
  LibraryTreeResponse,
  LiteratureItem,
  ReferenceProvenance,
  ReviewAxis,
  ReviewConfidence,
  ReviewFinding,
  ReviewRequest,
  ReviewResponse,
  ReviewSeverity,
  ReviewStyle,
  ReviewTotals,
  TrashItem,
  DerivationResult,
  DerivationTransition,
  DerivationVerdict,
  Diagnostic,
  DiagnosticQuickFix,
  DiagnosticSeverity,
  DocumentModelResponse,
  PredictGranularity,
  PredictNextResponse,
  EquivalenceResult,
  FileOverrides,
  LatencyStats,
  MathAuditBlock,
  MathAuditReport,
  MathAuditVerdict,
  MathCounterexample,
  MathParseResult,
  ModelHealth,
  OutlineKind,
  OutlineNode,
  OutlineResponse,
  PreSubmitSummary,
  Project,
  ProseCheckReport,
  ProseDiagnostic,
  ProseRuleToggles,
  ProseSeverity,
  SyncForwardBox,
  TexFile,
  XrefDiagnostic,
  XrefReport,
  XrefRule,
} from '@latex-studio/shared';

export type {
  AiCallLogEntry,
  AiErrorKind,
  AiModelsResponse,
  AiStatsBucket,
  AiStatsResponse,
  AiStatus,
  AuditScope,
  ChatMessage,
  ChatThread,
  CompileResultStatus,
  CompletionInlineRequest,
  CompletionMode,
  CandidateProposal,
  CoderiveAnchorRange,
  CoderiveCandidate,
  CoderiveIntent,
  CoderiveRequest,
  CoderiveResponse,
  CoderiveRound,
  CoderiveSkipped,
  CoderiveStatus,
  DocAuditComment,
  DocumentVerification,
  CompletionResult,
  CompletionVariant,
  ContextBundleSummary,
  DailyCount,
  CiteLink,
  LibraryFolder,
  LibraryTreeResponse,
  LiteratureItem,
  ReferenceProvenance,
  ReviewAxis,
  ReviewConfidence,
  ReviewFinding,
  ReviewRequest,
  ReviewResponse,
  ReviewSeverity,
  ReviewStyle,
  ReviewTotals,
  TrashItem,
  DerivationResult,
  DerivationTransition,
  DerivationVerdict,
  Diagnostic,
  DiagnosticQuickFix,
  DiagnosticSeverity,
  DocumentModelResponse,
  PredictGranularity,
  PredictNextResponse,
  EquivalenceResult,
  FileOverrides,
  LatencyStats,
  MathAuditBlock,
  MathAuditReport,
  MathAuditVerdict,
  MathCounterexample,
  MathParseResult,
  ModelHealth,
  OutlineKind,
  OutlineNode,
  OutlineResponse,
  PreSubmitSummary,
  Project,
  ProseCheckReport,
  ProseDiagnostic,
  ProseRuleToggles,
  ProseSeverity,
  SyncForwardBox,
  TexFile,
  XrefDiagnostic,
  XrefReport,
  XrefRule,
};

/** A gutter marker for one source line that was math-checked. */
export interface MathLineMarker {
  verdict: DerivationVerdict;
  title: string;
}

/** A SyncTeX forward-search highlight to show in the PDF (with a refresh nonce). */
export type ForwardHighlight = SyncForwardBox & { nonce: number };

/** A queued request to reveal a source location in the editor. */
export interface PendingReveal {
  fileId: string;
  line: number;
  column?: number;
  nonce: number;
}

/** File metadata as returned by `GET /projects/:id/files` (no content). */
export interface FileMeta {
  id: string;
  projectId: string;
  path: string;
  /** "utf8" for text, "base64" for uploaded binary files (figures, fonts, PDFs). */
  encoding?: string;
  updatedAt: string;
}

export interface SnapshotMeta {
  id: string;
  projectId: string;
  label: string;
  createdAt: string;
}

export type SaveStatus = 'saved' | 'saving' | 'dirty' | 'error';

export type Theme = 'light' | 'dark';

/** A persisted cursor/selection (character offsets into the doc). */
export interface CursorState {
  anchor: number;
  head: number;
}

/** Per-project layout persisted to localStorage. */
export interface ProjectLayout {
  openFileIds: string[];
  activeFileId: string | null;
  cursors: Record<string, CursorState>;
}
