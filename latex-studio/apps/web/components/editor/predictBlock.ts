import { Facet, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';

export interface Prediction {
  from: number;
  text: string;
  kind: 'prose' | 'maths' | 'structural';
}

export interface PredictConfig {
  onRegenerate: () => void;
  onAccepted: (text: string, from: number, kind: Prediction['kind']) => void;
}

const predictConfig = Facet.define<PredictConfig, PredictConfig>({
  combine: (values) => values[0] ?? { onRegenerate: () => {}, onAccepted: () => {} },
});

const setEffect = StateEffect.define<Prediction | null>();

class BlockWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: string,
  ) {
    super();
  }
  override eq(other: BlockWidget): boolean {
    return other.text === this.text && other.kind === this.kind;
  }
  override toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-predict-block';
    wrap.setAttribute('data-kind', this.kind);
    wrap.setAttribute('data-testid', 'predict-block');
    const head = document.createElement('div');
    head.className = 'cm-predict-head';
    head.textContent = `predict next (${this.kind}) — Tab accept · ⌘→ one · Esc · Alt+] regenerate`;
    wrap.appendChild(head);
    for (const line of this.text.split('\n')) {
      const div = document.createElement('div');
      div.className = 'cm-predict-line';
      div.textContent = line || ' ';
      wrap.appendChild(div);
    }
    return wrap;
  }
  override get estimatedHeight(): number {
    return (this.text.split('\n').length + 1) * 18;
  }
}

const predictField = StateField.define<Prediction | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setEffect)) return e.value;
    if (value && tr.docChanged) return null; // an external edit dismisses the block
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v): DecorationSet => {
      if (!v) return Decoration.none;
      return Decoration.set([Decoration.widget({ widget: new BlockWidget(v.text, v.kind), side: 1 }).range(v.from)]);
    }),
});

export function currentPrediction(view: EditorView): Prediction | null {
  return view.state.field(predictField, false) ?? null;
}

export function setPrediction(view: EditorView, p: Prediction | null): void {
  view.dispatch({ effects: setEffect.of(p) });
}

function acceptAll(view: EditorView): boolean {
  const p = currentPrediction(view);
  if (!p) return false;
  const insert = (p.text.endsWith('\n') ? p.text : p.text) + '';
  view.dispatch({ changes: { from: p.from, insert }, selection: { anchor: p.from + insert.length }, effects: setEffect.of(null) });
  view.state.facet(predictConfig).onAccepted(insert, p.from, p.kind);
  view.focus();
  return true;
}

function acceptOne(view: EditorView): boolean {
  const p = currentPrediction(view);
  if (!p) return false;
  // maths/structural: one line (step); prose: one word.
  let chunk: string;
  let rest: string;
  if (p.kind === 'prose') {
    const m = /^\s*\S+\s*/.exec(p.text);
    chunk = m ? m[0] : p.text;
    rest = p.text.slice(chunk.length);
  } else {
    const nl = p.text.indexOf('\n');
    chunk = nl === -1 ? p.text : p.text.slice(0, nl + 1);
    rest = nl === -1 ? '' : p.text.slice(nl + 1);
  }
  const next = p.from + chunk.length;
  view.dispatch({
    changes: { from: p.from, insert: chunk },
    selection: { anchor: next },
    effects: setEffect.of(rest.trim() ? { from: next, text: rest, kind: p.kind } : null),
  });
  view.focus();
  return true;
}

function dismiss(view: EditorView): boolean {
  if (!currentPrediction(view)) return false;
  view.dispatch({ effects: setEffect.of(null) });
  return true;
}

function regenerate(view: EditorView): boolean {
  if (!currentPrediction(view)) return false;
  view.state.facet(predictConfig).onRegenerate();
  return true;
}

const predictTheme = EditorView.baseTheme({
  '.cm-predict-block': {
    display: 'inline-block',
    verticalAlign: 'top',
    margin: '2px 0',
    padding: '4px 8px',
    borderLeft: '3px solid #3b82f6',
    borderRadius: '4px',
    background: 'rgba(59,130,246,0.06)',
    color: '#475569',
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap',
    maxWidth: '90%',
  },
  '.cm-predict-head': { fontSize: '10px', opacity: '0.6', fontStyle: 'normal', marginBottom: '2px' },
  '.cm-predict-line': { fontFamily: 'inherit' },
});

export function predictBlockExtension(config: PredictConfig) {
  return [
    predictConfig.of(config),
    predictField,
    predictTheme,
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptAll },
        { key: 'Mod-ArrowRight', run: acceptOne },
        { key: 'Escape', run: dismiss },
        { key: 'Alt-]', run: regenerate },
      ]),
    ),
  ];
}
