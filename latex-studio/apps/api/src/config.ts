import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type TexliveMode = 'docker' | 'local';
export type ModelProviderKind = 'agent-sdk' | 'api';

/** Default chat/edit model (Sonnet) — overridable per project. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** Default completion model — fastest (Haiku-class), independent of chat. */
export const DEFAULT_COMPLETION_MODEL = 'claude-haiku-4-5';

export interface AppConfig {
  /** Address the server binds to. 127.0.0.1 on the host; 0.0.0.0 in docker. */
  host: string;
  port: number;
  /** Shared bearer token required on every non-public route. */
  bearerToken: string;
  /** Base URL of the SymPy mathcheck microservice. */
  mathcheckUrl: string;
  /** How LaTeX compilation is performed. */
  texliveMode: TexliveMode;
  /**
   * Host filesystem directory holding per-project compile working dirs. In
   * docker mode this is bind-mounted into the texlive container at
   * `texliveWorkspace`, so the api (host or container) and texlive share files.
   */
  compileWorkspace: string;
  /** Path of the shared workspace *inside* the texlive container. */
  texliveWorkspace: string;
  /** Name of the texlive container to `docker exec` into (docker mode). */
  texliveContainer: string;
  /** Hard compile timeout in milliseconds. */
  compileTimeoutMs: number;
  /**
   * Which ModelProvider backs the AI features. `agent-sdk` uses the Claude
   * Agent SDK over your `claude login` subscription (no API key). `api` selects
   * the not-yet-configured pay-as-you-go stub (escape hatch). See ADR-004.
   */
  modelProvider: ModelProviderKind;
  /** Default model for chat/edit (subscription-accepted id/alias). */
  model: string;
  /**
   * Per-route provider override for /complete (ghost-text completions). Lets
   * completions move to a metered `api` provider without touching chat/edit —
   * a config change, not a code change (ADR-006). Defaults to agent-sdk.
   */
  completionsProvider: ModelProviderKind;
  /** Default completion model (Haiku-class). */
  completionModel: string;
  /** Keep a pre-warmed SDK pool per project for low-latency completions. */
  completionsWarm: boolean;
  /** Idle timeout (ms) before a project's warm completion pool is killed. */
  completionWarmIdleMs: number;
  /** Postgres connection string (used by Prisma). */
  databaseUrl: string;
}

/** Repo root, derived from this module's location (independent of cwd). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Read configuration from the environment, applying safe local defaults. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.API_HOST ?? '127.0.0.1',
    port: Number.parseInt(env.API_PORT ?? '4000', 10),
    bearerToken: env.API_BEARER_TOKEN ?? '',
    mathcheckUrl: env.MATHCHECK_URL ?? 'http://127.0.0.1:8000',
    texliveMode: env.TEXLIVE_MODE === 'local' ? 'local' : 'docker',
    compileWorkspace: env.COMPILE_WORKSPACE ?? resolve(REPO_ROOT, '.compile-workspace'),
    texliveWorkspace: env.TEXLIVE_WORKSPACE ?? '/workspace',
    texliveContainer: env.TEXLIVE_CONTAINER ?? 'latex-studio-texlive',
    compileTimeoutMs: Number.parseInt(env.COMPILE_TIMEOUT_MS ?? '120000', 10),
    modelProvider: env.MODEL_PROVIDER === 'api' ? 'api' : 'agent-sdk',
    model: env.MODEL ?? DEFAULT_MODEL,
    completionsProvider: env.COMPLETIONS_PROVIDER === 'api' ? 'api' : 'agent-sdk',
    completionModel: env.COMPLETION_MODEL ?? DEFAULT_COMPLETION_MODEL,
    completionsWarm: env.COMPLETIONS_WARM !== 'false',
    completionWarmIdleMs: Number.parseInt(env.COMPLETION_WARM_IDLE_MS ?? '600000', 10),
    databaseUrl: env.DATABASE_URL ?? '',
  };
}
