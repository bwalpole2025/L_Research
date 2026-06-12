'use client';

import { create } from 'zustand';
import { api, AiError, streamChat } from './api';
import { editorController, type EditRegion } from './editorController';
import { useEditorStore } from './store';
import type { AiErrorKind, AiStatus, ChatMessage, ChatThread, Diagnostic } from './types';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** A chat message in the UI (may be a not-yet-persisted streaming assistant turn). */
export interface UiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  errored?: boolean;
}

/** A proposed replacement awaiting Accept/Reject in the merge view. */
export interface PendingDiff {
  from: number;
  to: number;
  original: string;
  replacement: string;
  source: 'edit' | 'fix' | 'coderive' | 'review';
  filePath: string;
  /** For a forced unverified/unknown co-derive insert: underline `warnText` with this tooltip on accept. */
  unverifiedMessage?: string;
  warnText?: string;
  /** Fixes: the diagnostic line this diff anchors at — used to re-validate the
   *  remaining queued fixes' line numbers after this one is applied. */
  anchorLine?: number;
}

const KIND_MESSAGES: Record<AiErrorKind, string> = {
  credit_exhausted: 'Agent SDK credit exhausted — resets with your billing cycle.',
  auth: 'Claude sign-in required — run `claude login` on the host, then retry.',
  unavailable: 'AI backend unavailable — check that the Claude Agent SDK is reachable.',
  invalid: 'AI provider is not configured.',
  other: 'AI request failed.',
};

/** Kinds that disable AI features wholesale (vs. a one-off failure). */
function gates(kind: AiErrorKind): boolean {
  return kind === 'credit_exhausted' || kind === 'auth' || kind === 'unavailable';
}

interface AiState {
  status: AiStatus;
  models: string[];
  modelsLive: boolean;

  chatOpen: boolean;
  threads: ChatThread[];
  activeThreadId: string | null;
  messages: UiChatMessage[];
  streaming: boolean;
  pinnedPaths: string[];

  inlineRegion: EditRegion | null; // Cmd+K prompt is open when non-null
  editBusy: boolean;
  pendingDiff: PendingDiff | null;
  lastError: string | null;

  /** "AI error fixes" master toggle — off removes every Suggest-fix action. */
  errorFixesEnabled: boolean;
  /** Remaining diagnostics of a "Fix all errors" run (offered one at a time). */
  fixQueue: Diagnostic[];
  /** Non-error notice from the fix flow (e.g. the model declined to guess). */
  fixNotice: string | null;
  /** Offer a manual recompile after an accepted fix (when compile-on-save is off). */
  offerRecompile: boolean;

  refreshStatus: () => Promise<void>;
  loadModels: () => Promise<void>;
  toggleChat: () => void;
  setChatOpen: (open: boolean) => void;

  loadThreads: () => Promise<void>;
  selectThread: (threadId: string | null) => Promise<void>;
  newThread: () => void;
  deleteThread: (threadId: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;

  togglePin: (path: string) => void;

  openInlineEdit: () => void;
  cancelInlineEdit: () => void;
  submitInlineEdit: (instruction: string) => Promise<void>;
  requestFix: (diagnostic: Diagnostic) => Promise<void>;
  /** Queue every error diagnostic; each fix is approved independently, and the
   *  remaining regions are re-validated (line-shifted) after each accept. */
  suggestAllFixes: () => Promise<void>;
  setErrorFixesEnabled: (v: boolean) => void;
  clearRecompileOffer: () => void;

  openDiff: (diff: PendingDiff) => void;
  acceptDiff: () => void;
  rejectDiff: () => void;
  insertAtCursor: (text: string) => void;
}

let chatAbort: AbortController | null = null;

export const useAiStore = create<AiState>((set, get) => {
  function recordError(kind: AiErrorKind, message: string): void {
    if (gates(kind)) {
      set({ status: { available: false, reason: kind, message: KIND_MESSAGES[kind] }, lastError: message });
    } else {
      set({ lastError: message });
    }
  }

  function markOk(): void {
    if (!get().status.available) set({ status: { available: true } });
  }

  /** Build the per-query editor context for chat. */
  function chatContext() {
    const editor = useEditorStore.getState();
    const activeFile = editor.files.find((f) => f.id === editor.activeFileId)?.path;
    const selection = editorController.getSelectionText();
    const cursorLine = editorController.getCursor()?.line;
    const pinnedPaths = get().pinnedPaths;
    const ctx: {
      activeFile?: string;
      selection?: string;
      cursorLine?: number;
      pinnedPaths?: string[];
    } = {};
    if (activeFile) ctx.activeFile = activeFile;
    if (selection.trim()) ctx.selection = selection;
    if (cursorLine) ctx.cursorLine = cursorLine;
    if (pinnedPaths.length) ctx.pinnedPaths = pinnedPaths;
    return ctx;
  }

  function updateStreaming(id: string, fn: (m: UiChatMessage) => UiChatMessage): void {
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));
  }

