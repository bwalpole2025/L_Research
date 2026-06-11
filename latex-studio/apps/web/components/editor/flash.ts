import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** Briefly highlight a line (e.g. after jumping to a diagnostic / SyncTeX target). */
export const setFlash = StateEffect.define<{ line: number } | null>();

const flashDecoration = Decoration.line({ class: 'cm-flash-line' });

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setFlash)) continue;
      if (effect.value === null) {
        next = Decoration.none;
      } else {
        const total = tr.state.doc.lines;
        const lineNo = Math.min(Math.max(1, effect.value.line), total);
        const line = tr.state.doc.line(lineNo);
        next = Decoration.set([flashDecoration.range(line.from)]);
      }
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});
