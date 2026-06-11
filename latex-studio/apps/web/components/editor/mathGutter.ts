import { StateEffect, StateField, RangeSet, type Extension } from '@codemirror/state';
import { gutter, GutterMarker } from '@codemirror/view';
import type { MathLineMarker } from '@/lib/types';

const ICON: Record<string, string> = { ok: '✓', fail: '✗', unknown: '?', unparseable: '!' };
const CLASS: Record<string, string> = {
  ok: 'cm-math-ok',
  fail: 'cm-math-fail',
  unknown: 'cm-math-unknown',
  unparseable: 'cm-math-warn',
};

class MathGutterMarker extends GutterMarker {
  constructor(
    private readonly verdict: string,
    private readonly title: string,
  ) {
    super();
  }

  override toDOM(): Node {
    const el = document.createElement('span');
    el.textContent = ICON[this.verdict] ?? '·';
    el.title = this.title;
    el.className = `cm-math-marker ${CLASS[this.verdict] ?? ''}`;
    return el;
  }
}

/** Replace all math gutter markers (one entry per checked source line). */
export const setMathMarkers = StateEffect.define<{ line: number; marker: MathLineMarker }[]>();

const mathMarkerField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = set.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setMathMarkers)) continue;
      const total = tr.state.doc.lines;
      const ranges = effect.value
        .filter((m) => m.line >= 1 && m.line <= total)
        .map((m) =>
          new MathGutterMarker(m.marker.verdict, m.marker.title).range(
            tr.state.doc.line(m.line).from,
          ),
        )
        .sort((a, b) => a.from - b.from);
      next = RangeSet.of(ranges, true);
    }
    return next;
  },
});

export function mathGutter(): Extension {
  return [
    mathMarkerField,
    gutter({ class: 'cm-math-gutter', markers: (view) => view.state.field(mathMarkerField) }),
  ];
}
