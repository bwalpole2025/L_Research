import type {
  AiErrorKind,
  ConnectorConnectResult,
  ConnectorStatus,
  UsageStatRow,
  UsageScope,
  AiModelsResponse,
  AiStatsResponse,
  AiStatus,
  AuditScope,
  ChatContext,
  CiteLink,
  CoderiveRequest,
  CoderiveResponse,
  CoderiveRound,
  DocumentModelResponse,
  LibraryFolder,
  LibraryTreeResponse,
  LiteratureItem,
  PredictGranularity,
  PredictNextResponse,
  ReviewResponse,
  TrashItem,
  ChatMessage,
  ChatThread,
  CompileResponse,
  CompletionInlineRequest,
  CompletionResult,
  DerivationRequest,
  DerivationResult,
  EquivalenceRequest,
  EquivalenceResult,
  FileOverrides,
  FixFromLogRequest,
  InlineEditRequest,
  MathAuditReport,
  MathCounterexample,
  MathParseRequest,
  MathParseResult,
  OutlineResponse,
  PreSubmitSummary,
  Project,
  ProjectFolder,
  ProjectFoldersResponse,
  PyFigureLink,
  RunDone,
  RunStarted,
  ProseCheckReport,
  ProseRuleToggles,
  ReplacementResponse,
  SyncForwardRequest,
  SyncForwardResult,
  SyncInverseRequest,
  SyncInverseResult,
  TexFile,
  XrefReport,
} from '@latex-studio/shared';
import type { FileMeta, SnapshotMeta } from './types';

/**
 * Browser-side API client. Every call hits the same-origin `/api/*` proxy
 * (app/api/[...path]/route.ts), which injects the bearer token server-side — the
 * browser never holds the secret.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** An AI request failure carrying the classified kind (for the banner/gating). */
export class AiError extends Error {
  constructor(
    public status: number,
    public kind: AiErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);

  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Like `request`, but failures throw an `AiError` carrying the classified kind. */
async function aiRequest<T>(method: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let kind: AiErrorKind = 'other';
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; kind?: AiErrorKind };
      if (data.kind) kind = data.kind;
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    throw new AiError(res.status, kind, message);
  }
  return (await res.json()) as T;
}

