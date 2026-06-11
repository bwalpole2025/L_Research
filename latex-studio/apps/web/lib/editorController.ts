import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { addWarning } from '../components/editor/inlineSuggest';

/**
 * A tiny singleton bridge to the live CodeMirror view, so non-editor code
 * (SyncTeX "locate in PDF", math "check derivation") can read the cursor and
 * the surrounding equation region without prop drilling. The CodeEditor
 * registers/unregisters its view here.
 */
let currentView: EditorView | null = null;

const ENV = '(?:align\\*?|aligned|gather\\*?|gathered|multline\\*?|eqnarray\\*?|equation\\*?|flalign\\*?|split|dmath\\*?)';
const ENV_BEGIN = new RegExp(`\\\\begin\\{${ENV}\\}`);
const ENV_END = new RegExp(`\\\\end\\{${ENV}\\}`);

function isContentLine(text: string): boolean {
  let t = text.trim();
  if (!t) return false;
  if (/^\\(?:begin|end)\b/.test(t)) return false;
  t = t
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/\\\\\*?/g, '')
    .replace(/&/g, '')
    .trim();
  return t.length > 0;
}

function stripBreak(text: string): string {
  return text.replace(/\\\\\*?(?:\s*\[[^\]]*\])?\s*$/, '').trim();
}

export interface DerivationRegion {
  steps: { latex: string; line: number }[];
}

/** A captured region for inline edit (Cmd+K): exact range + selection + context. */
export interface EditRegion {
  from: number;
  to: number;
  selection: string;
  /** ~80 surrounding lines (read-only context for the model). */
  context: string;
  /** 1-based start line. */
  line: number;
}

/** Lines of context to include on each side of the selection for inline edit. */
const EDIT_CONTEXT_LINES = 40;

