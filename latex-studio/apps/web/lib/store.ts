'use client';

import { create } from 'zustand';
import { api, ApiError } from './api';
import {
  loadCompileOnSave,
  loadLayout,
  loadLastProject,
  loadTheme,
  saveCompileOnSave,
  saveLastProject,
  saveLayout,
  saveTheme,
} from './persist';
import { editorController } from './editorController';
import { parentPath } from './treeUtils';
import { fileToBase64, isAllowedPath, isBinaryPath, uploadTargetPath, type UploadItem } from './fileKind';
import { checkerFlagCandidates, compileFlagCandidates, type PdfFlag, type PdfFlagCandidate } from './pdfFlags';
import type { MathAuditBlock } from '@latex-studio/shared';
import type {
  CompileResultStatus,
  CursorState,
  DerivationResult,
  DerivationTransition,
  Diagnostic,
  DiagnosticQuickFix,
  FileMeta,
  ForwardHighlight,
  MathLineMarker,
  PendingReveal,
  Project,
  SaveStatus,
  SnapshotMeta,
  Theme,
} from './types';

export const AUTOSAVE_DELAY = 800;
/** Compile-on-save debounce, measured from the LAST KEYSTROKE (not from save
 *  completion). Sits just past AUTOSAVE_DELAY so the save has normally fired by
 *  the time we compile; the compile awaits the save regardless, so a slow save
 *  never changes compile timing unpredictably. */
export const COMPILE_ON_SAVE_DELAY = 1100;
/** Upload size cap (base64 inflates ~33%, so keep this comfortably under body limits). */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/** Debounce timers for per-file autosave (kept outside React/store state). */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** In-flight save promises per file, so compile can await the latest save. */
const inflightSaves = new Map<string, Promise<void>>();
/** Debounce timer for compile-on-save (one per session), keyed to last edit. */
let compileTimer: ReturnType<typeof setTimeout> | undefined;
/** Cache key (normalised steps + settings) of the last math check. */
let mathCacheKey: string | null = null;

/** file:line candidates → PDF rectangles via SyncTeX forward search. Failures
 *  (synctex missing, line not in the PDF) just drop that flag. */
async function mapFlagCandidates(projectId: string, candidates: PdfFlagCandidate[], source: PdfFlag['source']): Promise<PdfFlag[]> {
  const flags = await Promise.all(
    candidates.map(async (c, i): Promise<PdfFlag | null> => {
      try {
        const res = await api.syncForward({ projectId, file: c.file, line: c.line, column: 0 });
        const box = res.boxes[0];
        if (!box || !box.page) return null;
        return { ...c, ...box, id: `${source}-${i}-${c.file}:${c.line}`, source };
      } catch {
        return null;
      }
    }),
  );
  return flags.filter((f): f is PdfFlag => f !== null);
}

/** Insert `\usepackage{<pkg>}` into a document's preamble if not already loaded
 *  (in its own line or a comma list). Inserts after the last \usepackage, else
 *  after \documentclass. Returns the content unchanged when already present. */
