import { StreamLanguage, LanguageSupport } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * LaTeX language support.
 *
 * We use CodeMirror's official legacy `stex` stream parser (see
 * docs/decisions.md for why over codemirror-lang-latex). It highlights
 * commands, environments, math delimiters, and comments, and exposes the
 * extension points (input handlers, completion sources) we need for snippets
 * and — later — custom inline completions.
 */
export const latexLanguage = StreamLanguage.define(stex);

export function latexLanguageSupport(): LanguageSupport {
  return new LanguageSupport(latexLanguage, [
    // Auto-close parens, brackets, and inline-math `$` — but NOT `{}`, so the
    // begin/end expander below can fire cleanly when the user types `}`.
    latexLanguage.data.of({
      closeBrackets: { brackets: ['(', '[', '$'] },
      commentTokens: { line: '%' },
    }),
  ]);
}

// (Snippets + completion live in latexAutocomplete.ts / latexData.ts — the
// IDE-grade deterministic autocomplete that replaced the Ctrl-Space-only set.)

// ─── \begin{env} → \end{env} auto-closer ─────────────────────────────────────

/**
 * When the user finishes typing `\begin{name}` by entering the closing `}`,
 * insert a matching `\end{name}` and drop the cursor on an indented blank line
 * between them.
 */
export const beginEndCloser: Extension = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '}') return false;

  const line = view.state.doc.lineAt(from);
  const before = view.state.sliceDoc(line.from, from);
  const match = /\\begin\{([A-Za-z*]+)$/.exec(before);
  if (!match) return false;

  const env = match[1];
  const indent = /^\s*/.exec(line.text)?.[0] ?? '';
  const insert = `}\n${indent}\t\n${indent}\\end{${env}}`;
  const cursor = from + `}\n${indent}\t`.length;

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  return true;
});
