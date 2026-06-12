import type { ChatMessageInput, CompletionRequest, EditRequest } from '@latex-studio/shared';

/** System prompt for one-shot transforms (edit/fix/complete) — pure LaTeX out. */
export const WRITING_SYSTEM_PROMPT =
  'You are a LaTeX writing assistant embedded directly in a code editor. ' +
  'You transform or generate LaTeX source on request. ' +
  'Output ONLY the requested LaTeX — no explanations, no commentary, no markdown code fences, ' +
  'and never attempt to read or write files. Preserve the surrounding style and indentation.';

/** System prompt for the chat sidebar (Markdown + KaTeX allowed). */
export function chatSystemPrompt(projectInstructions: string | undefined, contextBlock: string): string {
  const parts = [
    'You are an AI assistant embedded in LaTeX Studio, a local single-user LaTeX editor.',
    'Help the user write, edit, debug, and reason about their LaTeX document and the mathematics in it.',
    'You have NO tools and cannot read or modify files directly — propose changes as fenced code blocks the user can insert.',
    'Use GitHub-flavored Markdown. Write math in LaTeX delimited by $...$ (inline) or $$...$$ (display) so it renders with KaTeX.',
  ];
  const instructions = projectInstructions?.trim();
  if (instructions) parts.push(`\nProject-specific instructions from the user:\n${instructions}`);
  if (contextBlock.trim()) parts.push(`\nCurrent editor context (read-only, for reference):\n${contextBlock.trim()}`);
  return parts.join('\n');
}

/**
 * Render our stored transcript into a single prompt for a one-shot query.
 * We replay the transcript (the source of truth) rather than using SDK resume —
 * see docs/decisions.md ADR-005.
 */
export function renderChatPrompt(messages: ChatMessageInput[]): string {
  const lines = messages.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`);
  lines.push('Assistant:');
  return lines.join('\n\n');
}

export function buildCompletionPrompt(req: CompletionRequest): string {
  const parts: string[] = [];
  if (req.instruction) parts.push(`Instruction: ${req.instruction}`);
  if (req.suffix !== undefined) {
    parts.push('Continue the LaTeX at the cursor. Text before the cursor:');
    parts.push(req.prefix);
    parts.push('Text after the cursor:');
    parts.push(req.suffix);
    parts.push('Output only the text to insert at the cursor.');
  } else {
    parts.push(req.prefix);
  }
  return parts.join('\n');
}

export function buildEditPrompt(req: EditRequest): string {
  const parts: string[] = [];
  if (req.context) {
    parts.push('Surrounding LaTeX (read-only context — do NOT include it in your output):');
    parts.push('<context>', req.context, '</context>');
  }
  parts.push('Region to rewrite:');
  parts.push('<selection>', req.selection, '</selection>');
  parts.push(`Instruction: ${req.instruction}`);
  parts.push(
    'Rewrite ONLY the selected region per the instruction. Respond with the replacement wrapped ' +
      'exactly in <replacement>...</replacement> tags and nothing else — no prose, no markdown fences.',
  );
  return parts.join('\n');
}

/** Compose the instruction for a fix-from-log edit (routed through editRegion). */
export function buildFixInstruction(message: string, line: number | undefined, logExcerpt: string): string {
  return [
    'This LaTeX region failed to compile. Make the MINIMAL change so it compiles.',
    'Fix ONLY the error in scope — do not rewrite, reformat, or "improve" surrounding maths or prose in any way.',
    'If you cannot produce a confident minimal fix, output exactly <replacement>NO_FIX</replacement> instead of guessing.',
    `Compiler error${line ? ` (line ${line})` : ''}: ${message}`,
    'Compiler log excerpt:',
    logExcerpt,
  ].join('\n');
}

/**
 * Robustly extract the replacement: prefer <replacement> tags, then a fenced
 * code block, else the trimmed text. Strips any stray prose the model adds.
 */
export function parseReplacement(text: string): string {
  const tagged = /<replacement>\s*([\s\S]*?)\s*<\/replacement>/i.exec(text);
  const inner = tagged ? (tagged[1] ?? '') : text;
  const fenced = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(inner);
  if (fenced) return (fenced[1] ?? '').replace(/\n$/, '');
  return inner.trim();
}
