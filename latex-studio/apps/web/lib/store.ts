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
import type {
  CompileResultStatus,
  CursorState,
  DerivationResult,
  DerivationTransition,
  Diagnostic,
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
export const COMPILE_ON_SAVE_DELAY = 600;

/** Debounce timers for per-file autosave (kept outside React/store state). */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Debounce timer for compile-on-save (one per session). */
let compileTimer: ReturnType<typeof setTimeout> | undefined;
/** Cache key (normalised steps + settings) of the last math check. */
let mathCacheKey: string | null = null;

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
  compileError: string | null;
  pdfUrl: string | null;
  compileOnSave: boolean;

  // SyncTeX / cross-pane navigation
  pendingReveal: PendingReveal | null;
  forwardHighlight: ForwardHighlight | null;

  // Mathcheck + AI settings
  macros: Record<string, string>;
  assumptions: string;
  model: string;
  aiInstructions: string;
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
  createFile: (path: string, content?: string) => Promise<FileMeta | null>;
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
  setCompileOnSave: (value: boolean) => void;
  revealLocation: (file: string, line: number, column?: number) => Promise<void>;
  consumeReveal: () => void;
  locateInPdf: () => Promise<void>;
  syncInverseJump: (page: number, x: number, y: number) => Promise<void>;

  // Mathcheck + AI settings
  saveSettings: (patch: {
    macros?: Record<string, string>;
    assumptions?: string;
    model?: string;
    aiInstructions?: string;
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

  /** Run the debounced save for one file. */
  async function doSave(id: string): Promise<void> {
    const content = get().contents[id];
    if (content === undefined) return;
    set((s) => ({ status: { ...s.status, [id]: 'saving' } }));
    try {
      await api.updateFile(id, { content });
      // Only mark saved if nothing newer was typed since we captured `content`.
      if (get().contents[id] === content) {
        set((s) => ({ status: { ...s.status, [id]: 'saved' } }));
      }
      if (get().compileOnSave) scheduleCompile();
    } catch {
      set((s) => ({ status: { ...s.status, [id]: 'error' } }));
    }
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

  /** Debounced compile, fired after a successful save when compile-on-save is on. */
  function scheduleCompile(): void {
    if (compileTimer) clearTimeout(compileTimer);
    compileTimer = setTimeout(() => {
      compileTimer = undefined;
      void get().compileProject();
    }, COMPILE_ON_SAVE_DELAY);
  }

  return {
    projects: [],
    projectId: null,
    files: [],
    folders: [],
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
    compileError: null,
    pdfUrl: null,
    compileOnSave: false,
    pendingReveal: null,
    forwardHighlight: null,
    macros: {},
    assumptions: '',
    model: 'claude-sonnet-4-6',
    aiInstructions: '',
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
        compileError: null,
        pdfUrl: null,
        pendingReveal: null,
        forwardHighlight: null,
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
      const files = await api.listFiles(projectId);
      set({ files });
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
      scheduleSave(id);
    },

    setCursor(id, cursor) {
      set((s) => ({ cursors: { ...s.cursors, [id]: cursor } }));
      persistLayout();
    },

    async createFile(path, content) {
      const { projectId } = get();
      if (!projectId) return null;
      const file = await api.createFile(projectId, path, content);
      await get().refreshFiles();
      set((s) => ({ contents: { ...s.contents, [file.id]: file.content } }));
      await get().openFile(file.id);
      return { id: file.id, projectId: file.projectId, path: file.path, updatedAt: file.updatedAt };
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
          pdfUrl: res.pdfUrl ? `/api${res.pdfUrl}` : get().pdfUrl,
        });
      } catch (err) {
        set({
          compiling: false,
          compileError: err instanceof ApiError ? err.message : 'Compilation failed',
        });
      }
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
        projects: s.projects.map((p) =>
          p.id === projectId
            ? {
                ...p,
                macros: updated.macros ?? {},
                assumptions: updated.assumptions ?? '',
                model: updated.model ?? 'claude-sonnet-4-6',
                aiInstructions: updated.aiInstructions ?? '',
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
