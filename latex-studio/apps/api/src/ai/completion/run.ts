import { AiProviderError, classifyAiError, errorText } from '../../providers/errors.js';
import { asRecord, assistantText, getString } from '../../providers/sdkMessages.js';

/**
 * Drain a query (fresh or warm) and return the completion text. Prefers the
 * final `result` string; throws an AiProviderError on a non-success result.
 */
export async function collectCompletion(query: AsyncIterable<unknown>): Promise<string> {
  let out = '';
  for await (const message of query) {
    const m = asRecord(message);
    if (!m) continue;
    const type = getString(m, 'type');
    if (type === 'assistant') {
      out += assistantText(m);
    } else if (type === 'result') {
      const subtype = getString(m, 'subtype');
      if (subtype && subtype !== 'success') {
        const detail = getString(m, 'result') ?? subtype;
        throw new AiProviderError(classifyAiError(detail), errorText(detail));
      }
      const result = getString(m, 'result');
      if (result) out = result;
    }
  }
  return out;
}
