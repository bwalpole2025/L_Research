import type { CompletionInlineRequest, CompletionMode } from '@latex-studio/shared';

/** The exact inline-completion system prompt (fixed; set at warm `startup`). */
export const COMPLETION_SYSTEM_PROMPT =
  'You are an inline completion engine for LaTeX documents. ' +
  'Output ONLY the text to insert at <CURSOR>. No commentary, no fences, no repetition of existing text. ' +
  "Match the author's notation, macros, and register exactly.";

/** Soft output caps per mode (the SDK exposes no response max_tokens). */
export const TOKEN_CAPS: Record<CompletionMode, number> = {
  prose: 40,
  'inline-math': 60,
  'display-align': 60,
  preamble: 20,
};

const MODE_REMINDER: Record<CompletionMode, string> = {
  prose: 'Context: prose. Continue the sentence naturally.',
  'inline-math': 'Context: inline math ($…$). Complete the mathematical expression only.',
  'display-align':
    'Context: a display-math align environment. Use & for column alignment and \\\\ to terminate each row. ' +
    'Complete the current line/step; do not start a new environment.',
  preamble:
    'Context: the document preamble (before \\begin{document}). Complete the package/command/setup line.',
};

/** Build the per-completion user prompt (mode reminder + soft cap + context). */
export function buildCompletionUserPrompt(req: CompletionInlineRequest): string {
  const cap = TOKEN_CAPS[req.mode];
  return [
    MODE_REMINDER[req.mode],
    `Output at most ~${cap} tokens, and only the text to insert — never repeat surrounding text.`,
    'Document with the insertion point marked <CURSOR>:',
    `${req.prefix}<CURSOR>${req.suffix ?? ''}`,
    'Text to insert at <CURSOR>:',
  ].join('\n');
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
