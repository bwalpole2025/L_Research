import { StreamLanguage, LanguageSupport } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import {
  autocompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
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

// ─── Snippets ────────────────────────────────────────────────────────────────

interface EnvSnippet {
  label: string;
  detail: string;
  template: string;
}

/** A small snippet set for common environments. `${}` marks tab stops. */
const SNIPPETS: EnvSnippet[] = [
  { label: '\\begin', detail: 'environment', template: '\\begin{${env}}\n\t${}\n\\end{${env}}' },
  { label: 'equation', detail: 'environment', template: '\\begin{equation}\n\t${}\n\\end{equation}' },
  { label: 'align', detail: 'environment', template: '\\begin{align}\n\t${}\n\\end{align}' },
  { label: 'itemize', detail: 'environment', template: '\\begin{itemize}\n\t\\item ${}\n\\end{itemize}' },
  {
    label: 'enumerate',
    detail: 'environment',
    template: '\\begin{enumerate}\n\t\\item ${}\n\\end{enumerate}',
  },
  {
    label: 'figure',
    detail: 'environment',
    template:
      '\\begin{figure}[${htbp}]\n\t\\centering\n\t\\includegraphics[width=${0.8}\\textwidth]{${path}}\n\t\\caption{${caption}}\n\t\\label{fig:${label}}\n\\end{figure}',
  },
  {
    label: 'table',
    detail: 'environment',
    template:
      '\\begin{table}[${htbp}]\n\t\\centering\n\t\\begin{tabular}{${cc}}\n\t\t${} \\\\\n\t\\end{tabular}\n\t\\caption{${caption}}\n\t\\label{tab:${label}}\n\\end{table}',
  },
  {
    label: 'theorem',
    detail: 'environment',
    template: '\\begin{theorem}\n\t${}\n\\end{theorem}',
  },
];

const SNIPPET_COMPLETIONS: Completion[] = SNIPPETS.map((s) =>
  snippetCompletion(s.template, {
    label: s.label,
    detail: s.detail,
    type: 'keyword',
    boost: 50,
  }),
);

/** Completion source offering the environment snippets while typing a word. */
function latexCompletionSource(context: CompletionContext): CompletionResult | null {
  // Match an optional leading backslash and word chars before the cursor.
  const word = context.matchBefore(/\\?\w*/);
  if (!word) return null;
  if (word.from === word.to && !context.explicit) return null;
  return { from: word.from, options: SNIPPET_COMPLETIONS, validFor: /^\\?\w*$/ };
}

export function latexSnippets(): Extension {
  // Explicit trigger (Ctrl-Space) only: ghost-text completions are the
  // typing-time experience, and an auto-opening snippet popup would fight the
  // ghost (its Tab/Esc would shadow the ghost's accept/dismiss).
  return autocompletion({ override: [latexCompletionSource], activateOnTyping: false });
}

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
