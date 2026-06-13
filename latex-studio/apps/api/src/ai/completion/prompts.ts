import type { CompletionInlineRequest, CompletionMode } from '@latex-studio/shared';

/**
 * The inline-completion system prompt (fixed; set at warm `startup`). Kept
 * LANGUAGE-NEUTRAL so the one warm pool serves both LaTeX and Python — the
 * per-request mode reminder specialises each call (LaTeX notation vs Python code).
 */
export const COMPLETION_SYSTEM_PROMPT =
  'You are an inline completion engine for source files (LaTeX documents and Python code). ' +
  'Output ONLY the text to insert at <CURSOR>. No commentary, no fences, no repetition of existing text. ' +
  "Match the surrounding file's language, notation, style, and indentation exactly. " +
  "When a context card is provided, use the document's own macros, symbols, and notation from it — reuse macros " +
  '(e.g. \\Bo) rather than re-expanding them, and reuse established terms and symbol names. ' +
  'Predict what THIS file is likely to say next, not generic text.';

/** Soft output caps per mode (the SDK exposes no response max_tokens). */
export const TOKEN_CAPS: Record<CompletionMode, number> = {
  prose: 40,
  'inline-math': 60,
  'display-align': 60,
  preamble: 20,
  'python-code': 64,
};

const MODE_REMINDER: Record<CompletionMode, string> = {
  prose: 'Context: prose. Continue the sentence naturally.',
  'inline-math': 'Context: inline math ($…$). Complete the mathematical expression only.',
  'display-align':
    'Context: a display-math align environment. Use & for column alignment and \\\\ to terminate each row. ' +
    'Complete the current line/step; do not start a new environment.',
  preamble:
    'Context: the document preamble (before \\begin{document}). Complete the package/command/setup line.',
  'python-code':
    'Context: Python code. Complete the current line or block in valid Python, matching the existing ' +
    'indentation, naming, and style. Output only Python to insert — no prose, no markdown, no LaTeX. ' +
    'Do not re-indent or repeat lines that already exist before the cursor.',
};

/** Build the per-completion user prompt (mode reminder + soft cap + document card + context). */
export function buildCompletionUserPrompt(req: CompletionInlineRequest): string {
  const cap = TOKEN_CAPS[req.mode];
  const lines: string[] = [MODE_REMINDER[req.mode]];
  if (req.contextCard?.trim()) lines.push(`Document context card (reuse its notation):\n${req.contextCard.trim()}`);
  if (req.position?.trim()) lines.push(`Cursor position: ${req.position.trim()}.`);
  lines.push(
    `Output at most ~${cap} tokens, and only the text to insert — never repeat surrounding text.`,
    'Document with the insertion point marked <CURSOR>:',
    `${req.prefix}<CURSOR>${req.suffix ?? ''}`,
    'Text to insert at <CURSOR>:',
  );
  return lines.join('\n');
}

/**
 * Clean the model output to a pure insertion string: strip a surrounding code
 * fence, any echoed <CURSOR>, leading newlines, and trailing whitespace.
 * A meaningful leading space is preserved.
 */
export function parseCompletion(raw: string): string {
  let s = raw;
  const fence = /```[a-zA-Z]*\n?([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1] ?? '';
  s = s.replace(/<CURSOR>/g, '');
  return s.replace(/^\n+/, '').replace(/\s+$/, '');
}
