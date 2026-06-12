'use client';

import type { EditorView } from '@codemirror/view';
import { completionStatus } from '@codemirror/autocomplete';
import { api, AiError, completeCode } from '../api';
import { useEditorStore } from '../store';
import { useCompletionStore } from '../completionStore';
import {
  addWarning,
  applySuggestion,
  currentSuggestion,
  type InlineSuggestConfig,
} from '@/components/editor/inlineSuggest';
import { setPrediction, type PredictConfig } from '@/components/editor/predictBlock';
import { CompletionScheduler } from './scheduler';
import { detectMode } from './mode';
import { formatCounterexample, mathContent, rhsOf } from './mathStep';
import { computePosition } from './position';
import { useDocumentModelStore } from '../documentModelStore';
import type { CompletionRequestContext } from './types';

const PREFIX_CHARS = 8000; // ~2000 tokens
const SUFFIX_CHARS = 2000; // ~500 tokens

/**
 * Bridges the framework-agnostic CompletionScheduler to a CodeMirror view:
 * builds request context, applies/clears the ghost suggestion, records stats,
 * handles credit-degrade, and fires the fire-and-forget math verification.
 */
export class CompletionController {
  private view: EditorView | null = null;
  readonly scheduler: CompletionScheduler;

  constructor(private readonly getProjectId: () => string | null = () => useEditorStore.getState().projectId) {
    this.scheduler = new CompletionScheduler({
      fetch: (req, signal) => {
        const pid = this.getProjectId();
        if (!pid) return Promise.reject(new Error('no project'));
        // Document-aware: include the CACHED card + cheap position (never a rebuild here).
        const dm = useDocumentModelStore.getState();
        if (dm.enabled && dm.card) {
          const position = this.view ? computePosition(this.view) : undefined;
          return completeCode(pid, { ...req, contextCard: dm.card, ...(position ? { position } : {}) }, signal);
        }
        return completeCode(pid, req, signal);
      },
      getConfig: () => useCompletionStore.getState().config(),
      onSuggest: (text, ctx) => {
        const v = this.view;
        if (!v) return;
        // Discard if the cursor moved since the request was issued.
        if (v.state.selection.main.head !== ctx.pos) return;
        // Precedence: while the autocomplete dropdown is open it owns the
        // screen — drop the arrival instead of racing its state.
        if (completionStatus(v.state) !== null) return;
        applySuggestion(v, { from: ctx.pos, text, mode: ctx.mode });
      },
      onClear: () => {
        if (this.view) applySuggestion(this.view, null);
      },
      onResult: (res) => useCompletionStore.getState().recordResult(res),
      onError: (err) => this.handleError(err),
    });
  }

  setView(view: EditorView | null): void {
    this.view = view;
  }

  /** Config for the multi-line "predict next" ghost block. */
  get predictConfig(): PredictConfig {
    return {
      onRegenerate: () => void this.triggerPredict(),
      onAccepted: (text, from, kind) => {
        if (kind === 'maths') void this.verifyPredictedSteps(from, text);
      },
    };
  }

  /** Trigger a multi-granularity "predict next" (user-action; may take longer). */
  async triggerPredict(): Promise<void> {
    const view = this.view;
    const pid = this.getProjectId();
    const ed = useEditorStore.getState();
    if (!view || !pid || !ed.activeFileId) return;
    const dm = useDocumentModelStore.getState();
    const cursor = view.state.selection.main.head;
    const cursorLine = view.state.doc.lineAt(cursor).number;
    const position = computePosition(view);
    const activePath = ed.files.find((f) => f.id === ed.activeFileId)?.path;
    dm.setPredicting(true);
    try {
      const res = await api.predictNext(pid, {
        fileId: ed.activeFileId,
        cursorLine,
        granularity: dm.granularityDefault,
        ...(dm.card ? { card: dm.card } : {}),
        ...(position ? { position } : {}),
        model: dm.predictModel,
        ...(activePath ? { overrides: { [activePath]: view.state.doc.toString() } } : {}),
      });
      if (res.prediction.trim() && this.view && this.view.state.selection.main.head === cursor) {
        setPrediction(this.view, { from: cursor, text: res.prediction, kind: res.kind });
      }
    } catch (err) {
      this.handleError(err);
    } finally {
      dm.setPredicting(false);
    }
  }

