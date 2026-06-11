import { tmpdir } from 'node:os';
import type { CompletionInlineRequest, CompletionResult, ModelProvider } from '@latex-studio/shared';
import type { AppConfig } from '../../config.js';
import { buildLockedOptions } from '../../providers/lockedOptions.js';
import { ApiKeyProvider } from '../../providers/apiKey.js';
import { AiProviderError, classifyAiError, errorText } from '../../providers/errors.js';
import { COMPLETION_SYSTEM_PROMPT, buildCompletionUserPrompt, parseCompletion } from './prompts.js';
import { collectCompletion } from './run.js';
import { WarmPool } from './warmPool.js';

/** The contract the /complete route depends on (mockable in tests). */
export interface CompletionRunner {
  complete(projectId: string, req: CompletionInlineRequest, signal: AbortSignal): Promise<CompletionResult>;
  shutdown(): void;
}

type DrainableQuery = AsyncIterable<unknown> & { close?(): void };

/**
 * Serves ghost-text completions. `agent-sdk` uses a per-project warm pool
 * (ADR-006); `api` delegates to the (stub) ApiKeyProvider. `baseline`, a model
 * override, or `completionsWarm=false` force a fresh cold call for benchmarking.
 */
export class CompletionService implements CompletionRunner {
  private readonly pool: WarmPool;
  private apiProvider: ModelProvider | null = null;

  constructor(private readonly config: AppConfig) {
    this.pool = new WarmPool(
      () =>
        buildLockedOptions({
          model: config.completionModel,
          systemPrompt: COMPLETION_SYSTEM_PROMPT,
          persistSession: false,
          cwd: tmpdir(),
        }),
      config.completionWarmIdleMs,
    );
  }

  async complete(projectId: string, req: CompletionInlineRequest, signal: AbortSignal): Promise<CompletionResult> {
    const provider = req.provider ?? this.config.completionsProvider;
    const model = req.model ?? this.config.completionModel;
    const start = Date.now();

    if (provider === 'api') {
      const p = (this.apiProvider ??= new ApiKeyProvider());
      const text = await p.complete(
        {
          projectId,
          filePath: '',
          prefix: req.prefix,
          ...(req.suffix ? { suffix: req.suffix } : {}),
          instruction: buildCompletionUserPrompt(req),
        },
        signal,
      );
      return { completion: parseCompletion(text), latencyMs: Date.now() - start, variant: 'baseline', provider, model };
    }

    const prompt = buildCompletionUserPrompt(req);
    const overridesModel = model !== this.config.completionModel;

    if (req.baseline || !this.config.completionsWarm || overridesModel) {
      const text = await this.runFresh(prompt, model, signal);
      return {
        completion: parseCompletion(text),
        latencyMs: Date.now() - start,
        variant: req.baseline ? 'baseline' : 'cold',
        provider,
        model,
      };
    }

    const { warm, variant } = await this.pool.acquire(projectId);
    const text = await this.drain(warm.query(prompt) as DrainableQuery, signal);
    return { completion: parseCompletion(text), latencyMs: Date.now() - start, variant, provider, model };
  }

  private async runFresh(prompt: string, model: string, signal: AbortSignal): Promise<string> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const options = buildLockedOptions({
      model,
      systemPrompt: COMPLETION_SYSTEM_PROMPT,
      persistSession: false,
      cwd: tmpdir(),
    });
    return this.drain(query({ prompt, options }) as DrainableQuery, signal);
  }

  private async drain(query: DrainableQuery, signal: AbortSignal): Promise<string> {
    const onAbort = () => {
      try {
        query.close?.();
      } catch {
        /* already closed */
      }
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    try {
      return await collectCompletion(query);
    } catch (err) {
      throw err instanceof AiProviderError ? err : new AiProviderError(classifyAiError(err), errorText(err));
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  shutdown(): void {
    this.pool.shutdown();
  }
}
