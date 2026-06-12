'use client';

import { create } from 'zustand';
import { api, ApiError, streamExplainStep } from './api';
import { useEditorStore } from './store';
import { editorController } from './editorController';
import type {
  AuditScope,
  FileOverrides,
  MathAuditBlock,
  MathAuditReport,
  OutlineNode,
  PreSubmitSummary,
  ProseCheckReport,
  ProseDiagnostic,
  ProseRuleToggles,
  XrefReport,
} from './types';

export type BottomTab = 'problems' | 'maths' | 'prose' | 'refs' | 'coderive' | 'review' | 'python';
export type LeftTab = 'files' | 'outline' | 'literature';

const RULES_KEY = 'latex-studio:prose-rules';
const DEFAULT_RULES: ProseRuleToggles = {
  spelling: true,
  enGbConsistency: true,
  hyphenation: true,
  doubleSpace: true,
  quotes: true,
  languageTool: false,
};

function loadRules(): ProseRuleToggles {
  if (typeof window === 'undefined') return DEFAULT_RULES;
  try {
    const raw = window.localStorage.getItem(RULES_KEY);
    return raw ? { ...DEFAULT_RULES, ...(JSON.parse(raw) as Partial<ProseRuleToggles>) } : DEFAULT_RULES;
  } catch {
    return DEFAULT_RULES;
  }
}

/** Live content of open buffers (so checks reflect unsaved edits). */
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

interface ThesisState {
  bottomTab: BottomTab;
  leftTab: LeftTab;

  auditReport: MathAuditReport | null;
  auditing: boolean;
  auditError: string | null;
  explanations: Record<string, string>;
  explaining: string | null;

  proseReport: ProseCheckReport | null;
  prosing: boolean;
  proseError: string | null;
  proseRules: ProseRuleToggles;
  customWords: string[];

  outline: OutlineNode[];
  outlineLoading: boolean;
  xref: XrefReport | null;

  preSubmit: PreSubmitSummary | null;
  preSubmitting: boolean;
  preSubmitOpen: boolean;

  setBottomTab: (t: BottomTab) => void;
  setLeftTab: (t: LeftTab) => void;
  runAudit: (scope: AuditScope) => Promise<void>;
  explainStep: (block: MathAuditBlock) => Promise<void>;
  runProse: (scope: AuditScope) => Promise<void>;
  setProseRule: (rule: keyof ProseRuleToggles, value: boolean) => void;
  loadDictionary: () => Promise<void>;
  addToDictionary: (word: string) => Promise<void>;
  applyProseFix: (diag: ProseDiagnostic, suggestion: string) => Promise<void>;
  refreshOutline: () => Promise<void>;
  refreshXref: () => Promise<void>;
  openPreSubmit: () => void;
  closePreSubmit: () => void;
  runPreSubmit: () => Promise<void>;
}

