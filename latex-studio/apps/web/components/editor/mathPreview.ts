'use client';

/**
 * LIVE MATHS PREVIEW — see the rendered equation BEFORE compiling.
 *
 * While the cursor is inside maths (inline $…$, \(...\), \[...\], or a display
 * environment), a floating card renders the equation instantly with KaTeX —
 * fully offline, no compile, milliseconds. The user's own macros (document
 * \newcommand/\def + the Settings macro table) are passed to KaTeX so project
 * notation (\Bo, \pdiff, …) renders correctly. Unknown commands render best-
 * effort in red rather than erroring (throwOnError: false).
 */

import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { usePreviewStore } from '../../lib/previewStore';
import { indexedMacros } from '../../lib/latexIndex';

export interface MathSpan {
  from: number;
  to: number;
  latex: string;
  display: boolean;
}

const DISPLAY_ENVS = ['equation', 'align', 'gather', 'multline', 'aligned', 'cases', 'split', 'eqnarray', 'displaymath'];

/** The maths construct containing `pos`, else null. Pure + unit-tested. */
export function mathSpanAt(doc: string, pos: number): MathSpan | null {
  // 1. Display environment \begin{env} … \end{env} (innermost containing pos).
  const envRe = new RegExp(`\\\\begin\\{(${DISPLAY_ENVS.join('|')})\\*?\\}`, 'g');
  let m: RegExpExecArray | null;
  let best: MathSpan | null = null;
  while ((m = envRe.exec(doc)) !== null) {
    const env = m[1]!;
    const close = doc.indexOf(`\\end{${env}`, m.index);
    const end = close === -1 ? doc.length : doc.indexOf('}', close + 5) + 1 || doc.length;
    if (pos >= m.index && pos <= end) {
      const innerFrom = m.index + m[0].length;
      const innerTo = close === -1 ? doc.length : close;
      best = { from: m.index, to: end, latex: doc.slice(innerFrom, innerTo), display: true };
    }
    if (m.index > pos) break;
  }
  if (best) return best;

  // 2. \[ … \] display maths.
  const openBracket = doc.lastIndexOf('\\[', pos);
  if (openBracket !== -1) {
    const closeBracket = doc.indexOf('\\]', openBracket);
    if (closeBracket !== -1 && pos >= openBracket && pos <= closeBracket + 2) {
      return { from: openBracket, to: closeBracket + 2, latex: doc.slice(openBracket + 2, closeBracket), display: true };
    }
  }

  // 3. Inline \( … \).
  const openParen = doc.lastIndexOf('\\(', pos);
  if (openParen !== -1) {
    const closeParen = doc.indexOf('\\)', openParen);
    if (closeParen !== -1 && pos >= openParen && pos <= closeParen + 2) {
      return { from: openParen, to: closeParen + 2, latex: doc.slice(openParen + 2, closeParen), display: false };
    }
  }

  // 4. Inline $…$ on the cursor's line (count unescaped $ before pos on the line).
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  const lineEndIdx = doc.indexOf('\n', pos);
  const lineEnd = lineEndIdx === -1 ? doc.length : lineEndIdx;
  const line = doc.slice(lineStart, lineEnd);
  const rel = pos - lineStart;
  const dollars: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '$' && line[i - 1] !== '\\' && line[i + 1] !== '$' && line[i - 1] !== '$') dollars.push(i);
  }
  for (let i = 0; i + 1 < dollars.length; i += 2) {
    const a = dollars[i]!;
    const b = dollars[i + 1]!;
    if (rel > a && rel <= b) {
      return { from: lineStart + a, to: lineStart + b + 1, latex: line.slice(a + 1, b), display: false };
    }
  }
  return null;
}

/** Strip constructs KaTeX cannot render but that carry no visual maths. */
export function cleanForKatex(latex: string): string {
  return latex
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(?:nonumber|notag)\b/g, '')
    .replace(/\\(?:vspace|hspace)\s*\*?\s*\{[^}]*\}/g, '')
    .replace(/\\(?:mbox|hbox)\s*\{([^{}]*)\}/g, '\\text{$1}')
    .replace(/%[^\n]*/g, '')
    .trim();
}

