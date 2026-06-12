'use client';

/**
 * IN-EDITOR COMPILE MARKERS — gutter dots + inline squiggles for the
 * three-tier diagnostics (red error / orange important / yellow minor), via
 * @codemirror/lint. Markers are re-dispatched from each fresh compile, so they
 * persist across recompiles (mapped through edits by the lint field) and clear
 * the moment a diagnostic no longer appears. Hover shows the message and — for
 * red/orange — a "Fix with Claude" action that flows through the existing
 * diff-and-accept approval. Clicking the lint gutter reveals the Problems panel.
 */

import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { Diagnostic } from '@latex-studio/shared';
import { useAiStore } from '../../lib/aiStore';
import { useThesisStore } from '../../lib/thesisStore';

/** Tier → CodeMirror lint severity (drives both squiggle and gutter classes).
 *  The grey INFO tier never marks the editor. */
const CM_SEVERITY: Partial<Record<Diagnostic['severity'], CmDiagnostic['severity']>> = {
  error: 'error',
  'warning-important': 'warning',
  'warning-minor': 'info',
};

/** Build CodeMirror lint diagnostics for the ACTIVE file from compile diags. */
export function toCmDiagnostics(view: EditorView, diags: Diagnostic[]): CmDiagnostic[] {
  const doc = view.state.doc;
  const out: CmDiagnostic[] = [];
  for (const d of diags) {
    const sev = CM_SEVERITY[d.severity];
    if (!sev || d.line === undefined) continue;
    const lineNo = Math.max(1, Math.min(doc.lines, d.line));
    const line = doc.line(lineNo);
    let from = line.from;
    let to = line.to;
    if (d.column !== undefined && d.column > 0 && line.from + d.column - 1 < line.to) {
      from = line.from + d.column - 1;
      const word = /^[\w\\]+/.exec(doc.sliceString(from, Math.min(line.to, from + 40)));
      to = word ? from + word[0].length : line.to;
    }
    const fixable = d.severity === 'error' || d.severity === 'warning-important';
    const cm: CmDiagnostic = {
      from,
      to: to > from ? to : line.to,
      severity: sev,
      message: d.message,
      ...(d.category ? { source: d.category } : {}),
    };
    if (fixable) {
      const ai = useAiStore.getState();
      if (ai.status.available && ai.errorFixesEnabled) {
        cm.actions = [
          {
            name: 'Fix with Claude',
            apply: () => void useAiStore.getState().requestFix(d),
          },
        ];
      }
    }
    out.push(cm);
  }
  return out;
}

/** Dispatch the current compile diagnostics into a view (idempotent). */
export function applyLintDiagnostics(view: EditorView, diags: Diagnostic[]): void {
  view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view, diags)));
}

const lintTheme = EditorView.baseTheme({
  // Squiggles: red / orange / yellow per tier.
  '.cm-lintRange-error': { backgroundImage: squiggle('#ef4444') },
  '.cm-lintRange-warning': { backgroundImage: squiggle('#f97316') },
  '.cm-lintRange-info': { backgroundImage: squiggle('#eab308') },
  // Gutter markers (lintGutter shows the worst tier per line).
  '.cm-lint-marker-error': { content: dot('#ef4444') },
  '.cm-lint-marker-warning': { content: dot('#f97316') },
  '.cm-lint-marker-info': { content: dot('#eab308') },
  '.cm-gutter-lint .cm-gutterElement': { cursor: 'pointer', padding: '0 2px' },
  '.cm-tooltip-lint': { fontSize: '12px', maxWidth: '46em' },
});

function squiggle(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><path d="m0 3 l2 -2 l1 0 l2 2 l1 0" stroke="${color}" fill="none" stroke-width=".7"/></svg>`;
  return `url('data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(svg) : ''}')`;
}

function dot(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><circle cx="4" cy="4" r="3.5" fill="${color}"/></svg>`;
  return `url('data:image/svg+xml;base64,${typeof btoa === 'function' ? btoa(svg) : ''}')`;
}

/** Clicking a lint gutter marker reveals the Problems panel entry list. */
const gutterClickOpensPanel = EditorView.domEventHandlers({
  mousedown: (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.cm-gutter-lint')) {
      useThesisStore.getState().setBottomTab('problems');
    }
    return false; // never swallow the event
  },
});

export function diagnosticsLint(): Extension {
  return [lintGutter({ hoverTime: 120 }), lintTheme, gutterClickOpensPanel];
}
