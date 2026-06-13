import type { CompletionInlineRequest, CompletionResult, ModelProvider } from '@latex-studio/shared';
import type { AppConfig } from '../../config.js';
import { ApiKeyProvider } from '../../providers/apiKey.js';
import { AgentSdkProvider } from '../../providers/agentSdk.js';
import { COMPLETION_SYSTEM_PROMPT, buildCompletionUserPrompt, parseCompletion } from './prompts.js';

/** The contract the /complete route depends on (mockable in tests). */
export interface CompletionRunner {
  complete(projectId: string, req: CompletionInlineRequest, signal: AbortSignal): Promise<CompletionResult>;
  shutdown(): void;
}

/**
 * Serves ghost-text completions. The `agent-sdk` path generates through the
 * shared model provider's streaming channel — the SAME `chatStream` that powers
 * chat/review/co-derive. (An earlier bespoke warm-pool `query()` returned empty
 * text on some Agent SDK builds, which delivered the text only as partial-message
 * deltas; routing through `chatStream` is the channel that works.) The `api` path
 * delegates to the stub ApiKeyProvider.
 */
export class CompletionService implements CompletionRunner {
  private readonly modelProvider: ModelProvider;
  private apiProvider: ModelProvider | null = null;

  constructor(
    private readonly config: AppConfig,
    modelProvider?: ModelProvider,
  ) {
    // Reuse the app's provider when given (so completions share its auth/session);
    // otherwise build a dedicated Agent SDK provider keyed to the completion model.
    this.modelProvider = modelProvider ?? new AgentSdkProvider(config.completionModel);
  }

  async complete(projectId: string, req: CompletionInlineRequest, signal: AbortSignal): Promise<CompletionResult> {
    const provider = req.provider ?? this.config.completionsProvider;
    const model = req.model ?? this.config.completionModel;
    const start = Date.now();
    const prompt = buildCompletionUserPrompt(req);

    if (provider === 'api') {
      const p = (this.apiProvider ??= new ApiKeyProvider());
      const text = await p.complete(
        {
          projectId,
          filePath: '',
          prefix: req.prefix,
          ...(req.suffix ? { suffix: req.suffix } : {}),
          instruction: prompt,
        },
        signal,
      );
      return { completion: parseCompletion(text), latencyMs: Date.now() - start, variant: 'baseline', provider, model };
    }

    const text = await this.generate(prompt, model, signal);
    return {
      completion: parseCompletion(text),
      latencyMs: Date.now() - start,
      variant: req.baseline ? 'baseline' : 'cold',
      provider,
      model,
    };
  }

  /** Single-turn generation over the provider's streaming channel → joined text. */
  private async generate(prompt: string, model: string, signal: AbortSignal): Promise<string> {
    let out = '';
    for await (const delta of this.modelProvider.chatStream(
      { system: COMPLETION_SYSTEM_PROMPT, messages: [{ role: 'user', content: prompt }], model },
      signal,
    )) {
      out += delta.text;
    }
    return out;
  }

  shutdown(): void {
    /* no warm pool to drain */
  }
}