/** Normalise a macro body so KaTeX can digest it: unwrap \ensuremath (KaTeX has
 *  no text mode to escape from), turn \mbox into \text, drop \xspace. */
export function normalizeKatexBody(body: string): string {
  return body
    .replace(/\\ensuremath\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, '$1')
    .replace(/\\(?:mbox|hbox)\s*\{([^{}]*)\}/g, '\\text{$1}')
    .replace(/\\xspace\b/g, '')
    .trim();
}

/** Glyph fallbacks for common journal-class commands KaTeX doesn't know — used
 *  only when the project does not define them itself. */
const KATEX_FALLBACKS: Record<string, string> = {
  '\\bnabla': '\\boldsymbol{\\nabla}',
  '\\bcdot': '\\boldsymbol{\\cdot}',
  '\\mathsfbi': '\\mathbf{#1}',
  '\\vb': '\\mathbf{#1}',
  '\\bm': '\\boldsymbol{#1}',
  '\\dd': '\\mathrm{d}',
  '\\etal': '\\textit{et al.}',
};

/** KaTeX macro table from the project's own macros (normalised) + fallbacks. */
export function katexMacros(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of indexedMacros()) {
    if (!m.body) continue;
    const body = normalizeKatexBody(m.body);
    if (body) out[`\\${m.name}`] = body;
  }
  for (const [name, body] of Object.entries(KATEX_FALLBACKS)) {
    if (!(name in out)) out[name] = body;
  }
  return out;
}

/** Commands KaTeX cannot typeset are echoed in this muted grey (KaTeX's default
 *  is an alarming red) — the TeX engine render replaces them anyway. */
export const KATEX_ERROR_COLOR = '#a1a1aa';

/** Render `latex` into a preview element (best-effort; never throws). */
export function renderPreview(latex: string, display: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cm-math-preview';
  el.setAttribute('data-testid', 'math-preview');
  const cleaned = cleanForKatex(latex);
  if (!cleaned) {
    el.textContent = '…';
    return el;
  }
  try {
    // align/gather rows: KaTeX supports aligned/cases natively; wrap & rows.
    const body = /\\\\|&/.test(cleaned) && display ? `\\begin{aligned}${cleaned}\\end{aligned}` : cleaned;
    katex.render(body, el, { displayMode: display, throwOnError: false, errorColor: KATEX_ERROR_COLOR, macros: katexMacros(), strict: false });
  } catch {
    el.textContent = '(preview unavailable)';
  }
  return el;
}

function previewTooltip(state: EditorState): Tooltip | null {
  if (!usePreviewStore.getState().mathPreview) return null;
  const sel = state.selection.main;
  if (!sel.empty) return null;
  const span = mathSpanAt(state.doc.toString(), sel.head);
  if (!span || !span.latex.trim()) return null;
  return {
    pos: span.from,
    above: true,
    arrow: false,
    create: () => ({ dom: renderPreview(span.latex, span.display) }),
  };
}

const previewField = StateField.define<Tooltip | null>({
  create: previewTooltip,
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    return previewTooltip(tr.state);
  },
  provide: (f) => showTooltip.from(f),
});

const previewTheme = EditorView.baseTheme({
  '.cm-tooltip:has(.cm-math-preview)': {
    backgroundColor: 'var(--ls-surface, #fff)',
    border: '1px solid #d4d4d8',
    borderRadius: '6px',
    boxShadow: '0 6px 20px rgba(18,25,38,0.12)',
  },
  '.cm-math-preview': {
    padding: '6px 12px',
    maxWidth: '640px',
    overflowX: 'auto',
    fontSize: '14px',
  },
});

/** The live equation preview extension ("see it before it compiles"). */
export function mathPreview(): Extension {
  return [previewField, previewTheme];
}
