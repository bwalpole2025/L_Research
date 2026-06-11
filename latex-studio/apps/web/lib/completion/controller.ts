'use client';

import type { EditorView } from '@codemirror/view';
import { api, AiError, completeCode } from '../api';
import { useEditorStore } from '../store';
import { useCompletionStore } from '../completionStore';
import {
  addWarning,
  applySuggestion,
  currentSuggestion,
  type InlineSuggestConfig,
} from '@/components/editor/inlineSuggest';
import { CompletionScheduler } from './scheduler';
import { detectMode } from './mode';
import { formatCounterexample, mathContent, rhsOf } from './mathStep';
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
        return completeCode(pid, req, signal);
      },
      getConfig: () => useCompletionStore.getState().config(),
      onSuggest: (text, ctx) => {
        const v = this.view;
        if (!v) return;
        // Discard if the cursor moved since the request was issued.
        if (v.state.selection.main.head !== ctx.pos) return;
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

  /** The config wired into the inlineSuggestion() extension. */
  get config(): InlineSuggestConfig {
    return {
      onDocChange: (view) => {
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
