import type { ChatDelta, ChatRequest, ModelProvider } from '@latex-studio/shared';
import { AiProviderError } from './errors.js';

const MSG =
  'ApiKeyProvider is not configured. Set MODEL_PROVIDER=agent-sdk to use Claude ' +
  'subscription auth (run `claude login`), or implement the pay-as-you-go API-key provider.';

/**
 * The escape hatch (MODEL_PROVIDER=api). Intentionally throws — wiring a metered
 * API-key path is a deliberate, separate decision. Feature code depends only on
 * ModelProvider, so a single route could swap to a real implementation here.
 */
export class ApiKeyProvider implements ModelProvider {
  // eslint-disable-next-line require-yield
  async *chatStream(_req: ChatRequest): AsyncIterable<ChatDelta> {
    throw new AiProviderError('invalid', MSG);
  }

  async complete(): Promise<string> {
    throw new AiProviderError('invalid', MSG);
  }

  async editRegion(): Promise<string> {
    throw new AiProviderError('invalid', MSG);
  }
}