export const api = {
  listProjects: () => request<Project[]>('GET', '/projects'),
  createProject: (name: string, folderId?: string | null) =>
    request<Project>('POST', '/projects', { name, ...(folderId !== undefined ? { folderId } : {}) }),
  getProject: (id: string) => request<Project>('GET', `/projects/${id}`),
  updateProject: (
    id: string,
    patch: {
      name?: string;
      rootFile?: string;
      macros?: Record<string, string>;
      assumptions?: string;
      model?: string;
      aiInstructions?: string;
      folderId?: string | null;
      pythonRunTarget?: string;
      networkEnabled?: boolean;
    },
  ) => request<Project>('PATCH', `/projects/${id}`, patch),
  /** Move a project into a Home folder (null = root). Purely organisational. */
  moveProject: (id: string, folderId: string | null) => request<Project>('PATCH', `/projects/${id}`, { folderId }),

  // Python "Run" (sandboxed execution; streaming lives in streamRun below).
  stopRun: (projectId: string) => request<{ stopped: boolean }>('POST', `/projects/${projectId}/run/stop`, {}),
  getPyFigures: (projectId: string) => request<{ links: PyFigureLink[] }>('GET', `/projects/${projectId}/pyfigures`),
  /** Same-origin proxied URL for a run artefact (server returns the inner path). */
  runArtifactUrl: (serverUrl: string) => `/api${serverUrl}`,
  /** Copy a run artefact (figure or scratch image) into the project's files (figures/). */
  importRunArtifact: (projectId: string, path: string) => request<FileMeta>('POST', `/projects/${projectId}/run-artifact/import`, { path }),

  // App-level project folders (Home explorer).
  listProjectFolders: () => request<ProjectFoldersResponse>('GET', '/project-folders'),
  createProjectFolder: (name: string, parentId?: string | null) =>
    request<ProjectFolder>('POST', '/project-folders', { name, parentId: parentId ?? null }),
  updateProjectFolder: (id: string, body: { name?: string; parentId?: string | null }) =>
    request<ProjectFolder>('PATCH', `/project-folders/${id}`, body),
  deleteProjectFolder: (id: string) => request<{ ok: boolean; trashedProjects: number }>('DELETE', `/project-folders/${id}`),
  listProjectTrash: () => request<{ items: TrashItem[] }>('GET', '/project-trash'),
  restoreProjectTrash: (trashId: string) => request<{ ok: boolean }>('POST', `/project-trash/${trashId}/restore`, {}),
  emptyProjectTrash: () => request<{ removed: number }>('DELETE', '/project-trash'),

  listFiles: (projectId: string) => request<FileMeta[]>('GET', `/projects/${projectId}/files`),
  createFile: (projectId: string, path: string, content?: string, encoding?: 'utf8' | 'base64') =>
    request<TexFile>('POST', `/projects/${projectId}/files`, { path, content, ...(encoding ? { encoding } : {}) }),
  getFile: (fileId: string) => request<TexFile>('GET', `/files/${fileId}`),
  updateFile: (fileId: string, patch: { content?: string; path?: string }) =>
    request<TexFile>('PATCH', `/files/${fileId}`, patch),
  deleteFile: (fileId: string) => request<void>('DELETE', `/files/${fileId}`),

  listSnapshots: (projectId: string) =>
    request<SnapshotMeta[]>('GET', `/projects/${projectId}/snapshots`),
  createSnapshot: (projectId: string, label: string) =>
    request<SnapshotMeta>('POST', `/projects/${projectId}/snapshots`, { label }),
  restoreSnapshot: (projectId: string, snapshotId: string) =>
    request<FileMeta[]>('POST', `/projects/${projectId}/snapshots/${snapshotId}/restore`),

  getCompileStatus: (projectId: string) =>
    request<{ status: 'success' | 'error' | 'timeout' | null; at?: string }>('GET', `/projects/${projectId}/compile-status`),
  compile: (projectId: string) =>
    request<CompileResponse>('POST', `/projects/${projectId}/compile`),
  syncForward: (req: SyncForwardRequest) =>
    request<SyncForwardResult>('POST', '/synctex/forward', req),
  syncInverse: (req: SyncInverseRequest) =>
    request<SyncInverseResult>('POST', '/synctex/inverse', req),

  mathParse: (req: MathParseRequest) => request<MathParseResult>('POST', '/mathcheck/parse', req),
  checkEquivalent: (req: EquivalenceRequest) =>
    request<EquivalenceResult>('POST', '/mathcheck/equivalent', req),
  checkDerivation: (req: DerivationRequest) =>
    request<DerivationResult>('POST', '/mathcheck/check-derivation', req),

  // AI (Claude Agent SDK over the subscription — all server-side).
  getAiStatus: () => request<AiStatus>('GET', '/ai/status'),
  getAiModels: () => request<AiModelsResponse>('GET', '/ai/models'),
  listChatThreads: (projectId: string) =>
    request<ChatThread[]>('GET', `/projects/${projectId}/chat/threads`),
  createChatThread: (projectId: string, title?: string) =>
    request<ChatThread>('POST', `/projects/${projectId}/chat/threads`, title ? { title } : {}),
  getThreadMessages: (threadId: string) =>
    request<ChatMessage[]>('GET', `/chat/threads/${threadId}/messages`),
  deleteChatThread: (threadId: string) => request<void>('DELETE', `/chat/threads/${threadId}`),
  aiEdit: (projectId: string, req: InlineEditRequest) =>
    aiRequest<ReplacementResponse>('POST', `/projects/${projectId}/edit`, req),
  aiFix: (projectId: string, req: FixFromLogRequest) =>
    aiRequest<ReplacementResponse>('POST', `/projects/${projectId}/fix`, req),
  getAiStats: () => request<AiStatsResponse>('GET', '/ai/stats'),

  // Phase 7 — thesis tools.
  auditMaths: (projectId: string, body: { scope: AuditScope; fileId?: string; overrides?: FileOverrides }) =>
    request<MathAuditReport>('POST', `/projects/${projectId}/audit-maths`, body),
  getOutline: (projectId: string, overrides?: FileOverrides) =>
    request<OutlineResponse>('POST', `/projects/${projectId}/outline`, { overrides }),
  getXref: (projectId: string, overrides?: FileOverrides) =>
    request<XrefReport>('POST', `/projects/${projectId}/xref`, { overrides }),
  proseCheck: (
    projectId: string,
    body: { scope: AuditScope; fileId?: string; rules?: Partial<ProseRuleToggles>; overrides?: FileOverrides },
  ) => request<ProseCheckReport>('POST', `/projects/${projectId}/prose-check`, body),
  getDictionary: (projectId: string) =>
    request<{ customWords: string[] }>('GET', `/projects/${projectId}/dictionary`),
  review: (
    projectId: string,
    body: { scope: AuditScope; fileId?: string; deterministicOnly?: boolean; overrides?: FileOverrides },
  ) => request<ReviewResponse>('POST', `/projects/${projectId}/review`, body),

  // Literature library.
  getLibrary: (projectId: string) => request<LibraryTreeResponse>('GET', `/projects/${projectId}/library`),
  searchLibrary: (projectId: string, q: string) =>
    request<{ items: LiteratureItem[] }>('GET', `/projects/${projectId}/library/search?q=${encodeURIComponent(q)}`),
  getCiteKeys: (projectId: string) => request<{ keys: string[] }>('GET', `/projects/${projectId}/library/cite-keys`),
  getCiteLinks: (projectId: string) => request<{ links: CiteLink[] }>('GET', `/projects/${projectId}/library/links`),
  createLibFolder: (projectId: string, name: string, parentId?: string | null) =>
    request<LibraryFolder>('POST', `/projects/${projectId}/library/folders`, { name, parentId: parentId ?? null }),
  renameLibFolder: (folderId: string, body: { name?: string; parentId?: string | null }) =>
    request<LibraryFolder>('PATCH', `/library/folders/${folderId}`, body),
  deleteLibFolder: (folderId: string) => request<{ trashedItems: number }>('DELETE', `/library/folders/${folderId}`),
  uploadLibItem: (projectId: string, body: { fileName: string; fileBase64: string; folderId?: string | null }) =>
    request<LiteratureItem>('POST', `/projects/${projectId}/library/items`, body),
  importBib: (projectId: string, bibContent: string, folderId?: string | null) =>
    request<{ items: LiteratureItem[] }>('POST', `/projects/${projectId}/library/import-bib`, { bibContent, folderId: folderId ?? null }),
  patchLibItem: (
    itemId: string,
    body: Partial<{ title: string; authors: string; year: string; citeKey: string | null; doi: string | null; abstract: string | null; folderId: string | null }>,
  ) => request<LiteratureItem>('PATCH', `/library/items/${itemId}`, body),
  extractLibItem: (itemId: string) => request<LiteratureItem>('POST', `/library/items/${itemId}/extract`, {}),
  linkLibItem: (itemId: string, citeKey: string) => request<LiteratureItem>('POST', `/library/items/${itemId}/link`, { citeKey }),
  generateBib: (itemId: string) => request<{ item: LiteratureItem; citeKey: string }>('POST', `/library/items/${itemId}/generate-bib`, {}),
  enrichLibItem: (itemId: string) => request<LiteratureItem>('POST', `/library/items/${itemId}/enrich`, {}),
  deleteLibItem: (itemId: string) => request<{ ok: boolean }>('DELETE', `/library/items/${itemId}`),
  libItemPdfUrl: (itemId: string) => `/api/library/items/${itemId}/pdf`,

  // Semi-compiled snippet rendering (Visual editor: TikZ diagrams + maths fallback).
  renderSnippet: (projectId: string, body: { latex: string; kind: 'tikz' | 'math'; inline?: boolean; packages?: string[]; tikzLibraries?: string[]; variant?: string }) =>
    request<{ pngBase64: string; width: number; height: number; cached: boolean }>('POST', `/projects/${projectId}/render-snippet`, body),

  // Diagram editor: frozen-PDF export + sandboxed GNUplot.
  diagramPdf: (projectId: string, body: { tikz: string; outPath: string; packages?: string[]; tikzLibraries?: string[] }) =>
    request<{ path: string }>('POST', `/projects/${projectId}/diagram-pdf`, body),
  runGnuplot: (
    projectId: string,
    body: {
      source: { type: 'function'; expr: string } | { type: 'data'; data: string };
      settings: { dim?: '2d' | '3d'; xrange: string; yrange: string; zrange?: string; xlabel: string; ylabel: string; zlabel?: string; plotStyle: string; view?: string };
      style?: { stroke?: string; strokeWidth?: number; dash?: string };
      widthCm: number;
      heightCm: number;
      base: string;
    },
  ) => request<{ ok: boolean; base: string; stdout: string; stderr: string; previewPng?: string }>('POST', `/projects/${projectId}/gnuplot`, body),

  // Adaptive autocomplete usage (local habit data; never sent anywhere external).
  getUsage: (projectId: string) => request<{ app: UsageStatRow[]; project: UsageStatRow[] }>('GET', `/projects/${projectId}/usage`),
  postUsage: (projectId: string, body: { events: Array<{ key: string; scope: UsageScope; at?: string }> }) =>
    request<void>('POST', `/projects/${projectId}/usage`, body),
  deleteUsage: (projectId: string, scope: UsageScope) => request<void>('DELETE', `/projects/${projectId}/usage?scope=${scope}`),

  // RAG index over the library (local embeddings).
  libraryIndexStatus: (projectId: string) =>
    request<{ items: number; itemsWithText: number; indexedItems: number; chunks: number; model: string | null; embeddingAvailable: boolean }>(
      'GET',
      `/projects/${projectId}/library/index-status`,
    ),
  reindexLibrary: (projectId: string) =>
    request<{ indexed: number; chunks: number; skipped: number }>('POST', `/projects/${projectId}/library/reindex`, {}),

  // Document-aware prediction.
  documentModel: (projectId: string, body: { cursorFile?: string; cursorLine?: number; headingNote?: boolean; overrides?: FileOverrides }) =>
    request<DocumentModelResponse>('POST', `/projects/${projectId}/document-model`, body),
  predictNext: (
    projectId: string,
    body: { fileId: string; cursorLine: number; granularity: PredictGranularity; card?: string; position?: string; model?: string; overrides?: FileOverrides },
  ) => aiRequest<PredictNextResponse>('POST', `/projects/${projectId}/predict-next`, body),
  getTrash: (projectId: string) => request<{ items: TrashItem[] }>('GET', `/projects/${projectId}/trash`),
  restoreTrash: (projectId: string, trashId: string) => request<{ ok: boolean }>('POST', `/projects/${projectId}/trash/${trashId}/restore`, {}),
  emptyTrash: (projectId: string) => request<{ removed: number }>('DELETE', `/projects/${projectId}/trash`),
  updateDictionary: (projectId: string, word: string, remove?: boolean) =>
    request<{ customWords: string[] }>('POST', `/projects/${projectId}/dictionary`, {
      word,
      ...(remove ? { remove: true } : {}),
    }),
  preSubmit: (projectId: string, overrides?: FileOverrides) =>
    request<PreSubmitSummary>('POST', `/projects/${projectId}/pre-submit`, { overrides }),

  // ── Connectors (model / storage / literature) ──────────────────────────────
  listConnectors: () => request<{ connectors: ConnectorStatus[] }>('GET', '/connectors'),
  getConnector: (id: string) => request<ConnectorStatus>('GET', `/connectors/${id}`),
  connectConnector: (id: string, body?: { apiKey?: string; origin?: string }) =>
    request<ConnectorConnectResult>('POST', `/connectors/${id}/connect`, body ?? {}),
  configureConnector: (id: string, clientId: string, clientSecret: string) =>
    request<ConnectorConnectResult>('POST', `/connectors/${id}/configure`, { clientId, clientSecret }),
  disconnectConnector: (id: string) => request<ConnectorConnectResult>('POST', `/connectors/${id}/disconnect`),
};

