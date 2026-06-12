'use client';

import { Facet, Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { completionStatus } from '@codemirror/autocomplete';
import type { CompletionMode } from '@/lib/types';

export interface Suggestion {
  from: number;
  text: string;
  mode: CompletionMode;
}

export interface InlineSuggestConfig {
  /** Fired on each doc change so the scheduler can (re)consider a completion. */
  onDocChange: (view: EditorView) => void;
  onAccept: (text: string, from: number, mode: CompletionMode) => void;
  onReject: (pos: number) => void;
  onAlternative: (view: EditorView) => void;
}

const NOOP: InlineSuggestConfig = {
  onDocChange: () => {},
  onAccept: () => {},
  onReject: () => {},
  onAlternative: () => {},
};

const configFacet = Facet.define<InlineSuggestConfig, InlineSuggestConfig>({
  combine: (values) => values[0] ?? NOOP,
});

// ── Ghost suggestion ─────────────────────────────────────────────────────────

const setSuggestionEffect = StateEffect.define<Suggestion | null>();

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-ghost';
    const lines = this.text.split('\n');
    wrap.textContent = lines[0] ?? '';
    if (lines.length > 1) {
      const rest = document.createElement('span');
      rest.className = 'cm-ghost-rest';
      rest.textContent = `\n${lines.slice(1).join('\n')}`;
      wrap.appendChild(rest);
    }
    return wrap;
  }
}

const suggestionField = StateField.define<Suggestion | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSuggestionEffect)) return e.value;
    if (!value) return null;

    if (tr.docChanged) {
      // Typing-through: keep the suggestion if the user typed its next chars.
      let inserted = '';
      let simpleInsertAtFrom = true;
      let changeCount = 0;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
        changeCount += 1;
        if (fromA !== value.from || toA !== fromA) simpleInsertAtFrom = false;
        inserted += ins.toString();
      });
      if (changeCount === 1 && simpleInsertAtFrom && inserted.length > 0 && value.text.startsWith(inserted)) {
        const text = value.text.slice(inserted.length);
        if (!text) return null;
        return { from: tr.changes.mapPos(value.from, 1), text, mode: value.mode };
      }
      return null; // any other edit cancels the suggestion
    }

    if (tr.selection) {
      if (!tr.selection.main.empty || tr.selection.main.head !== value.from) return null;
    }
    return value;
  },
});

/**
 * Ghost rendering, suppressed while the autocomplete DROPDOWN is open — the
 * defined precedence: dropdown open → it owns the screen and the keys; dropdown
 * closed/dismissed → the ghost resumes (its suggestion survives in the field).
 */
function ghostDecorations(state: EditorState): DecorationSet {
  const s = state.field(suggestionField, false);
  if (!s || !s.text) return Decoration.none;
  if (completionStatus(state) !== null) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new GhostWidget(s.text), side: 1 }).range(s.from)]);
}

const ghostRenderPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = ghostDecorations(view.state);
    }
    update(u: ViewUpdate): void {
      this.decorations = ghostDecorations(u.state);
    }
  },
  { decorations: (v) => v.decorations },
);

// ── Amber verification underline (fire-and-forget math check) ────────────────

const addWarnEffect = StateEffect.define<{ from: number; to: number; message: string }>();
const clearWarnsEffect = StateEffect.define<null>();

const warnField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let set = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearWarnsEffect)) set = Decoration.none;
      if (e.is(addWarnEffect) && e.value.to > e.value.from) {
        const mark = Decoration.mark({
          class: 'cm-warn-underline',
          attributes: { title: e.value.message },
        });
        set = set.update({ add: [mark.range(e.value.from, e.value.to)] });
      }
    }
    return set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Commands ─────────────────────────────────────────────────────────────────

function acceptCmd(view: EditorView): boolean {
  // Precedence: an open/pending dropdown owns Tab (accept item / snippet stop).
  if (completionStatus(view.state) !== null) return false;
  const s = view.state.field(suggestionField, false);
  if (!s || !s.text) return false;
  view.dispatch({
    changes: { from: s.from, insert: s.text },
    selection: { anchor: s.from + s.text.length },
    effects: setSuggestionEffect.of(null),
    userEvent: 'input.complete',
  });
  view.state.facet(configFacet).onAccept(s.text, s.from, s.mode);
  return true;
}

function dismissCmd(view: EditorView): boolean {
  // An open dropdown owns Esc (closes the dropdown; the ghost then resumes).
  if (completionStatus(view.state) !== null) return false;
  const s = view.state.field(suggestionField, false);
  if (!s) return false;
  view.dispatch({ effects: setSuggestionEffect.of(null) });
  view.state.facet(configFacet).onReject(s.from);
  return true;
}

function alternativeCmd(view: EditorView): boolean {
  view.state.facet(configFacet).onAlternative(view);
  return true;
}

const ghostTheme = EditorView.theme({
  '.cm-ghost': { opacity: '0.45' },
  '.cm-ghost-rest': { whiteSpace: 'pre' },
  '.cm-warn-underline': {
    textDecoration: 'underline wavy #f59e0b',
    textDecorationSkipInk: 'none',
  },
});

// ── Public API ───────────────────────────────────────────────────────────────

/** Set or clear the current ghost suggestion. */
export function applySuggestion(view: EditorView, suggestion: Suggestion | null): void {
  view.dispatch({ effects: setSuggestionEffect.of(suggestion) });
}

export function currentSuggestion(view: EditorView): Suggestion | null {
  return view.state.field(suggestionField, false) ?? null;
}

export function addWarning(view: EditorView, from: number, to: number, message: string): void {
  view.dispatch({ effects: addWarnEffect.of({ from, to, message }) });
}

export function clearWarnings(view: EditorView): void {
  view.dispatch({ effects: clearWarnsEffect.of(null) });
}

/** The full inline-completion extension. */
export function inlineSuggestion(config: InlineSuggestConfig): Extension {
  return [
    configFacet.of(config),
    suggestionField,
    ghostRenderPlugin,
    warnField,
    ghostTheme,
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptCmd },
        { key: 'Escape', run: dismissCmd },
        { key: 'Alt-]', run: alternativeCmd },
      ]),
    ),
    ViewPlugin.fromClass(
      class {
        update(u: ViewUpdate): void {
          if (u.docChanged) u.view.state.facet(configFacet).onDocChange(u.view);
        }
      },
    ),
  ];
}