export const useThesisStore = create<ThesisState>((set, get) => ({
  bottomTab: 'problems',
  leftTab: 'files',

  auditReport: null,
  auditing: false,
  auditError: null,
  explanations: {},
  explaining: null,

  proseReport: null,
  prosing: false,
  proseError: null,
  proseRules: loadRules(),
  customWords: [],

  outline: [],
  outlineLoading: false,
  xref: null,

  preSubmit: null,
  preSubmitting: false,
  preSubmitOpen: false,

  setBottomTab: (bottomTab) => set({ bottomTab }),
  setLeftTab: (leftTab) => set({ leftTab }),

  async runAudit(scope) {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ auditing: true, auditError: null, bottomTab: 'maths' });
    try {
      const report = await api.auditMaths(ed.projectId, {
        scope,
        ...(scope === 'file' && ed.activeFileId ? { fileId: ed.activeFileId } : {}),
        overrides: buildOverrides(),
      });
      set({ auditReport: report, auditing: false });
      // Surface unverified equations as violet highlights in the compiled PDF.
      void useEditorStore.getState().setCheckerPdfFlags(report.blocks);
    } catch (err) {
      set({ auditing: false, auditError: err instanceof ApiError ? err.message : 'Audit failed' });
    }
  },

  async explainStep(block) {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    // Reset to empty so tokens stream in live (and any prior text clears).
    set((s) => ({ explaining: block.id, explanations: { ...s.explanations, [block.id]: '' } }));
    await streamExplainStep(
      ed.projectId,
      {
        latex: block.latex,
        file: block.file,
        line: block.lineStart,
        overrides: buildOverrides(),
        ...(block.method ? { method: block.method } : {}),
        ...(block.counterexample ? { counterexample: block.counterexample } : {}),
      },
      {
        onToken: (t) =>
          set((s) => ({ explanations: { ...s.explanations, [block.id]: (s.explanations[block.id] ?? '') + t } })),
        onDone: () => set({ explaining: null }),
        onError: (_kind, message) =>
          set((s) => ({ explanations: { ...s.explanations, [block.id]: `(${message})` }, explaining: null })),
      },
    );
  },

  async runProse(scope) {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ prosing: true, proseError: null, bottomTab: 'prose' });
    try {
      const report = await api.proseCheck(ed.projectId, {
        scope,
        ...(scope === 'file' && ed.activeFileId ? { fileId: ed.activeFileId } : {}),
        rules: get().proseRules,
        overrides: buildOverrides(),
      });
      set({ proseReport: report, prosing: false });
    } catch (err) {
      set({ prosing: false, proseError: err instanceof ApiError ? err.message : 'Prose check failed' });
    }
  },

  setProseRule(rule, value) {
    set((s) => {
      const proseRules = { ...s.proseRules, [rule]: value };
      try {
        window.localStorage.setItem(RULES_KEY, JSON.stringify(proseRules));
      } catch {
        /* ignore */
      }
      return { proseRules };
    });
  },

  async loadDictionary() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    try {
      const { customWords } = await api.getDictionary(ed.projectId);
      set({ customWords });
    } catch {
      /* ignore */
    }
  },

  async addToDictionary(word) {
    const ed = useEditorStore.getState();
    if (!ed.projectId || !word.trim()) return;
    try {
      const { customWords } = await api.updateDictionary(ed.projectId, word.trim());
      set({ customWords });
      // Drop now-allowed diagnostics for that word without a full recheck.
      set((s) =>
        s.proseReport
          ? { proseReport: { ...s.proseReport, diagnostics: s.proseReport.diagnostics.filter((d) => d.word !== word) } }
          : {},
      );
    } catch {
      /* ignore */
    }
  },

  async applyProseFix(diag, suggestion) {
    const ed = useEditorStore.getState();
    const file = ed.files.find((f) => f.path === diag.file);
    if (file && file.id !== ed.activeFileId) {
      await ed.openFile(file.id);
      ed.setActive(file.id);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const ok = editorController.replaceWordAt(diag.line, diag.column, diag.endColumn ?? diag.column, suggestion, diag.word);
    if (ok) {
      set((s) =>
        s.proseReport
          ? {
              proseReport: {
                ...s.proseReport,
                diagnostics: s.proseReport.diagnostics.filter(
                  (d) => !(d.file === diag.file && d.line === diag.line && d.column === diag.column),
                ),
              },
            }
          : {},
      );
    }
  },

  async refreshOutline() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ outlineLoading: true });
    try {
      const res = await api.getOutline(ed.projectId, buildOverrides());
      set({ outline: res.roots, outlineLoading: false });
    } catch {
      set({ outlineLoading: false });
    }
  },

  async refreshXref() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    try {
      const xref = await api.getXref(ed.projectId, buildOverrides());
      set({ xref });
    } catch {
      /* ignore */
    }
  },

  openPreSubmit() {
    set({ preSubmitOpen: true });
    void get().runPreSubmit();
  },
  closePreSubmit() {
    set({ preSubmitOpen: false });
  },

  async runPreSubmit() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ preSubmitting: true });
    try {
      const summary = await api.preSubmit(ed.projectId, buildOverrides());
      set({ preSubmit: summary, preSubmitting: false });
    } catch (err) {
      set({ preSubmitting: false });
      window.alert(err instanceof ApiError ? err.message : 'Pre-submit failed');
    }
  },
}));