/** Stream a "why doesn't this step follow" explanation (SSE), token by token. */
export async function streamExplainStep(
  projectId: string,
  body: {
    latex: string;
    previousLatex?: string;
    method?: string;
    counterexample?: MathCounterexample;
    file?: string;
    line?: number;
    overrides?: FileOverrides;
  },
  handlers: { onToken: (t: string) => void; onDone: () => void; onError: (kind: AiErrorKind, message: string) => void },
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;

  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/explain-step`, init);
  } catch {
    handlers.onError('unavailable', 'Could not reach the AI service.');
    return;
  }
  if (!res.ok || !res.body) {
    let kind: AiErrorKind = 'other';
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; kind?: AiErrorKind };
      if (data.kind) kind = data.kind;
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    handlers.onError(kind, message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /event: (.*)/.exec(block)?.[1];
      const dataLine = /data: (.*)/.exec(block)?.[1];
      if (!event || dataLine === undefined) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (event === 'token') handlers.onToken((data as { text: string }).text);
      else if (event === 'done') handlers.onDone();
      else if (event === 'error') {
        const e = data as { kind: AiErrorKind; message: string };
        handlers.onError(e.kind, e.message);
      }
    }
  }
}

/** Run the co-derivation engine (SSE): per-round progress, then the final result. */
export async function streamCoderive(
  projectId: string,
  body: CoderiveRequest,
  handlers: {
    onRound: (r: CoderiveRound) => void;
    onResult: (r: CoderiveResponse) => void;
    onError: (kind: AiErrorKind, message: string) => void;
    onProgress?: (stage: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;

  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/coderive`, init);
  } catch {
    handlers.onError('unavailable', 'Could not reach the AI service.');
    return;
  }
  if (!res.ok || !res.body) {
    let kind: AiErrorKind = 'other';
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; kind?: AiErrorKind };
      if (data.kind) kind = data.kind;
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    handlers.onError(kind, message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /event: (.*)/.exec(block)?.[1];
      const dataLine = /data: (.*)/.exec(block)?.[1];
      if (!event || dataLine === undefined) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (event === 'round') handlers.onRound(data as CoderiveRound);
      else if (event === 'result') handlers.onResult(data as CoderiveResponse);
      else if (event === 'progress') handlers.onProgress?.((data as { stage: string }).stage);
      else if (event === 'error') {
        const e = data as { kind: AiErrorKind; message: string };
        handlers.onError(e.kind, e.message);
      }
    }
  }
}