  return {
    status: { available: true },
    models: [DEFAULT_MODEL],
    modelsLive: false,
    chatOpen: false,
    threads: [],
    activeThreadId: null,
    messages: [],
    streaming: false,
    pinnedPaths: [],
    inlineRegion: null,
    editBusy: false,
    pendingDiff: null,
    lastError: null,
    errorFixesEnabled: typeof window === 'undefined' || window.localStorage.getItem('latex-studio:error-fixes') !== 'false',
    fixQueue: [],
    fixNotice: null,
    offerRecompile: false,

    async refreshStatus() {
      try {
        const status = await api.getAiStatus();
        set({ status });
      } catch {
        /* leave current status */
      }
    },

    async loadModels() {
      try {
        const res = await api.getAiModels();
        set({ models: res.models, modelsLive: res.live });
      } catch {
        /* keep fallback */
      }
    },

    toggleChat() {
      const open = !get().chatOpen;
      set({ chatOpen: open });
      if (open && get().threads.length === 0) void get().loadThreads();
    },
    setChatOpen(open) {
      set({ chatOpen: open });
    },

    async loadThreads() {
      const projectId = useEditorStore.getState().projectId;
      if (!projectId) return;
      try {
        const threads = await api.listChatThreads(projectId);
        set({ threads });
        if (!get().activeThreadId && threads[0]) await get().selectThread(threads[0].id);
      } catch {
        /* ignore */
      }
    },

    async selectThread(threadId) {
      chatAbort?.abort();
      set({ activeThreadId: threadId, messages: [], streaming: false });
      if (!threadId) return;
      try {
        const messages = await api.getThreadMessages(threadId);
        set({ messages: messages.map(toUi) });
      } catch {
        set({ messages: [] });
      }
    },

    newThread() {
      chatAbort?.abort();
      set({ activeThreadId: null, messages: [], streaming: false, lastError: null });
    },

    async deleteThread(threadId) {
      await api.deleteChatThread(threadId).catch(() => undefined);
      set((s) => ({ threads: s.threads.filter((t) => t.id !== threadId) }));
      if (get().activeThreadId === threadId) get().newThread();
    },

    async sendMessage(text) {
      const projectId = useEditorStore.getState().projectId;
      const trimmed = text.trim();
      if (!projectId || !trimmed || get().streaming || !get().status.available) return;

      const userMsg: UiChatMessage = { id: `u-${Date.now()}`, role: 'user', content: trimmed };
      const aiId = `a-${Date.now()}`;
      set((s) => ({
        messages: [...s.messages, userMsg, { id: aiId, role: 'assistant', content: '', streaming: true }],
        streaming: true,
        lastError: null,
      }));

      chatAbort = new AbortController();
      const threadId = get().activeThreadId ?? undefined;
      await streamChat(
        projectId,
        { ...(threadId ? { threadId } : {}), message: trimmed, context: chatContext() },
        {
          onMeta: (tid) => {
            if (!get().activeThreadId) set({ activeThreadId: tid });
          },
          onToken: (t) => {
            markOk();
            updateStreaming(aiId, (m) => ({ ...m, content: m.content + t }));
          },
          onDone: () => {
            updateStreaming(aiId, (m) => ({ ...m, streaming: false }));
            set({ streaming: false });
            void get().loadThreads();
          },
          onError: (kind, message) => {
            recordError(kind, message);
            updateStreaming(aiId, (m) => ({
              ...m,
              streaming: false,
              errored: true,
              content: m.content || `_${KIND_MESSAGES[kind]}_`,
            }));
            set({ streaming: false });
          },
        },
        chatAbort.signal,
      );
    },

    togglePin(path) {
      set((s) => ({
        pinnedPaths: s.pinnedPaths.includes(path)
          ? s.pinnedPaths.filter((p) => p !== path)
          : [...s.pinnedPaths, path],
      }));
    },

    openInlineEdit() {
      if (!get().status.available) return;
      const region = editorController.captureEditRegion();
      if (!region) {
        set({ lastError: 'Select some text (or place the cursor on a line) to edit with Claude.' });
        return;
      }
      set({ inlineRegion: region, lastError: null });
    },

    cancelInlineEdit() {
      set({ inlineRegion: null });
    },

    async submitInlineEdit(instruction) {
      const editor = useEditorStore.getState();
      const region = get().inlineRegion;
      if (!editor.projectId || !region || !instruction.trim()) return;
      const filePath = editor.files.find((f) => f.id === editor.activeFileId)?.path ?? 'main.tex';
      set({ editBusy: true });
      try {
        const res = await api.aiEdit(editor.projectId, {
          filePath,
          selection: region.selection,
          context: region.context,
          instruction: instruction.trim(),
        });
        markOk();
        set({
          inlineRegion: null,
          editBusy: false,
          pendingDiff: {
            from: region.from,
            to: region.to,
            original: region.selection,
            replacement: res.replacement,
            source: 'edit',
            filePath,
          },
        });
      } catch (err) {
        set({ editBusy: false });
        if (err instanceof AiError) recordError(err.kind, err.message);
        else set({ lastError: 'Edit failed.' });
      }
    },

    async requestFix(diagnostic) {
      const editor = useEditorStore.getState();
      const { projectId } = editor;
      if (!get().errorFixesEnabled) return; // master toggle: no fix calls at all
      if (!projectId || diagnostic.line === undefined || !get().status.available) return;

      const rootFile = editor.projects.find((p) => p.id === projectId)?.rootFile ?? 'main.tex';
      const path = diagnostic.file ?? rootFile;
      const target =
        editor.files.find((f) => f.path === path) ??
        editor.files.find((f) => f.path.endsWith(`/${path}`)) ??
        editor.files.find((f) => f.path.endsWith(path));

      // Make sure the offending file is the active document before capturing.
      if (target && target.id !== editor.activeFileId) {
        await editor.openFile(target.id);
        editor.setActive(target.id);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }

      const region = editorController.captureRegionAroundLine(diagnostic.line);
      if (!region) {
        set({ lastError: 'Could not locate the offending region in the editor.' });
        return;
      }

      const logExcerpt = editor.diagnostics
        .filter((d) => d.severity === 'error')
        .slice(0, 6)
        .map((d) => `${d.file ?? path}${d.line !== undefined ? `:${d.line}` : ''}: ${d.message}`)
        .join('\n');

      set({ editBusy: true });
      try {
        const res = await api.aiFix(projectId, {
          filePath: path,
          region: region.selection,
          diagnostic: { message: diagnostic.message, ...(diagnostic.line !== undefined ? { line: diagnostic.line } : {}) },
          logExcerpt,
        });
        markOk();
        // The model declined rather than guessed — say so, show NO diff.
        if (res.noFix || !res.replacement.trim()) {
          set({ editBusy: false, fixNotice: `No confident fix for "${diagnostic.message.slice(0, 80)}" — nothing proposed.` });
          void get().suggestAllFixes(); // continue with the rest of a queued run
          return;
        }
        set({
          editBusy: false,
          fixNotice: null,
          pendingDiff: {
            from: region.from,
            to: region.to,
            original: region.selection,
            replacement: res.replacement,
            source: 'fix',
            filePath: path,
            ...(diagnostic.line !== undefined ? { anchorLine: diagnostic.line } : {}),
          },
        });
      } catch (err) {
        set({ editBusy: false, fixQueue: [] });
        if (err instanceof AiError) recordError(err.kind, err.message);
        else set({ lastError: 'Fix failed.' });
      }
    },

    // "Suggest fixes for all errors": queue every error diagnostic; offer ONE diff
    // at a time. Each is approved independently; after an accept the remaining
    // queued lines are re-validated (shifted by the applied change's line delta)
    // before the next region is captured.
    async suggestAllFixes() {
      if (!get().errorFixesEnabled || get().pendingDiff) return;
      let queue = get().fixQueue;
      if (queue.length === 0) {
        queue = useEditorStore
          .getState()
          .diagnostics.filter((d) => d.severity === 'error' && d.line !== undefined);
        if (queue.length === 0) return;
      }
      const [next, ...rest] = queue;
      set({ fixQueue: rest });
      await get().requestFix(next!);
    },

    setErrorFixesEnabled(v) {
      try {
        window.localStorage.setItem('latex-studio:error-fixes', String(v));
      } catch {
        /* ignore */
      }
      set({ errorFixesEnabled: v, ...(v ? {} : { fixQueue: [], fixNotice: null }) });
    },

    clearRecompileOffer: () => set({ offerRecompile: false }),

    openDiff(diff: PendingDiff) {
      set({ pendingDiff: diff });
    },

    acceptDiff() {
      const diff = get().pendingDiff;
      if (!diff) return;
      editorController.applyEdit(diff.from, diff.to, diff.original, diff.replacement);
      // A forced unverified/unknown step gets the amber "unverified" underline.
      if (diff.unverifiedMessage && diff.warnText) {
        editorController.markUnverified(diff.warnText, diff.unverifiedMessage);
      }
      set({ pendingDiff: null });

      if (diff.source === 'fix') {
        // Re-validate the queued fixes: shift line numbers below the applied
        // change by its line delta, so the next region is captured correctly.
        const delta = diff.replacement.split('\n').length - diff.original.split('\n').length;
        if (delta !== 0 && diff.anchorLine !== undefined) {
          set((s) => ({
            fixQueue: s.fixQueue.map((d) =>
              d.line !== undefined && d.line > diff.anchorLine! ? { ...d, line: d.line + delta } : d,
            ),
          }));
        }
        // Offer a manual recompile so the user can see whether the error cleared
        // (compile-on-save users already get one automatically via the save path).
        if (!useEditorStore.getState().compileOnSave) set({ offerRecompile: true });
        if (get().fixQueue.length > 0) void get().suggestAllFixes();
      }
    },

    rejectDiff() {
      const diff = get().pendingDiff;
      set({ pendingDiff: null });
      // Reject leaves the document untouched; a queued run simply moves on.
      if (diff?.source === 'fix' && get().fixQueue.length > 0) void get().suggestAllFixes();
    },

    insertAtCursor(text) {
      editorController.insertAtCursor(text);
    },
  };
});

function toUi(m: ChatMessage): UiChatMessage {
  return { id: m.id, role: m.role, content: m.content };
}
