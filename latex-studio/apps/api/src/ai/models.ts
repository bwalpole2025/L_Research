import type { AiModelsResponse } from '@latex-studio/shared';
import { FALLBACK_MODELS } from '../providers/index.js';
import { buildLockedOptions } from '../providers/lockedOptions.js';

let cache: { value: AiModelsResponse; at: number } | undefined;
const TTL_MS = 10 * 60 * 1000;

/**
 * The model identifiers the Agent SDK accepts on this subscription. We query the
 * SDK live (`Query.supportedModels()`) and fall back to a static allowlist when
 * the SDK is unreachable (e.g. not logged in). Cached for `TTL_MS`.
 */
export async function getModels(defaultModel: string): Promise<AiModelsResponse> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  let models = [...FALLBACK_MODELS];
  let live = false;
  try {
    const fetched = await fetchLiveModels(defaultModel);
    if (fetched.length > 0) {
      models = [...new Set([...fetched, ...FALLBACK_MODELS])];
      live = true;
    }
  } catch {
    /* SDK unreachable — keep the fallback list */
  }

  const value: AiModelsResponse = { default: defaultModel, models, live };
  cache = { value, at: Date.now() };
  return value;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchLiveModels(defaultModel: string): Promise<string[]> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  const q = query({
    prompt: 'noop',
    options: buildLockedOptions({ model: defaultModel, systemPrompt: 'noop' }),
  });
  try {
    const infos: unknown = await withTimeout(q.supportedModels(), 5000);
    if (!Array.isArray(infos)) return [];
    return infos
      .map((info) => {
        const rec = info && typeof info === 'object' ? (info as Record<string, unknown>) : {};
        const id = rec['id'] ?? rec['model'];
        return typeof id === 'string' ? id : '';
      })
      .filter((id) => id.length > 0);
  } finally {
    try {
      q.close();
    } catch {
      /* noop */
    }
  }
}
