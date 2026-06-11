import type {
  ChatDelta,
  ChatRequest,
  CompletionRequest,
  EditRequest,
  ModelProvider,
} from '@latex-studio/shared';
import { buildLockedOptions } from './lockedOptions.js';
import {
  WRITING_SYSTEM_PROMPT,
  buildCompletionPrompt,
  buildEditPrompt,
  parseReplacement,
  renderChatPrompt,
} from './prompts.js';
import { AiProviderError, classifyAiError, errorText } from './errors.js';

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk');
type QueryFn = SdkModule['query'];

/** Dynamically import the SDK so module load never spawns the Claude binary. */
async function loadQuery(): Promise<QueryFn> {
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    return mod.query;
  } catch (err) {
    throw new AiProviderError('unavailable', `Claude Agent SDK unavailable: ${errorText(err)}`);
  }
}

// ── Safe field access (the SDK message union is large; read what we need) ─────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function getString(rec: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = rec?.[key];
  return typeof v === 'string' ? v : undefined;
}

function assistantText(m: Record<string, unknown>): string {
  const content = asRecord(m['message'])?.['content'];
  if (!Array.isArray(content)) return '';
  let out = '';
  for (const block of content) {
    const b = asRecord(block);
    if (getString(b, 'type') === 'text') out += getString(b, 'text') ?? '';
  }
  return out;
}

function streamDeltaText(m: Record<string, unknown>): string | undefined {
  const delta = asRecord(asRecord(m['event'])?.['delta']);
  return getString(delta, 'type') === 'text_delta' ? getString(delta, 'text') : undefined;
}

/**
 * ModelProvider backed by the Claude Agent SDK over `claude login` (subscription
 * billing, no API key). Locked to pure text generation (see lockedOptions.ts).
 */
export class AgentSdkProvider implements ModelProvider {
  constructor(private readonly defaultModel: string) {}

  async *chatStream(req: ChatRequest, signal?: AbortSignal): AsyncIterable<ChatDelta> {
    const query = await loadQuery();
    const ac = new AbortController();
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    const options = buildLockedOptions({
      model: req.model ?? this.defaultModel,
      systemPrompt: req.system ?? WRITING_SYSTEM_PROMPT,
      includePartialMessages: true,
      abortController: ac,
    });

    let streamed = false;
    try {
      for await (const message of query({ prompt: renderChatPrompt(req.messages), options })) {
        const m = asRecord(message);
        if (!m) continue;
        const type = getString(m, 'type');
        if (type === 'stream_event') {
          const text = streamDeltaText(m);
          if (text) {
            streamed = true;
            yield { text };
          }
        } else if (type === 'assistant' && !streamed) {
          const text = assistantText(m);
          if (text) yield { text };
        } else if (type === 'result') {
          this.throwOnError(m);
        }
      }
    } catch (err) {
      throw err instanceof AiProviderError ? err : new AiProviderError(classifyAiError(err), errorText(err));
    }
  }

  async complete(req: CompletionRequest, signal: AbortSignal): Promise<string> {
    return this.runOneShot(buildCompletionPrompt(req), this.defaultModel, signal);
  }

  async editRegion(req: EditRequest, signal?: AbortSignal): Promise<string> {
    const raw = await this.runOneShot(buildEditPrompt(req), req.model ?? this.defaultModel, signal);
    return parseReplacement(raw);
  }

  /** Single-turn text generation, returning the full response string. */
  private async runOneShot(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
    const query = await loadQuery();
    const ac = new AbortController();
    signal?.addEventListener('abort', () => ac.abort(), { once: true });
    const options = buildLockedOptions({ model, systemPrompt: WRITING_SYSTEM_PROMPT, abortController: ac });

    let out = '';
    try {
      for await (const message of query({ prompt, options })) {
        const m = asRecord(message);
        if (!m) continue;
        const type = getString(m, 'type');
        if (type === 'assistant') {
          out += assistantText(m);
        } else if (type === 'result') {
          this.throwOnError(m);
          const result = getString(m, 'result');
          if (result) out = result;
        }
      }
    } catch (err) {
      throw err instanceof AiProviderError ? err : new AiProviderError(classifyAiError(err), errorText(err));
    }
    return out.trim();
  }

  private throwOnError(resultMessage: Record<string, unknown>): void {
    const subtype = getString(resultMessage, 'subtype');
    if (subtype && subtype !== 'success') {
      const detail = getString(resultMessage, 'result') ?? subtype;
      throw new AiProviderError(classifyAiError(detail), errorText(detail));
    }
  }
}
