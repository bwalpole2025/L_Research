import type { AppConfig } from '../config.js';

/**
 * Refuse to boot when a subscription-overriding key is present under the
 * Agent SDK provider. In the SDK's non-interactive mode an API key is ALWAYS
 * used when present (see docs/decisions.md ADR-004), which would silently
 * bypass the `claude login` subscription and incur API billing.
 */
export function assertSubscriptionAuth(config: AppConfig, env: NodeJS.ProcessEnv = process.env): void {
  if (config.modelProvider !== 'agent-sdk') return;

  const offending = (['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const).filter(
    (key) => (env[key] ?? '').trim() !== '',
  );
  if (offending.length === 0) return;

  const names = offending.join(' and ');
  throw new Error(
    `Refusing to start: ${names} ${offending.length > 1 ? 'are' : 'is'} set, but MODEL_PROVIDER=agent-sdk ` +
      'uses your Claude subscription via `claude login`. In the Agent SDK\'s non-interactive mode an API key is ' +
      'ALWAYS used when present, which would silently bypass your subscription and bill the API. ' +
      `Unset ${names} (and remove from .env), or set MODEL_PROVIDER=api for the pay-as-you-go provider. ` +
      'See docs/decisions.md ADR-004.',
  );
}
