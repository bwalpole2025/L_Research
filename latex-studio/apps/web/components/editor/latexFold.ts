import { foldService, foldGutter, codeFolding, foldKeymap } from '@codemirror/language';
import { keymap } from '@codemirror/view';
import type { EditorState, Extension } from '@codemirror/state';

/**
 * LaTeX code folding. `stex` is a stream parser with no syntax tree, so folding
 * is provided as a line-scanning `foldService` rather than via `foldNodeProp`.
 *
 * Two fold kinds:
 *  · sectioning — \part…\subparagraph fold from the heading to the next heading
 *    of the SAME-OR-HIGHER level (or \end{document} / EOF), so a \section folds
 *    its whole body including nested \subsections.
 *  · environments — \begin{env}…\end{env} fold their body (depth-counted so
 *    nested same-name environments match correctly).
 *
 * Both keep the opening and closing lines visible and hide only the body.
 */

const SECTION_LEVEL: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const BEGIN_RE = /\\begin\s*\{([^}]+)\}/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Fold range for the line at [lineStart,lineEnd], or null if it doesn't open a
 *  foldable block. Keeps the opening line visible; folds to the end of the last
 *  body line so the closing line / next heading stays visible. */
function latexFoldRange(state: EditorState, lineStart: number): { from: number; to: number } | null {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const text = line.text;

  // 1. Environment: \begin{env} … \end{env} (depth-counted).
  const begin = BEGIN_RE.exec(text);
  if (begin) {
    const env = begin[1] ?? '';
    const pair = new RegExp(`\\\\(begin|end)\\s*\\{${escapeRe(env)}\\}`, 'g');
    let depth = 0;
    for (let n = line.number; n <= doc.lines; n++) {
      const l = doc.line(n);
      for (const m of l.text.matchAll(pair)) {
        if (m[1] === 'begin') depth += 1;
        else {
          depth -= 1;
          if (depth === 0) {
            if (n <= line.number + 1) return null; // empty / single-line env
            const to = doc.line(n - 1).to; // end of the last body line
            return to > line.to ? { from: line.to, to } : null;
          }
        }
      }
    }
    return null; // unclosed
  }

  // 2. Sectioning: fold to the next heading of same-or-higher level / \end{document}.
  const sec = SECTION_RE.exec(text);
  if (sec) {
    const level = SECTION_LEVEL[sec[1] ?? ''] ?? 99;
    for (let n = line.number + 1; n <= doc.lines; n++) {
      const t = doc.line(n).text;
      if (/^\s*\\end\s*\{document\}/.test(t)) {
        const to = doc.line(n - 1).to;
        return to > line.to ? { from: line.to, to } : null;
      }
      const h = SECTION_RE.exec(t);
      if (h && (SECTION_LEVEL[h[1] ?? ''] ?? 99) <= level) {
        const to = doc.line(n - 1).to;
        return to > line.to ? { from: line.to, to } : null;
      }
    }
    const to = doc.line(doc.lines).to; // last section → end of document
    return to > line.to ? { from: line.to, to } : null;
  }

  return null;
}

/** Folding for LaTeX: the fold service, a fold gutter, and the fold keymap
 *  (Ctrl/Cmd-Alt-[ = fold all, Ctrl/Cmd-Alt-] = unfold all; per-block toggles
 *  via the gutter or Ctrl/Cmd-Shift-[ / ]). */
export function latexFolding(): Extension {
  return [
    codeFolding(),
    foldService.of((state, lineStart) => latexFoldRange(state, lineStart)),
    foldGutter({ markerDOM: foldMarker }),
    keymap.of(foldKeymap),
  ];
}

/** Crisp ▾/▸ fold markers (the default gutter glyphs are tiny). */
function foldMarker(open: boolean): HTMLElement {
  const span = document.createElement('span');
  span.textContent = open ? '▾' : '▸';
  span.setAttribute('aria-label', open ? 'Fold' : 'Unfold');
  span.style.cssText = 'cursor:pointer;opacity:0.55;font-size:10px;padding:0 2px;';
  return span;
}

// Exported for unit testing the fold geometry without a live editor.
export const __test = { latexFoldRange };
