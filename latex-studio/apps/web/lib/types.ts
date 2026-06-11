import type {
  AiCallLogEntry,
  AiErrorKind,
  AiModelsResponse,
  AiStatsBucket,
  AiStatsResponse,
  AiStatus,
  ChatMessage,
  ChatThread,
  CompileResultStatus,
  CompletionInlineRequest,
  CompletionMode,
  CompletionResult,
  CompletionVariant,
  DailyCount,
  DerivationResult,
  DerivationTransition,
  DerivationVerdict,
  Diagnostic,
  EquivalenceResult,
  LatencyStats,
  MathCounterexample,
  MathParseResult,
  ModelHealth,
  Project,
  SyncForwardBox,
  TexFile,
} from '@latex-studio/shared';

export type {
  AiCallLogEntry,
  AiErrorKind,
  AiModelsResponse,
  AiStatsBucket,
  AiStatsResponse,
  AiStatus,
  ChatMessage,
  ChatThread,
  CompileResultStatus,
  CompletionInlineRequest,
  CompletionMode,
  CompletionResult,
  CompletionVariant,
  DailyCount,
  DerivationResult,
  DerivationTransition,
  DerivationVerdict,
  Diagnostic,
  EquivalenceResult,
  LatencyStats,
  MathCounterexample,
  MathParseResult,
  ModelHealth,
  Project,
  SyncForwardBox,
  TexFile,
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
