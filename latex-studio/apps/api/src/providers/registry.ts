import type { FastifyInstance } from 'fastify';
import type { ModelConnectorId, ModelProvider } from '@latex-studio/shared';
import { CliModelProvider } from './cli/cliProvider.js';
import { CODEX_CONFIG, GEMINI_CONFIG } from './cli/configs.js';
import { cliStatus, type CliStatus } from './cli/detect.js';

/**
 * Resolve which `ModelProvider` (and model id) powers a project's AI, from
 * `project.aiProvider`. Anthropic is the default and uses the existing Agent SDK
 * singleton. ChatGPT/Gemini use their subscription CLIs. If a selected CLI is
 * not installed we fall back to Claude with a reason (graceful — never a crash);
 * the Connectors UI shows the connector as "not installed" so the user knows.
 */

export interface ResolvedProvider {
  provider: ModelProvider;
  model: string;
  /** The connector actually used (may differ from the request on fallback). */
  providerId: ModelConnectorId;
  /** Set when the selected connector was unavailable and we fell back. */
  fallbackReason?: string;
}

const MODEL_CONFIG = { chatgpt: CODEX_CONFIG, gemini: GEMINI_CONFIG } as const;

// Cache CLI detection briefly so we don't spawn `--version` on every request.
const STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { at: number; status: CliStatus }>();

async function cachedCliStatus(command: string, now: number): Promise<CliStatus> {
  const hit = statusCache.get(command);
  if (hit && now - hit.at < STATUS_TTL_MS) return hit.status;
  const status = await cliStatus(command);
  statusCache.set(command, { at: now, status });
  return status;
}

export function clearCliStatusCache(): void {
  statusCache.clear();
}

export async function resolveModelProvider(
  app: FastifyInstance,
  project: { model: string; aiProvider?: string | null },
  now: number = Date.now(),
): Promise<ResolvedProvider> {
  const selected = (project.aiProvider ?? 'anthropic') as ModelConnectorId;

  if (selected === 'anthropic' || (selected !== 'chatgpt' && selected !== 'gemini')) {
    return { provider: app.modelProvider, model: project.model, providerId: 'anthropic' };
  }

  const cfg = MODEL_CONFIG[selected];
  const status = await cachedCliStatus(cfg.command, now);
  if (!status.installed) {
    return {
      provider: app.modelProvider,
      model: project.model,
      providerId: 'anthropic',
      fallbackReason: `${cfg.label} is not installed — using Claude. Install + sign into \`${cfg.command}\` to use it.`,
    };
  }
  return { provider: new CliModelProvider(cfg), model: cfg.defaultModel, providerId: selected };
}
