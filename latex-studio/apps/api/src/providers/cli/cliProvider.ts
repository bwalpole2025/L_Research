import type {
  ChatDelta,
  ChatRequest,
  CompletionRequest,
  EditRequest,
  ModelProvider,
} from '@latex-studio/shared';
import { AiProviderError, classifyAiError } from '../errors.js';
import {
  WRITING_SYSTEM_PROMPT,
  buildCompletionPrompt,
  buildEditPrompt,
  parseReplacement,
  renderChatPrompt,
} from '../prompts.js';
import { runCli, type CliRunner } from './spawnCli.js';

/**
 * A `ModelProvider` backed by a vendor's official subscription CLI (Codex for
 * ChatGPT, Gemini CLI for Google), run non-interactively — mirroring how the
 * Claude Agent SDK drives the `claude` binary. NO API KEY: the CLI owns its own
 * subscription login.
 *
 * Honesty/safety parity with the Anthropic provider:
 *  - PURE TEXT GENERATION ONLY. We pass a prompt and read the model's text; the
 *    CLI runs in its most constrained non-interactive mode (no tools, no file
 *    edits — encoded in each provider's `buildArgs`).
 *  - The same downstream JSON-repair parsers (review / co-derive) consume the
 *    text, so structured-output handling is identical across providers.
 *  - SymPy stays the sole maths arbiter, regardless of which model proposed.
 *
 * `chatStream` yields the parsed answer as a single delta — these CLIs emit a
 * complete answer in exec mode, and yielding once keeps any CLI chrome that
 * `parseOutput` strips out of the transcript.
 *
 * NOTE: the exact invocation lives in `CliProviderConfig` so it is easy to tune
 * once the binary is present. None of these CLIs is installed in this
 * environment, so live generation is verified only after the user signs in; the
 * adapter is unit-tested via a stubbed runner.
 */
export interface CliProviderConfig {
  /** Display name, e.g. "ChatGPT (Codex)". */
  label: string;
  /** Executable, e.g. "codex" or "gemini". */
  command: string;
  /** Build argv for one non-interactive, locked-down generation with `model`. */
  buildArgs(model: string): string[];
  /** Strip any CLI chrome from stdout to recover the model's text. */
  parseOutput?(stdout: string): string;
  /** Default model id when the request doesn't specify one. */
  defaultModel: string;
}

export class CliModelProvider implements ModelProvider {
  constructor(
    private readonly cfg: CliProviderConfig,
    private readonly runner: CliRunner = runCli,
  ) {}

  async *chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta> {
    const prompt = compose(req.system ?? WRITING_SYSTEM_PROMPT, renderChatPrompt(req.messages));
    const text = (await this.exec(prompt, req.model ?? this.cfg.defaultModel, signal)).trim();
    if (text) yield { text };
  }

  async complete(req: CompletionRequest, signal: AbortSignal): Promise<string> {
    return (await this.exec(buildCompletionPrompt(req), this.cfg.defaultModel, signal)).trim();
  }

  async editRegion(req: EditRequest, signal?: AbortSignal): Promise<string> {
    return parseReplacement(await this.exec(buildEditPrompt(req), req.model ?? this.cfg.defaultModel, signal));
  }

  /** Run the CLI once (prompt on stdin) and return parsed text, or throw typed. */
  private async exec(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
    const res = await this.runner(this.cfg.command, this.cfg.buildArgs(model), {
      input: prompt,
      ...(signal ? { signal } : {}),
    });

    if (res.notFound) {
      throw new AiProviderError('unavailable', `${this.cfg.label}: the \`${this.cfg.command}\` CLI is not installed.`);
    }
    if (res.code !== 0) {
      const text = `${res.stderr} ${res.stdout}`;
      if (/not (logged in|authenticated|signed in)|please (log|sign) ?in|unauthor/i.test(text)) {
        throw new AiProviderError('auth', `${this.cfg.label}: not signed in. Run \`${this.cfg.command}\` to sign in with your subscription.`);
      }
      throw new AiProviderError(classifyAiError(text), `${this.cfg.label} failed: ${(res.stderr || res.stdout).slice(0, 300)}`);
    }
    return this.cfg.parseOutput ? this.cfg.parseOutput(res.stdout) : res.stdout;
  }
}

/** System prompt + transcript → one CLI prompt string. */
function compose(system: string, transcript: string): string {
  return `${system}\n\n${transcript}`;
}
