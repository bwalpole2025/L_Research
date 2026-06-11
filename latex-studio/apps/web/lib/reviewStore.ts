'use client';

import { create } from 'zustand';
import { api, ApiError } from './api';
import { useEditorStore } from './store';
import { useAiStore } from './aiStore';
import type { AuditScope, FileOverrides, ReviewAxis, ReviewConfidence, ReviewFinding, ReviewTotals } from './types';

export type PdfMode = 'clean' | 'review' | 'literature';

const REVIEW_ON_COMPILE_KEY = 'latex-studio:review-on-compile';

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

interface ReviewState {
  findings: ReviewFinding[];
  totals: ReviewTotals | null;
  running: boolean;
  error: string | null;
  reviewPdfUrl: string | null;
  pdfMode: PdfMode;
  literaturePdfUrl: string | null;
  literatureTitle: string | null;
  viewLiterature: (url: string, title: string) => void;
  axisFilter: Set<ReviewAxis>;
  confidenceFilter: Set<ReviewConfidence>;
  reviewOnCompile: boolean;
  lastScope: AuditScope;

  runReview: (scope: AuditScope) => Promise<void>;
  jumpTo: (finding: ReviewFinding) => void;
  explain: (finding: ReviewFinding) => void;
  setPdfMode: (m: PdfMode) => void;
  toggleAxis: (a: ReviewAxis) => void;
  toggleConfidence: (c: ReviewConfidence) => void;
  setReviewOnCompile: (v: boolean) => void;
  visible: () => ReviewFinding[];
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  findings: [],
  totals: null,
  running: false,
  error: null,
  reviewPdfUrl: null,
  pdfMode: 'clean',
  literaturePdfUrl: null,
  literatureTitle: null,
  axisFilter: new Set<ReviewAxis>(),
  confidenceFilter: new Set<ReviewConfidence>(),
  reviewOnCompile: typeof window !== 'undefined' && window.localStorage.getItem(REVIEW_ON_COMPILE_KEY) === 'true',
  lastScope: 'project',

  async runReview(scope) {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ running: true, error: null, lastScope: scope });
    try {
      const res = await api.review(ed.projectId, {
        scope,
        ...(scope === 'file' && ed.activeFileId ? { fileId: ed.activeFileId } : {}),
        overrides: buildOverrides(),
      });
      set({
        findings: res.findings,
        totals: res.totals,
        running: false,
        reviewPdfUrl: res.reviewPdfUrl ? `/api${res.reviewPdfUrl}` : null,
        pdfMode: res.annotated ? 'review' : get().pdfMode,
      });
    } catch (err) {
      set({ running: false, error: err instanceof ApiError ? err.message : 'Review failed' });
    }
  },

  jumpTo(finding) {
    const ed = useEditorStore.getState();
    void ed.revealLocation(finding.file, finding.lineSpan.fromLine);
    void ed.locateInPdfAt(finding.file, finding.lineSpan.fromLine);
    if (get().reviewPdfUrl) set({ pdfMode: 'review' });
  },

  explain(finding) {
    const ai = useAiStore.getState();
    ai.setChatOpen(true);
    const lines = [
      `Explain this document-review finding and give a longer rationale.`,
      `Axis: ${finding.axis} (${finding.category}); confidence: ${finding.confidence}.`,
      `Location: ${finding.file}:${finding.lineSpan.fromLine}.`,
      `Finding: ${finding.message}`,
    ];
    if (finding.reference) lines.push(`Reference: [${finding.reference}]${finding.quotedSpan ? ` — "${finding.quotedSpan}"` : ''}.`);
    if (finding.counterexample) lines.push(`SymPy counterexample: ${JSON.stringify(finding.counterexample)}.`);
    if (finding.confidence.startsWith('llm')) lines.push('Note this is an unverified LLM judgement I must confirm against a real source.');
    void ai.sendMessage(lines.join('\n'));
  },

  setPdfMode: (pdfMode) => set({ pdfMode }),
  viewLiterature: (url, title) => set({ literaturePdfUrl: url, literatureTitle: title, pdfMode: 'literature' }),
  toggleAxis: (a) =>
    set((s) => {
      const next = new Set(s.axisFilter);
      next.has(a) ? next.delete(a) : next.add(a);
      return { axisFilter: next };
    }),
  toggleConfidence: (c) =>
    set((s) => {
      const next = new Set(s.confidenceFilter);
      next.has(c) ? next.delete(c) : next.add(c);
      return { confidenceFilter: next };
    }),
  setReviewOnCompile: (v) => {
    try {
      window.localStorage.setItem(REVIEW_ON_COMPILE_KEY, String(v));
    } catch {
      /* ignore */
    }
    set({ reviewOnCompile: v });
  },

  visible() {
    const { findings, axisFilter, confidenceFilter } = get();
    return findings.filter(
      (f) => (axisFilter.size === 0 || axisFilter.has(f.axis)) && (confidenceFilter.size === 0 || confidenceFilter.has(f.confidence)),
    );
  },
}));

// "Review on compile": when a compile produces a new PDF, re-run the review in
// the background (does not block the clean preview).
if (typeof window !== 'undefined') {
  let lastPdfUrl: string | null = null;
  useEditorStore.subscribe((state) => {
    if (state.pdfUrl !== lastPdfUrl) {
      lastPdfUrl = state.pdfUrl;
      if (state.pdfUrl && useReviewStore.getState().reviewOnCompile && !useReviewStore.getState().running) {
        void useReviewStore.getState().runReview(useReviewStore.getState().lastScope);
      }
    }
  });
}