export const editorController = {
  setView(view: EditorView | null): void {
    currentView = view;
  },

  /** 1-based line + column of the primary cursor, or null if no editor. */
  getCursor(): { line: number; column: number } | null {
    if (!currentView) return null;
    const head = currentView.state.selection.main.head;
    const line = currentView.state.doc.lineAt(head);
    return { line: line.number, column: head - line.from + 1 };
  },

  /** The selected text (empty string when there's no selection). */
  getSelectionText(): string {
    if (!currentView) return '';
    const sel = currentView.state.selection.main;
    return currentView.state.doc.sliceString(sel.from, sel.to);
  },

  /** 1-based line range covered by the primary selection (cursor → single line). */
  getSelectionLines(): { fromLine: number; toLine: number } | null {
    if (!currentView) return null;
    const sel = currentView.state.selection.main;
    const doc = currentView.state.doc;
    return { fromLine: doc.lineAt(sel.from).number, toLine: doc.lineAt(sel.to).number };
  },

  /** The text of a 1-based line (empty string if out of range). */
  lineText(line: number): string {
    if (!currentView) return '';
    const doc = currentView.state.doc;
    if (line < 1 || line > doc.lines) return '';
    return doc.line(line).text;
  },

  /** Document offsets {from, to} of a 1-based line, or null. */
  lineRange(line: number): { from: number; to: number } | null {
    if (!currentView) return null;
    const doc = currentView.state.doc;
    if (line < 1 || line > doc.lines) return null;
    const l = doc.line(line);
    return { from: l.from, to: l.to };
  },

  /** Amber "unverified" underline + tooltip over the first occurrence of `stepText`. */
  markUnverified(stepText: string, message: string): void {
    if (!currentView || !stepText.trim()) return;
    const idx = currentView.state.doc.toString().indexOf(stepText);
    if (idx === -1) return;
    addWarning(currentView, idx, idx + stepText.length, message);
  },

  /**
   * Capture the region for an inline edit. Uses the selection, or — when empty —
   * the current line. Returns the exact offsets so Accept can apply precisely.
   */
  captureEditRegion(): EditRegion | null {
    if (!currentView) return null;
    const doc = currentView.state.doc;
    const sel = currentView.state.selection.main;
    let { from, to } = sel;
    if (from === to) {
      const ln = doc.lineAt(from);
      from = ln.from;
      to = ln.to;
    }
    if (from === to) return null; // empty doc / empty line

    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    const ctxFrom = Math.max(1, startLine - EDIT_CONTEXT_LINES);
    const ctxTo = Math.min(doc.lines, endLine + EDIT_CONTEXT_LINES);
    return {
      from,
      to,
      selection: doc.sliceString(from, to),
      context: doc.sliceString(doc.line(ctxFrom).from, doc.line(ctxTo).to),
      line: startLine,
    };
  },

  /**
   * Capture the region to fix around a 1-based line: the enclosing
   * \begin{..}..\end{..} block if the line is inside one, else a small window.
   */
  captureRegionAroundLine(line: number): EditRegion | null {
    if (!currentView) return null;
    const doc = currentView.state.doc;
    const total = doc.lines;
    const center = Math.min(Math.max(1, line), total);

    let begin = -1;
    let end = -1;
    for (let n = center; n >= 1; n--) {
      if (/\\begin\{/.test(doc.line(n).text)) {
        begin = n;
        break;
      }
      if (n !== center && /\\end\{/.test(doc.line(n).text)) break;
    }
    for (let n = center; n <= total; n++) {
      if (/\\end\{/.test(doc.line(n).text)) {
        end = n;
        break;
      }
      if (n !== center && /\\begin\{/.test(doc.line(n).text)) break;
    }

    let fromLine: number;
    let toLine: number;
    if (begin !== -1 && end !== -1 && begin <= end) {
      fromLine = begin;
      toLine = end;
    } else {
      fromLine = Math.max(1, center - 6);
      toLine = Math.min(total, center + 6);
    }

    const from = doc.line(fromLine).from;
    const to = doc.line(toLine).to;
    const ctxFrom = Math.max(1, fromLine - EDIT_CONTEXT_LINES);
    const ctxTo = Math.min(total, toLine + EDIT_CONTEXT_LINES);
    return {
      from,
      to,
      selection: doc.sliceString(from, to),
      context: doc.sliceString(doc.line(ctxFrom).from, doc.line(ctxTo).to),
      line: fromLine,
    };
  },

  /**
   * Apply an accepted replacement. Reconciles against the captured original in
   * case the document shifted between capture and accept.
   */
  applyEdit(from: number, to: number, original: string, replacement: string): boolean {
    if (!currentView) return false;
    const doc = currentView.state.doc;
    const f = Math.min(from, doc.length);
    const t = Math.min(to, doc.length);
    if (doc.sliceString(f, t) === original) return this.replaceRange(f, t, replacement);
    const idx = doc.toString().indexOf(original);
    if (idx !== -1) return this.replaceRange(idx, idx + original.length, replacement);
    return this.replaceRange(f, t, replacement);
  },

  /** Replace a range with new text and place the cursor after it. */
  replaceRange(from: number, to: number, text: string): boolean {
    if (!currentView) return false;
    const len = currentView.state.doc.length;
    const f = Math.min(from, len);
    const t = Math.min(to, len);
    currentView.dispatch({
      changes: { from: f, to: t, insert: text },
      selection: EditorSelection.cursor(f + text.length),
    });
    currentView.focus();
    return true;
  },

  /**
   * Replace a word at a 1-based line/column (a prose fix). Verifies the word
   * matches `expected`; if not, locates `expected` on the line. Never bulk-edits.
   */
  replaceWordAt(line: number, column: number, endColumn: number, replacement: string, expected?: string): boolean {
    if (!currentView) return false;
    const doc = currentView.state.doc;
    if (line < 1 || line > doc.lines) return false;
    const l = doc.line(line);
    let from = l.from + Math.max(0, column - 1);
    let to = endColumn > column ? l.from + (endColumn - 1) : from + (expected?.length ?? 0);
    to = Math.min(to, l.to);

    if (expected && doc.sliceString(from, to) !== expected) {
      const idx = l.text.indexOf(expected);
      if (idx === -1) return false;
      from = l.from + idx;
      to = from + expected.length;
    }
    if (to <= from) return false;
    currentView.dispatch({ changes: { from, to, insert: replacement } });
    currentView.focus();
    return true;
  },

  /** Insert text at the primary cursor. */
  insertAtCursor(text: string): boolean {
    if (!currentView) return false;
    const pos = currentView.state.selection.main.head;
    currentView.dispatch({
      changes: { from: pos, insert: text },
      selection: EditorSelection.cursor(pos + text.length),
    });
    currentView.focus();
    return true;
  },

  /**
   * The derivation to math-check: the selected lines, or — when there is no
   * selection — the lines inside the align/equation environment around the
   * cursor. Each content line becomes a step tagged with its 1-based line.
   * Returns null if fewer than two steps can be found.
   */
  getDerivationRegion(): DerivationRegion | null {
    if (!currentView) return null;
    const doc = currentView.state.doc;
    const sel = currentView.state.selection.main;

    let fromLine: number;
    let toLine: number;
    if (!sel.empty) {
      fromLine = doc.lineAt(sel.from).number;
      toLine = doc.lineAt(sel.to).number;
    } else {
      const cur = doc.lineAt(sel.head).number;
      let begin = -1;
      let end = -1;
      for (let n = cur; n >= 1; n--) {
        const t = doc.line(n).text;
        if (ENV_BEGIN.test(t)) {
          begin = n;
          break;
        }
        if (n !== cur && ENV_END.test(t)) break;
      }
      for (let n = cur; n <= doc.lines; n++) {
        const t = doc.line(n).text;
        if (ENV_END.test(t)) {
          end = n;
          break;
        }
        if (n !== cur && ENV_BEGIN.test(t)) break;
      }
      if (begin === -1 || end === -1) return null;
      fromLine = begin + 1;
      toLine = end - 1;
    }

    const steps: { latex: string; line: number }[] = [];
    for (let n = fromLine; n <= Math.min(toLine, doc.lines); n++) {
      const text = doc.line(n).text;
      if (isContentLine(text)) steps.push({ latex: stripBreak(text), line: n });
    }
    return steps.length >= 2 ? { steps } : null;
  },
};
