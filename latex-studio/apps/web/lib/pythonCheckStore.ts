'use client';

import { create } from 'zustand';
import type { Diagnostic, PythonCheckResponse } from '@latex-studio/shared';
import { api } from './api';
import { useEditorStore } from './store';
import { useThesisStore } from './thesisStore';

/**
 * AI + deterministic Python error checking (on-demand). Diagnostics are kept per
 * project-relative file path so the active .py file's results surface both as
 * inline lint squiggles (EditorPane → CodeEditor) and as a list in the Python
 * output tab. The compile-diagnostics store stays LaTeX-only.
 */

interface PythonCheckState {
  byFile: Record<string, Diagnostic[]>;
  checking: boolean;
  error: string | null;
  lastCheckedPath: string | null;
  lastResult: PythonCheckResponse | null;

  /** Check the active .py file (sends its live buffer as an override). */
  check: () => Promise<void>;
  clearFile: (path: string) => void;
}

export const usePythonCheckStore = create<PythonCheckState>((set) => ({
  byFile: {},
  checking: false,
  error: null,
  lastCheckedPath: null,
  lastResult: null,

  async check() {
    const ed = useEditorStore.getState();
    const projectId = ed.projectId;
    const fileId = ed.activeFileId;
    const file = ed.files.find((f) => f.id === fileId);
    if (!projectId || !file || !file.path.toLowerCase().endsWith('.py')) {
      set({ error: 'Open a .py file to check.' });
      useThesisStore.getState().setBottomTab('python');
      return;
    }
    const path = file.path;
    const content = ed.contents[file.id]; // live buffer; may be unset if never edited
    set({ checking: true, error: null });
    useThesisStore.getState().setBottomTab('python'); // surface results
    try {
      // Send the live buffer as an override so unsaved edits are checked; if it
      // isn't loaded, omit it and let the server check the saved content.
      const res = await api.pythonCheck(projectId, { path, ...(content ? { overrides: { [path]: content } } : {}) });
      set((s) => ({
        byFile: { ...s.byFile, [path]: res.diagnostics },
        checking: false,
        lastCheckedPath: path,
        lastResult: res,
      }));
    } catch (err) {
      set({ checking: false, error: err instanceof Error ? err.message : 'Python check failed.' });
    }
  },

  clearFile(path) {
    set((s) => {
      if (!(path in s.byFile)) return s;
      const next = { ...s.byFile };
      delete next[path];
      return { byFile: next };
    });
  },
}));
