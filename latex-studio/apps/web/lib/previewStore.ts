'use client';

import { create } from 'zustand';

/** Settings for the instant (no-compile) previews + the Code ⇄ Visual toggle. */
interface PreviewState {
  /** Live KaTeX rendering of the equation at the cursor. */
  mathPreview: boolean;
  setMathPreview: (v: boolean) => void;
  /** Which editor surface is showing: LaTeX source or the visual editor. */
  editorView: 'code' | 'visual';
  setEditorView: (v: 'code' | 'visual') => void;
}

const KEY = 'latex-studio:math-preview';

export const usePreviewStore = create<PreviewState>((set) => ({
  editorView: 'code',
  setEditorView: (editorView) => set({ editorView }),
  mathPreview: typeof window === 'undefined' || window.localStorage.getItem(KEY) !== 'false',
  setMathPreview(v) {
    try {
      window.localStorage.setItem(KEY, String(v));
    } catch {
      /* ignore */
    }
    set({ mathPreview: v });
  },
}));
