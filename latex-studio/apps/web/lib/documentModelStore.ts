'use client';

import { create } from 'zustand';
import { api } from './api';
import { useEditorStore } from './store';
import { editorController } from './editorController';
import type { FileOverrides, PredictGranularity } from './types';

export type IncludeLevel = 'card' | 'card+recent' | 'card+excerpt';

const KEYS = {
  enabled: 'latex-studio:docaware-enabled',
  level: 'latex-studio:docaware-level',
  predictModel: 'latex-studio:predict-model',
  granularity: 'latex-studio:predict-granularity',
};

function read(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return window.localStorage.getItem(key) ?? fallback;
}

function buildOverrides(): FileOverrides {
  const ed = useEditorStore.getState();
  const overrides: FileOverrides = {};
  for (const id of ed.openFileIds) {
    const path = ed.files.find((f) => f.id === id)?.path;
    const content = ed.contents[id];
    if (path && content !== undefined) overrides[path] = content;
  }
  return overrides;
}

const REFRESH_DEBOUNCE_MS = 3000;

interface DocModelState {
  enabled: boolean;
  includeLevel: IncludeLevel;
  predictModel: string;
  granularityDefault: PredictGranularity;
  card: string | null;
  notationSymbols: string[];
  builtAt: number | null;
  building: boolean;
  predicting: boolean;
  setPredicting: (v: boolean) => void;
  /** Registered by the active editor so any UI can trigger "predict next". */
  predictTrigger: (() => void) | null;
  setPredictTrigger: (fn: (() => void) | null) => void;

  setEnabled: (v: boolean) => void;
  setIncludeLevel: (v: IncludeLevel) => void;
  setPredictModel: (v: string) => void;
  setGranularityDefault: (v: PredictGranularity) => void;
  /** Debounced (slow) trigger — safe to call on every input event; the actual build is throttled. */
  scheduleRefresh: () => void;
  /** The card-build function — fetches + caches. NOT called per keystroke. */
  refresh: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useDocumentModelStore = create<DocModelState>((set, get) => ({
  enabled: read(KEYS.enabled, 'true') !== 'false',
  includeLevel: (read(KEYS.level, 'card+recent') as IncludeLevel),
  predictModel: read(KEYS.predictModel, 'claude-sonnet-4-6'),
  granularityDefault: (read(KEYS.granularity, 'auto') as PredictGranularity),
  card: null,
  notationSymbols: [],
  builtAt: null,
  building: false,
  predicting: false,
  setPredicting: (predicting) => set({ predicting }),
  predictTrigger: null,
  setPredictTrigger: (predictTrigger) => set({ predictTrigger }),

  setEnabled(v) {
    try {
      window.localStorage.setItem(KEYS.enabled, String(v));
    } catch {
      /* ignore */
    }
    set({ enabled: v });
    if (v) get().scheduleRefresh();
    else set({ card: null, notationSymbols: [] });
  },
  setIncludeLevel(v) {
    try {
      window.localStorage.setItem(KEYS.level, v);
    } catch {
      /* ignore */
    }
    set({ includeLevel: v });
  },
  setPredictModel(v) {
    try {
      window.localStorage.setItem(KEYS.predictModel, v);
    } catch {
      /* ignore */
    }
    set({ predictModel: v });
  },
  setGranularityDefault(v) {
    try {
      window.localStorage.setItem(KEYS.granularity, v);
    } catch {
      /* ignore */
    }
    set({ granularityDefault: v });
  },

  scheduleRefresh() {
    if (!get().enabled) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().refresh();
    }, REFRESH_DEBOUNCE_MS);
  },

  async refresh() {
    const ed = useEditorStore.getState();
    if (!ed.projectId || !get().enabled) return;
    const cursorFile = ed.files.find((f) => f.id === ed.activeFileId)?.path;
    const cursor = editorController.getCursor();
    set({ building: true });
    try {
      const res = await api.documentModel(ed.projectId, {
        ...(cursorFile ? { cursorFile } : {}),
        ...(cursor ? { cursorLine: cursor.line } : {}),
        overrides: buildOverrides(),
      });
      set({ card: res.card, notationSymbols: res.notationSymbols, builtAt: Date.now(), building: false });
    } catch {
      set({ building: false });
    }
  },
}));
