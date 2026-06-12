'use client';

import { create } from 'zustand';

/**
 * Settings for the deterministic (offline, no-model) LaTeX autocomplete.
 * Separate from completionStore (the AI ghost text) — the two features coexist
 * with a defined precedence: dropdown open → Tab serves the dropdown; otherwise
 * Tab serves the ghost.
 */

export interface AcSources {
  /** `\` command dictionary (static + document macros + package-implied). */
  commands: boolean;
  /** Word-triggered templates (figure, table, …) + argful command snippets. */
  snippets: boolean;
  /** \includegraphics{ → project image files. */
  graphics: boolean;
  /** \input/\include{ → project .tex files. */
  inputFiles: boolean;
  /** \cite family → bib keys. */
  citations: boolean;
  /** \ref family → \label values. */
  labels: boolean;
  /** \begin/\end{ → environments. */
  environments: boolean;
  /** \usepackage/\documentclass{ → package/class lists. */
  packages: boolean;
}

interface AcState {
  enabled: boolean;
  sources: AcSources;
  setEnabled: (v: boolean) => void;
  setSource: (k: keyof AcSources, v: boolean) => void;
}

const KEY = 'latex-studio:autocomplete';

const DEFAULT_SOURCES: AcSources = {
  commands: true,
  snippets: true,
  graphics: true,
  inputFiles: true,
  citations: true,
  labels: true,
  environments: true,
  packages: true,
};

function load(): { enabled: boolean; sources: AcSources } {
  if (typeof window === 'undefined') return { enabled: true, sources: DEFAULT_SOURCES };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { enabled: true, sources: DEFAULT_SOURCES };
    const parsed = JSON.parse(raw) as Partial<{ enabled: boolean; sources: Partial<AcSources> }>;
    return {
      enabled: parsed.enabled ?? true,
      sources: { ...DEFAULT_SOURCES, ...(parsed.sources ?? {}) },
    };
  } catch {
    return { enabled: true, sources: DEFAULT_SOURCES };
  }
}

function persist(state: { enabled: boolean; sources: AcSources }): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const useAutocompleteStore = create<AcState>((set, get) => ({
  ...load(),
  setEnabled(v) {
    set({ enabled: v });
    persist({ enabled: v, sources: get().sources });
  },
  setSource(k, v) {
    const sources = { ...get().sources, [k]: v };
    set({ sources });
    persist({ enabled: get().enabled, sources });
  },
}));
