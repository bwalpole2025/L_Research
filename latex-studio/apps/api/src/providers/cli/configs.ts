import type { CliProviderConfig } from './cliProvider.js';

/**
 * Per-CLI invocation configs. Centralised so the exact non-interactive command
 * line is one edit away once each binary is available (none is installed here).
 *
 * Both are run in a locked-down, single-turn, read-only mode: we want pure text
 * generation, never tool use or file edits — the same posture the Claude Agent
 * SDK is locked to (lockedOptions.ts). The prompt is fed on STDIN.
 */

/** Codex CLI — "Sign in with ChatGPT" uses the user's subscription, no API key. */
export const CODEX_CONFIG: CliProviderConfig = {
  label: 'ChatGPT (Codex CLI)',
  command: 'codex',
  defaultModel: 'gpt-5-codex',
  // `codex exec` runs a single non-interactive turn; read-only sandbox + never
  // ask for approval keeps it from touching the filesystem. Prompt on stdin.
  buildArgs: (model) => ['exec', '--model', model, '--sandbox', 'read-only', '--ask-for-approval', 'never', '-'],
  parseOutput: stripCodexChrome,
};

/** Gemini CLI — "Login with Google" (Code Assist), no API key. */
export const GEMINI_CONFIG: CliProviderConfig = {
  label: 'Gemini (Gemini CLI)',
  command: 'gemini',
  defaultModel: 'gemini-2.5-pro',
  // Non-interactive prompt mode (`-p` reads the prompt; here via stdin) without
  // the YOLO/auto-edit flags, so it only answers.
  buildArgs: (model) => ['-m', model, '-p'],
  parseOutput: (s) => s.trim(),
};

/**
 * Codex exec may wrap the answer in light status chrome (a leading banner / a
 * trailing token line). Keep the body; drop obvious non-answer lines. Defensive
 * and conservative — if nothing matches, the output is returned unchanged.
 */
function stripCodexChrome(stdout: string): string {
  const lines = stdout.split('\n');
  const kept = lines.filter(
    (l) => !/^\s*(\[\d{4}-\d\d-\d\d|codex\s|tokens used|workdir:|model:|provider:|reasoning|exec\s)/i.test(l),
  );
  return kept.join('\n').trim();
}