  /** Verify each predicted maths step against the previous step (Phase 5S hook, extended). */
  private async verifyPredictedSteps(from: number, text: string): Promise<void> {
    const view = this.view;
    if (!view) return;
    const doc = view.state.doc;
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(Math.min(from + Math.max(0, text.length - 1), doc.length)).number;
    const { macros, assumptions } = useEditorStore.getState();
    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      const curRhs = rhsOf(line.text);
      if (!curRhs) continue;
      let prevRhs: string | null = null;
      for (let p = n - 1; p >= 1; p--) {
        const t = doc.line(p).text;
        if (/\\(begin|end)\{/.test(t) && !mathContent(t)) break;
        if (mathContent(t)) {
          prevRhs = rhsOf(t);
          if (prevRhs) break;
        }
      }
      if (!prevRhs) continue;
      try {
        const res = await api.checkEquivalent({ lhs: prevRhs, rhs: curRhs, assumptions, macros });
        if (res.equivalent === false && this.view) {
          const detail = res.counterexample ? ` — ${formatCounterexample(res.counterexample)}` : '';
          addWarning(this.view, line.from, line.to, `Unverified — may not equal the previous step${detail}`);
        }
      } catch {
        /* never blocks insertion */
      }
    }
  }

  /** The config wired into the inlineSuggestion() extension. */
  get config(): InlineSuggestConfig {
    return {
      onDocChange: (view) => {
        // Slow-debounce the document-model rebuild (NOT per keystroke — the call is throttled).
        useDocumentModelStore.getState().scheduleRefresh();
        // Typing-through kept a suggestion → no network call (speculative reuse).
        if (currentSuggestion(view)) return;
        this.scheduler.schedule(this.buildContext(view));
      },
      onAccept: (text, from, mode) => {
        useCompletionStore.getState().recordAccept();
        this.scheduler.clearRejection();
        if (mode === 'display-align' || mode === 'inline-math') void this.verifyMath(from, text);
      },
      onReject: (pos) => {
        useCompletionStore.getState().recordReject();
        this.scheduler.recordRejection(pos);
      },
      onAlternative: (view) => this.scheduler.alternative(this.buildContext(view)),
    };
  }

  private buildContext(view: EditorView): CompletionRequestContext {
    const pos = view.state.selection.main.head;
    const doc = view.state.doc;
    const before = doc.sliceString(0, pos);
    const after = doc.sliceString(pos);
    const { mode, inComment, midWord } = detectMode(doc.toString(), pos);
    return {
      prefix: before.slice(-PREFIX_CHARS),
      suffix: after.slice(0, SUFFIX_CHARS),
      pos,
      mode,
      inComment,
      midWord,
    };
  }

  private handleError(err: unknown): void {
    if (err instanceof AiError && (err.kind === 'credit_exhausted' || err.kind === 'auth' || err.kind === 'unavailable')) {
      useCompletionStore.getState().pause(err.kind);
    }
  }

  /** Fire-and-forget: verify a completed math step against the previous step. */
  private async verifyMath(from: number, text: string): Promise<void> {
    const view = this.view;
    const projectId = this.getProjectId();
    if (!view || !projectId) return;
    const doc = view.state.doc;
    const endPos = Math.min(from + text.length, doc.length);
    const curLine = doc.lineAt(endPos);
    const curRhs = rhsOf(curLine.text);
    if (!curRhs) return; // only LHS = RHS steps

    let prevRhs: string | null = null;
    for (let n = curLine.number - 1; n >= 1; n--) {
      const t = doc.line(n).text;
      if (/\\(begin|end)\{/.test(t)) break;
      if (mathContent(t)) {
        prevRhs = rhsOf(t);
        if (prevRhs) break;
      }
    }
    if (!prevRhs) return;

    try {
      const { macros, assumptions } = useEditorStore.getState();
      const res = await api.checkEquivalent({ lhs: prevRhs, rhs: curRhs, assumptions, macros });
      if (res.equivalent === false && this.view) {
        const detail = res.counterexample ? ` — ${formatCounterexample(res.counterexample)}` : '';
        addWarning(this.view, curLine.from, curLine.to, `May not equal the previous step${detail}`);
      }
    } catch {
      /* verification never blocks insertion */
    }
  }
}
