import type { ModelProvider } from '@latex-studio/shared';
import type { AppConfig } from '../config.js';
import { AgentSdkProvider } from './agentSdk.js';
import { ApiKeyProvider } from './apiKey.js';

export function createModelProvider(config: AppConfig): ModelProvider {
  return config.modelProvider === 'api' ? new ApiKeyProvider() : new AgentSdkProvider(config.model);
}

export { AgentSdkProvider } from './agentSdk.js';
export { ApiKeyProvider } from './apiKey.js';
export { assertSubscriptionAuth } from './guard.js';
export { AiProviderError, classifyAiError, aiErrorMessage } from './errors.js';
export { buildLockedOptions, DISALLOWED_TOOLS } from './lockedOptions.js';
export { parseReplacement } from './prompts.js';

/** Fallback model allowlist when the live SDK list can't be fetched. */
export const FALLBACK_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-8',
  'claude-haiku-4-5',
  'sonnet',
  'opus',
  'haiku',
];

/** Validate a project's chosen model against the live list (or the fallback). */
export function isAcceptableModel(model: string, live: string[] = []): boolean {
  const m = model.trim();
  if (!m) return false;
  if (live.includes(m) || FALLBACK_MODELS.includes(m)) return true;
  // Lenient about future ids/aliases the SDK may accept on subscription.
  return /^claude-[a-z0-9][a-z0-9.-]*$/i.test(m);
}