export function addPreamblePackage(content: string, pkg: string): string {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${escaped}\\b[^}]*\\}`).test(content)) return content;
  const line = `\\usepackage{${pkg}}`;
  const pkgs = [...content.matchAll(/^[^\n%]*\\usepackage[^\n]*$/gm)];
  const last = pkgs[pkgs.length - 1];
  if (last && last.index !== undefined) {
    const at = last.index + last[0].length;
    return `${content.slice(0, at)}\n${line}${content.slice(at)}`;
  }
  const dc = /\\documentclass[^\n]*\n/.exec(content);
  if (dc) {
    const at = dc.index + dc[0].length;
    return `${content.slice(0, at)}${line}\n${content.slice(at)}`;
  }
  return `${line}\n${content}`;
}

function transitionTitle(t: DerivationTransition): string {
  if (t.verdict === 'ok') return `Consistent with previous step${t.method ? ` (${t.method})` : ''}`;
  if (t.verdict === 'unparseable') return t.error ?? 'Could not parse this step';
  if (t.verdict === 'unknown') {
    return `Could not establish equivalence${t.method ? ` (${t.method})` : ''}`;
  }
  const c = t.counterexample;
  if (c) {
    const vals = Object.entries(c.values)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    return `Not equal — counterexample ${vals ? `(${vals}) ` : ''}lhs=${c.lhsVal}, rhs=${c.rhsVal}`;
  }
  return 'Not equal to the previous step';
}

function buildMarkers(lines: number[], result: DerivationResult): Record<number, MathLineMarker> {
  const byLine: Record<number, MathLineMarker> = {};
  const first = lines[0];
  if (first !== undefined) {
    const s0 = result.steps[0];
    byLine[first] = s0?.error
      ? { verdict: 'unparseable', title: s0.error }
      : { verdict: 'ok', title: 'Start of derivation' };
  }
  for (const t of result.transitions) {
    const line = lines[t.to];
    if (line === undefined) continue;
    byLine[line] = { verdict: t.verdict, title: transitionTitle(t) };
  }
  return byLine;
}

interface EditorState {
  // Projects
  projects: Project[];
  projectId: string | null;

  // Files in the active project
  files: FileMeta[];
  /** Client-only empty folders (folders are otherwise derived from file paths). */
  folders: string[];
  /** True while the active project's file list is loading (first-paint skeleton). */
  filesLoading: boolean;

  // Open documents
  openFileIds: string[];
  activeFileId: string | null;
  contents: Record<string, string>;
  cursors: Record<string, CursorState>;
  status: Record<string, SaveStatus>;

  // Snapshots
  snapshots: SnapshotMeta[];

  // Compilation + preview
  compiling: boolean;
  diagnostics: Diagnostic[];
  compileStatus: CompileResultStatus | null;
  compileDurationMs: number | null;
  /** Tail of the raw .log from the last compile (panel "raw log" view). */
  compileLog: string | null;
  compileError: string | null;
  pdfUrl: string | null;
  /** True when the shown PDF is the last GOOD build but the source has since
   *  failed to compile — the viewer dims it and shows a "stale" badge. */
  pdfStale: boolean;
  compileOnSave: boolean;

  // SyncTeX / cross-pane navigation
  pendingReveal: PendingReveal | null;
  forwardHighlight: ForwardHighlight | null;
  /** Persistent issue highlights drawn over the compiled PDF: orange/yellow
   *  compile warnings + violet maths-checker flags (lib/pdfFlags). */
  pdfFlags: PdfFlag[];

  // Mathcheck + AI settings
  macros: Record<string, string>;
  assumptions: string;
  model: string;
  aiInstructions: string;
  /** Model connector powering AI: "anthropic" | "chatgpt" | "gemini". */
  aiProvider: string;
  mathResult: DerivationResult | null;
  mathChecking: boolean;
  mathError: string | null;
  /** Gutter markers for the active file, keyed by 1-based line. */
  mathByLine: Record<number, MathLineMarker>;
  mathFileId: string | null;

  // UI
  theme: Theme;
  ready: boolean;
  error: string | null;

  // Actions
  bootstrap: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  refreshFiles: () => Promise<void>;
  openFile: (id: string) => Promise<void>;
  closeFile: (id: string) => void;
  setActive: (id: string) => void;
  setContent: (id: string, content: string) => void;
  setCursor: (id: string, cursor: CursorState) => void;
  createFile: (path: string, content?: string, encoding?: 'utf8' | 'base64') => Promise<FileMeta | null>;
  uploadFiles: (
    items: UploadItem[],
    parentDir: string,
  ) => Promise<{ uploaded: number; skipped: number; errors: string[] }>;
  renameFile: (id: string, newPath: string) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  createFolder: (path: string) => void;
  renameFolder: (oldPath: string, newPath: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  refreshSnapshots: () => Promise<void>;
  createSnapshot: (label: string) => Promise<void>;
  restoreSnapshot: (id: string) => Promise<void>;
  toggleTheme: () => void;

  // Compilation + SyncTeX
  compileProject: () => Promise<void>;
  /** Apply a diagnostic's deterministic quick-fix (e.g. add a missing
   *  \usepackage to the root preamble) and recompile. */
  applyDiagnosticQuickFix: (fix: DiagnosticQuickFix) => Promise<void>;
  setCompileOnSave: (value: boolean) => void;
  revealLocation: (file: string, line: number, column?: number) => Promise<void>;
  consumeReveal: () => void;
  locateInPdf: () => Promise<void>;
  locateInPdfAt: (file: string, line: number) => Promise<void>;
  syncInverseJump: (page: number, x: number, y: number) => Promise<void>;
  /** Replace the checker-sourced PDF flags from a fresh maths-audit report. */
  setCheckerPdfFlags: (blocks: MathAuditBlock[]) => Promise<void>;

  // Mathcheck + AI settings
  saveSettings: (patch: {
    macros?: Record<string, string>;
    assumptions?: string;
    model?: string;
    aiInstructions?: string;
    aiProvider?: string;
    rootFile?: string;
    pythonRunTarget?: string;
    networkEnabled?: boolean;
    texEngine?: 'pdflatex' | 'xelatex' | 'lualatex';
    haltOnError?: boolean;
    draftMode?: boolean;
  }) => Promise<void>;
  checkDerivation: () => Promise<void>;
  clearMath: () => void;
}

function applyThemeClass(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Persist the current tab/cursor layout for the active project. */
  function persistLayout(): void {
    const { projectId, openFileIds, activeFileId, cursors } = get();
    if (!projectId) return;
    saveLayout(projectId, { openFileIds, activeFileId, cursors });
  }

  /** Fetch a file's content into the store if not already present. */
  async function ensureContent(id: string): Promise<void> {
    if (get().contents[id] !== undefined) return;
    try {
      const file = await api.getFile(id);
      set((s) => ({
        contents: { ...s.contents, [id]: file.content },
        status: { ...s.status, [id]: 'saved' },
      }));
    } catch {
      /* file may have been deleted — leave it out */
    }
  }

  /** Persist one file. Compile is NOT triggered here — see scheduleCompile,
   *  which keys off the last keystroke and awaits the in-flight save instead. */
  async function doSave(id: string): Promise<void> {
    const content = get().contents[id];
    if (content === undefined) return;
    set((s) => ({ status: { ...s.status, [id]: 'saving' } }));
    const p = (async () => {
      try {
        await api.updateFile(id, { content });
        // Only mark saved if nothing newer was typed since we captured `content`.
        if (get().contents[id] === content) {
          set((s) => ({ status: { ...s.status, [id]: 'saved' } }));
        }
      } catch {
        set((s) => ({ status: { ...s.status, [id]: 'error' } }));
      }
    })();
    inflightSaves.set(id, p);
    await p;
    if (inflightSaves.get(id) === p) inflightSaves.delete(id);
  }

  function scheduleSave(id: string): void {
    const existing = saveTimers.get(id);
    if (existing) clearTimeout(existing);
    saveTimers.set(
      id,
      setTimeout(() => {
        saveTimers.delete(id);
        void doSave(id);
      }, AUTOSAVE_DELAY),
    );
  }

  /** Force one file's pending/in-flight save to completion (used before compile). */
  async function flushSave(id: string): Promise<void> {
    const timer = saveTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      saveTimers.delete(id);
      await doSave(id);
    } else {
      await inflightSaves.get(id);
    }
  }

  /** Flush every pending/in-flight save (a compile rebuilds the whole project). */
  async function flushAllSaves(): Promise<void> {
    const ids = new Set<string>([...saveTimers.keys(), ...inflightSaves.keys()]);
    await Promise.all([...ids].map((id) => flushSave(id)));
  }

  /** Compile-on-save, debounced off the LAST KEYSTROKE. When it fires it first
   *  flushes outstanding saves to completion, so the server always compiles the
   *  latest content and a slow save can't shift the compile schedule. */
  function scheduleCompile(): void {
    if (compileTimer) clearTimeout(compileTimer);
    compileTimer = setTimeout(() => {
      compileTimer = undefined;
      void (async () => {
        await flushAllSaves();
        await get().compileProject();
      })();
    }, COMPILE_ON_SAVE_DELAY);
  }

  return {
    projects: [],
    projectId: null,
    files: [],
    folders: [],
    filesLoading: false,
    openFileIds: [],
    activeFileId: null,
    contents: {},
    cursors: {},
    status: {},
    snapshots: [],
    compiling: false,
    diagnostics: [],
    compileStatus: null,
    compileDurationMs: null,
    compileLog: null,
    compileError: null,
    pdfUrl: null,
    pdfStale: false,
    compileOnSave: false,
    pendingReveal: null,
    forwardHighlight: null,
    pdfFlags: [],
    macros: {},
    assumptions: '',
    model: 'claude-sonnet-4-6',
    aiInstructions: '',
    aiProvider: 'anthropic',
    mathResult: null,
    mathChecking: false,
    mathError: null,
    mathByLine: {},
    mathFileId: null,
    theme: 'light',
    ready: false,
    error: null,

    async bootstrap() {
      const theme = loadTheme() ?? 'light';
      applyThemeClass(theme);
      set({ theme, compileOnSave: loadCompileOnSave() });

      try {
        const projects = await api.listProjects();
        set({ projects });
        const last = loadLastProject();
        const target = projects.find((p) => p.id === last) ?? projects[0];
        if (target) {
          await get().selectProject(target.id);
        }
        set({ ready: true });
      } catch (err) {
        set({
          ready: true,
          error: err instanceof ApiError ? err.message : 'Failed to load projects',
        });
      }
    },

    async selectProject(id) {
      set({
        projectId: id,
        files: [],
        folders: [],
        openFileIds: [],
        activeFileId: null,
        contents: {},
        cursors: {},
        status: {},
        snapshots: [],
        diagnostics: [],
        compileStatus: null,
        compileDurationMs: null,
        compileLog: null,
        compileError: null,
        pdfUrl: null,
        pendingReveal: null,
        forwardHighlight: null,
        pdfFlags: [],
        mathResult: null,
        mathByLine: {},
        mathFileId: null,
        mathError: null,
      });
      saveLastProject(id);
      mathCacheKey = null;

      const settingsSource = get().projects.find((p) => p.id === id);
      set({
        macros: settingsSource?.macros ?? {},
        assumptions: settingsSource?.assumptions ?? '',
        model: settingsSource?.model ?? 'claude-sonnet-4-6',
        aiInstructions: settingsSource?.aiInstructions ?? '',
        aiProvider: settingsSource?.aiProvider ?? 'anthropic',
      });

      await get().refreshFiles();
      await get().refreshSnapshots();

      // Restore persisted tabs + cursors for files that still exist.
      const files = get().files;
      const layout = loadLayout(id);
      if (layout) {
        const existing = new Set(files.map((f) => f.id));
        const openFileIds = layout.openFileIds.filter((fid) => existing.has(fid));
        const activeFileId =
          layout.activeFileId && existing.has(layout.activeFileId)
            ? layout.activeFileId
            : (openFileIds[0] ?? null);
        set({ openFileIds, activeFileId, cursors: layout.cursors ?? {} });
        await Promise.all(openFileIds.map((fid) => ensureContent(fid)));
      }

      // First visit (no saved tabs): land in the project's root file.
      if (get().openFileIds.length === 0) {
        const project = get().projects.find((p) => p.id === id);
        const root =
          files.find((f) => f.path === (project?.rootFile ?? 'main.tex')) ?? files[0];
        if (root) await get().openFile(root.id);
      }
    },

    async createProject(name) {
      const project = await api.createProject(name);
      set((s) => ({ projects: [project, ...s.projects] }));
      await get().selectProject(project.id);
    },

    async refreshFiles() {
      const { projectId } = get();
      if (!projectId) return;
      set({ filesLoading: true });
      try {
        const files = await api.listFiles(projectId);
        set({ files });
      } finally {
        set({ filesLoading: false });
      }
    },

    async openFile(id) {
      set((s) => ({
        openFileIds: s.openFileIds.includes(id) ? s.openFileIds : [...s.openFileIds, id],
        activeFileId: id,
      }));
      await ensureContent(id);
      persistLayout();
    },

    closeFile(id) {
      const { openFileIds, activeFileId } = get();
      const remaining = openFileIds.filter((fid) => fid !== id);
      let nextActive = activeFileId;
      if (activeFileId === id) {
        const idx = openFileIds.indexOf(id);
        nextActive = remaining[idx] ?? remaining[idx - 1] ?? remaining[0] ?? null;
      }
      set({ openFileIds: remaining, activeFileId: nextActive });
      persistLayout();
    },

    setActive(id) {
      set({ activeFileId: id });
      persistLayout();
    },

    setContent(id, content) {
      if (get().contents[id] === content) return;
      set((s) => ({
        contents: { ...s.contents, [id]: content },
        status: { ...s.status, [id]: 'dirty' },
      }));
      // Both timers key off this keystroke; the compile awaits the save when it fires.
      scheduleSave(id);
      if (get().compileOnSave) scheduleCompile();
    },

    setCursor(id, cursor) {
      set((s) => ({ cursors: { ...s.cursors, [id]: cursor } }));
      persistLayout();
    },

    async createFile(path, content, encoding) {
      const { projectId } = get();
      if (!projectId) return null;
      const file = await api.createFile(projectId, path, content, encoding);
      await get().refreshFiles();
      set((s) => ({ contents: { ...s.contents, [file.id]: file.content } }));
      await get().openFile(file.id);
      return { id: file.id, projectId: file.projectId, path: file.path, encoding: file.encoding, updatedAt: file.updatedAt };
    },

    async uploadFiles(items, parentDir) {
      const { projectId } = get();
      if (!projectId) return { uploaded: 0, skipped: 0, errors: ['no project'] };
      const errors: string[] = [];
      let uploaded = 0;
      let skipped = 0; // unsupported types — common in folder uploads (.DS_Store, .aux, …)
      let firstId: string | null = null;

      for (const { file, relativePath } of items) {
        // relativePath preserves folder structure: "thesis/ch1/fig.png" from a
        // folder upload or a folder drag-drop; just "fig.png" for a plain file.
        const relative = relativePath || file.name;
        if (!isAllowedPath(relative)) {
          skipped += 1;
          continue;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          errors.push(`${relative}: too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)`);
          continue;
        }
        const path = uploadTargetPath(parentDir, relative);
        try {
          const created = isBinaryPath(path)
            ? await api.createFile(projectId, path, await fileToBase64(file), 'base64')
            : await api.createFile(projectId, path, await file.text(), 'utf8');
          uploaded += 1;
          firstId ??= created.id;
        } catch (err) {
          errors.push(`${relative}: ${err instanceof ApiError ? err.message : 'upload failed'}`);
        }
      }

      if (uploaded > 0) await get().refreshFiles();
      if (firstId) await get().openFile(firstId);
      return { uploaded, skipped, errors };
    },

    async renameFile(id, newPath) {
      const updated = await api.updateFile(id, { path: newPath });
      set((s) => ({
        files: s.files.map((f) => (f.id === id ? { ...f, path: updated.path } : f)),
      }));
    },

    async deleteFile(id) {
      await api.deleteFile(id);
      const timer = saveTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        saveTimers.delete(id);
      }
      inflightSaves.delete(id);
      set((s) => {
        const contents = { ...s.contents };
        const status = { ...s.status };
        const cursors = { ...s.cursors };
        delete contents[id];
        delete status[id];
        delete cursors[id];
        return {
          files: s.files.filter((f) => f.id !== id),
          openFileIds: s.openFileIds.filter((fid) => fid !== id),
          activeFileId:
            s.activeFileId === id
              ? (s.openFileIds.filter((fid) => fid !== id)[0] ?? null)
              : s.activeFileId,
          contents,
          status,
          cursors,
        };
      });
      persistLayout();
    },

    createFolder(path) {
      set((s) => (s.folders.includes(path) ? s : { folders: [...s.folders, path] }));
    },

    async renameFolder(oldPath, newPath) {
      const affected = get().files.filter(
        (f) => f.path === oldPath || f.path.startsWith(`${oldPath}/`),
      );
      for (const f of affected) {
        const suffix = f.path.slice(oldPath.length);
        await get().renameFile(f.id, `${newPath}${suffix}`);
      }
      set((s) => ({
        folders: s.folders.map((p) =>
          p === oldPath || p.startsWith(`${oldPath}/`) ? `${newPath}${p.slice(oldPath.length)}` : p,
        ),
      }));
    },

    async deleteFolder(path) {
      const affected = get().files.filter(
        (f) => f.path === path || f.path.startsWith(`${path}/`),
      );
      for (const f of affected) {
        await get().deleteFile(f.id);
      }
      set((s) => ({
        folders: s.folders.filter((p) => p !== path && !p.startsWith(`${path}/`)),
      }));
    },

    async refreshSnapshots() {
      const { projectId } = get();
      if (!projectId) return;
      const snapshots = await api.listSnapshots(projectId);
      set({ snapshots });
    },

    async createSnapshot(label) {
      const { projectId } = get();
      if (!projectId) return;
      await api.createSnapshot(projectId, label);
      await get().refreshSnapshots();
    },

    async restoreSnapshot(id) {
      const { projectId } = get();
      if (!projectId) return;
      // Capture the paths of currently-open tabs so we can re-open them by path
      // (restore replaces file rows, so their ids change).
      const openPaths = new Set(
        get()
          .openFileIds.map((fid) => get().files.find((f) => f.id === fid)?.path)
          .filter((p): p is string => Boolean(p)),
      );

      await api.restoreSnapshot(projectId, id);

      set({ contents: {}, status: {}, cursors: {}, openFileIds: [], activeFileId: null });
      await get().refreshFiles();

      const files = get().files;
      const toReopen = files.filter((f) => openPaths.has(f.path)).map((f) => f.id);
      const fallback = files.find((f) => f.path === 'main.tex') ?? files[0];
      const ids = toReopen.length > 0 ? toReopen : fallback ? [fallback.id] : [];
      for (const fid of ids) {
        await get().openFile(fid);
      }
      if (ids[0]) get().setActive(ids[0]);
    },

    toggleTheme() {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      applyThemeClass(next);
      saveTheme(next);
      set({ theme: next });
    },

    async compileProject() {
      const { projectId } = get();
      if (!projectId) return;
      set({ compiling: true, compileError: null });
      try {
        const res = await api.compile(projectId);
        // A superseded compile means a newer one is already running — ignore it
        // and let the newer request settle the UI.
        if (res.status === 'superseded') return;
        set({
          compiling: false,
          diagnostics: res.diagnostics,
          compileStatus: res.status,
          compileDurationMs: res.durationMs,
          compileLog: res.log ?? null,
          pdfUrl: res.pdfUrl ? `/api${res.pdfUrl}` : get().pdfUrl,
          // A failed compile ⇒ whatever PDF we show (the new one may be a partial
          // or the last-good build still on disk) no longer reflects the source,
          // so mark it stale; a successful compile is in sync. The viewer dims
          // the PDF and shows a "stale" badge while this is true.
          pdfStale: res.status === 'error',
          // The layout just changed — stale highlight positions would lie.
          // Checker flags return on the next audit run.
          pdfFlags: [],
        });
        // Highlight every orange/yellow problem in the fresh PDF (async; the
        // viewer overlays them as they arrive). Red means "no PDF" — nothing
        // to highlight there.
        if (res.status === 'success' && res.pdfUrl) {
          void mapFlagCandidates(projectId, compileFlagCandidates(res.diagnostics), 'compile').then((flags) => {
            if (get().projectId !== projectId) return;
            set((s) => ({ pdfFlags: [...flags, ...s.pdfFlags.filter((f) => f.source === 'checker')] }));
          });
        }
      } catch (err) {
        set({
          compiling: false,
          compileError: err instanceof ApiError ? err.message : 'Compilation failed',
          // A previously shown PDF (if any) no longer reflects the source.
          pdfStale: get().pdfUrl !== null,
        });
      }
    },

    async applyDiagnosticQuickFix(fix) {
      if (fix.kind !== 'add-package') return;
      const { projectId, projects, files } = get();
      if (!projectId) return;
      const rootPath = projects.find((p) => p.id === projectId)?.rootFile ?? 'main.tex';
      const root = files.find((f) => f.path === rootPath);
      if (!root) return;
      const current = get().contents[root.id] ?? (await api.getFile(root.id)).content;
      const next = addPreamblePackage(current, fix.package);
      if (next !== current) {
        get().setContent(root.id, next);
        // Persist immediately so the compile (server-side) sees the new package.
        await api.updateFile(root.id, { content: next }).catch(() => undefined);
      }
      await get().compileProject();
    },

    setCompileOnSave(value) {
      saveCompileOnSave(value);
      set({ compileOnSave: value });
    },

    async revealLocation(file, line, column) {
      const files = get().files;
      const match =
        files.find((f) => f.path === file) ??
        files.find((f) => f.path.endsWith(`/${file}`)) ??
        files.find((f) => f.path.endsWith(file));
      if (!match) return;
      await get().openFile(match.id);
      set({
        pendingReveal: { fileId: match.id, line, ...(column !== undefined ? { column } : {}), nonce: Date.now() },
      });
    },

    consumeReveal() {
      set({ pendingReveal: null });
    },

    async locateInPdf() {
      const { projectId, activeFileId, files } = get();
      if (!projectId || !activeFileId) return;
      const file = files.find((f) => f.id === activeFileId)?.path;
      const cursor = editorController.getCursor();
      if (!file || !cursor) return;
      try {
        const res = await api.syncForward({
          projectId,
          file,
          line: cursor.line,
          column: cursor.column,
        });
        const box = res.boxes[0];
        if (box) set({ forwardHighlight: { ...box, nonce: Date.now() } });
      } catch {
        /* synctex unavailable — ignore */
      }
    },

    async locateInPdfAt(file, line) {
      const { projectId } = get();
      if (!projectId) return;
      try {
        const res = await api.syncForward({ projectId, file, line, column: 0 });
        const box = res.boxes[0];
        if (box) set({ forwardHighlight: { ...box, nonce: Date.now() } });
      } catch {
        /* synctex unavailable — ignore */
      }
    },

    async setCheckerPdfFlags(blocks) {
      const { projectId } = get();
      if (!projectId) return;
      const flags = await mapFlagCandidates(projectId, checkerFlagCandidates(blocks), 'checker');
      if (get().projectId !== projectId) return;
      set((s) => ({ pdfFlags: [...s.pdfFlags.filter((f) => f.source === 'compile'), ...flags] }));
    },

    async syncInverseJump(page, x, y) {
      const { projectId } = get();
      if (!projectId) return;
      try {
        const res = await api.syncInverse({ projectId, page, x, y });
        await get().revealLocation(res.file, res.line, res.column);
      } catch {
        /* no mapping — ignore */
      }
    },

    async saveSettings(patch) {
      const { projectId } = get();
      if (!projectId) return;
      const updated = await api.updateProject(projectId, patch);
      mathCacheKey = null; // settings changed → re-check next time
      set((s) => ({
        macros: updated.macros ?? {},
        assumptions: updated.assumptions ?? '',
        model: updated.model ?? 'claude-sonnet-4-6',
        aiInstructions: updated.aiInstructions ?? '',
        aiProvider: updated.aiProvider ?? 'anthropic',
        projects: s.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                macros: updated.macros ?? {},
                assumptions: updated.assumptions ?? '',
                model: updated.model ?? 'claude-sonnet-4-6',
                aiInstructions: updated.aiInstructions ?? '',
                aiProvider: updated.aiProvider ?? 'anthropic',
                rootFile: updated.rootFile,
                pythonRunTarget: updated.pythonRunTarget ?? '',
                networkEnabled: updated.networkEnabled ?? false,
                texEngine: updated.texEngine ?? 'pdflatex',
                haltOnError: updated.haltOnError ?? false,
                draftMode: updated.draftMode ?? false,
              }
            : p,
        ),
      }));
    },

    async checkDerivation() {
      const { projectId, activeFileId, macros, assumptions } = get();
      if (!projectId) return;

      const region = editorController.getDerivationRegion();
      if (!region) {
        set({
          mathResult: null,
          mathByLine: {},
          mathError:
            'Select a derivation, or place the cursor inside an align/equation block (need at least two equations).',
        });
        return;
      }

      const key = JSON.stringify({
        steps: region.steps.map((s) => s.latex.replace(/\s+/g, '')),
        macros,
        assumptions,
      });
      // Unchanged equations + settings → reuse the cached result (no recheck).
      if (key === mathCacheKey && get().mathResult) return;

      set({ mathChecking: true, mathError: null });
      try {
        const result = await api.checkDerivation({
          steps: region.steps.map((s) => s.latex),
          macros,
          assumptions,
        });
        mathCacheKey = key;
        set({
          mathResult: result,
          mathByLine: buildMarkers(
            region.steps.map((s) => s.line),
            result,
          ),
          mathFileId: activeFileId,
          mathChecking: false,
        });
      } catch (err) {
        set({
          mathChecking: false,
          mathError: err instanceof ApiError ? err.message : 'Math check failed',
        });
      }
    },

    clearMath() {
      mathCacheKey = null;
      set({ mathResult: null, mathByLine: {}, mathFileId: null, mathError: null });
    },
  };
});

/** Derive a single indicator state from the open files' save statuses. */
export function computeOverallStatus(
  status: Record<string, SaveStatus>,
  openFileIds: string[],
): SaveStatus {
  const states = openFileIds.map((id) => status[id] ?? 'saved');
  if (states.includes('saving')) return 'saving';
  if (states.includes('dirty')) return 'dirty';
  if (states.includes('error')) return 'error';
  return 'saved';
}

/** Find a unique sibling path for a new file/folder under `parent`. */
export function defaultNewFilePath(parent: string, base: string): string {
  return parent ? `${parent}/${base}` : base;
}

export { parentPath };
