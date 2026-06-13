import { AiProviderError, classifyAiError, errorText } from '../../providers/errors.js';
import { asRecord, assistantText, getString, streamDeltaText } from '../../providers/sdkMessages.js';

/**
 * Drain a query (fresh or warm) and return the completion text. Reads the same
 * channels the chat path uses: partial-message `stream_event` deltas (the
 * primary channel when includePartialMessages is on — some SDK builds deliver
 * the text only here), with the consolidated `assistant`/`result` text as
 * fallbacks. Throws an AiProviderError on a non-success result.
 */
export async function collectCompletion(query: AsyncIterable<unknown>): Promise<string> {
  let streamed = '';
  let assistant = '';
  let result: string | undefined;
  for await (const message of query) {
    const m = asRecord(message);
    if (!m) continue;
    const type = getString(m, 'type');
    if (type === 'stream_event') {
      streamed += streamDeltaText(m) ?? '';
    } else if (type === 'assistant') {
      assistant += assistantText(m);
    } else if (type === 'result') {
      const subtype = getString(m, 'subtype');
      if (subtype && subtype !== 'success') {
        const detail = getString(m, 'result') ?? subtype;
        throw new AiProviderError(classifyAiError(detail), errorText(detail));
      }
      result = getString(m, 'result');
    }
  }
  // First non-empty wins: streamed deltas → consolidated assistant → final result.
  return streamed || assistant || result || '';
}