/**
 * Execute a project's Python and stream its stdout/stderr over SSE. Mirrors
 * streamCoderive's reader. Cancel by aborting `signal` (and call api.stopRun to
 * kill the sandbox). Resolves when the run ends.
 */
export async function streamRun(
  projectId: string,
  body: { fileId?: string; path?: string; args?: string[] },
  handlers: {
    onStart: (s: RunStarted) => void;
    onStdout: (chunk: string) => void;
    onStderr: (chunk: string) => void;
    onDone: (d: RunDone) => void;
    onError: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  if (signal) init.signal = signal;

  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/run`, init);
  } catch {
    handlers.onError('Could not reach the run service.');
    return;
  }
  if (!res.ok || !res.body) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    handlers.onError(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch {
      break; // aborted
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /event: (.*)/.exec(block)?.[1];
      const dataLine = /data: (.*)/.exec(block)?.[1];
      if (!event || dataLine === undefined) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (event === 'start') handlers.onStart(data as RunStarted);
      else if (event === 'stdout') handlers.onStdout((data as { chunk: string }).chunk);
      else if (event === 'stderr') handlers.onStderr((data as { chunk: string }).chunk);
      else if (event === 'done') handlers.onDone(data as RunDone);
      else if (event === 'error') handlers.onError((data as { error?: string }).error ?? 'Run failed.');
    }
  }
}

/** Request an inline completion, cancellable via `signal`. Throws `AiError`. */
export async function completeCode(
  projectId: string,
  req: CompletionInlineRequest,
  signal: AbortSignal,
): Promise<CompletionResult> {
  const res = await fetch(`/api/projects/${projectId}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  if (res.status === 204) {
    return { completion: '', latencyMs: 0, variant: 'warm', provider: '', model: '' };
  }
  if (!res.ok) {
    let kind: AiErrorKind = 'other';
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; kind?: AiErrorKind };
      if (data.kind) kind = data.kind;
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    throw new AiError(res.status, kind, message);
  }
  return (await res.json()) as CompletionResult;
}

export interface ChatStreamHandlers {
  onMeta?: (threadId: string) => void;
  onToken: (text: string) => void;
  onDone: (info: { threadId: string; messageId: string }) => void;
  onError: (kind: AiErrorKind, message: string) => void;
}

/**
 * Stream a chat reply token-by-token over SSE (through the /api proxy). The
 * server owns the transcript; this only relays deltas to the UI.
 */
export async function streamChat(
  projectId: string,
  body: { threadId?: string; message: string; context?: ChatContext },
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
  if (signal) init.signal = signal;

  let res: Response;
  try {
    res = await fetch(`/api/projects/${projectId}/chat`, init);
  } catch {
    handlers.onError('unavailable', 'Could not reach the AI service.');
    return;
  }

  if (!res.ok || !res.body) {
    let kind: AiErrorKind = 'other';
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string; kind?: AiErrorKind };
      if (data.kind) kind = data.kind;
      if (data.error) message = data.error;
    } catch {
      /* non-JSON */
    }
    handlers.onError(kind, message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /event: (.*)/.exec(block)?.[1];
      const dataLine = /data: (.*)/.exec(block)?.[1];
      if (!event || dataLine === undefined) continue;
      let data: unknown;
      try {
        data = JSON.parse(dataLine);
      } catch {
        continue;
      }
      if (event === 'meta') handlers.onMeta?.((data as { threadId: string }).threadId);
      else if (event === 'token') handlers.onToken((data as { text: string }).text);
      else if (event === 'done') handlers.onDone(data as { threadId: string; messageId: string });
      else if (event === 'error') {
        const e = data as { kind: AiErrorKind; message: string };
        handlers.onError(e.kind, e.message);
      }
    }
  }
}

/** Browser URL for a compiled PDF (an api-relative path goes through the proxy). */
export function pdfBrowserUrl(apiRelativeUrl: string): string {
  return `/api${apiRelativeUrl}`;
}
