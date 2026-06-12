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

  // ─── Python "Run" sandbox (pyrun) ──────────────────────────────────────────
  /**
   * How a project's Python is executed. `docker` (default) runs each script in a
   * fresh throwaway `docker run --rm` container from the `pyrunImage` — non-root,
   * resource/time-limited, network off by default. `local` spawns host `python3`
   * directly: a DEV/TEST-ONLY fallback that is NOT sandboxed (see ADR-013).
   */
  pyrunMode: TexliveMode;
  /** Image used for `docker run` Python executions (built by the pyrun service). */
  pyrunImage: string;
  /**
   * HOST path of the compile workspace, used as the `docker run -v` source so the
   * sandbox can read the project's files. Equals `compileWorkspace` in the normal
   * host-api dev setup; override when the api itself runs in a container.
   */
  pyrunWorkspaceHost: string;
  /** Hard wall-clock timeout for a run, in milliseconds (SIGKILL on expiry). */
  pyrunTimeoutMs: number;
  /** CPU cap passed to `docker run --cpus`. */
  pyrunCpus: string;
  /** Memory cap passed to `docker run --memory`. */
  pyrunMemory: string;
  /** Process cap passed to `docker run --pids-limit`. */
  pyrunPids: number;
  /** Non-root user the sandbox runs as (`docker run --user`). */
  pyrunUser: string;
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
  /** URL of a LOCAL LanguageTool container for prose grammar/style (optional). */
  languageToolUrl: string;
  /** Postgres connection string (used by Prisma). */
  databaseUrl: string;

  // ─── Connectors framework ──────────────────────────────────────────────────
  /**
   * Fallback master key for the credential vault when the OS keychain is
   * unavailable (Docker/headless/CI). The keychain is preferred; this env key
   * keeps those paths bootable. Empty ⇒ rely on the keychain only.
   */
  connectorsMasterKey: string;
  /**
   * Public base URL the api is reachable at, for OAuth redirect URIs
   * (`<base>/connectors/:id/callback`). Defaults to the localhost bind.
   */
  oauthRedirectBaseUrl: string;
  /** Where the web app lives — the OAuth callback redirects back here. */
  webBaseUrl: string;
  /** OAuth client credentials (the user registers these apps; never logged). */
  googleOAuthClientId: string;
  googleOAuthClientSecret: string;
  notionOAuthClientId: string;
  notionOAuthClientSecret: string;
  dropboxOAuthClientId: string;
  dropboxOAuthClientSecret: string;
  onedriveOAuthClientId: string;
  onedriveOAuthClientSecret: string;
  /** Optional API keys for literature sources (stored via the vault when set in UI). */
  zoteroApiKey: string;
  semanticScholarApiKey: string;
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
    pyrunMode: env.PYRUN_MODE === 'local' ? 'local' : 'docker',
    pyrunImage: env.PYRUN_IMAGE ?? 'latex-studio-pyrun',
    pyrunWorkspaceHost: env.PYRUN_WORKSPACE_HOST ?? env.COMPILE_WORKSPACE ?? resolve(REPO_ROOT, '.compile-workspace'),
    pyrunTimeoutMs: Number.parseInt(env.PYRUN_TIMEOUT_MS ?? '60000', 10),
    pyrunCpus: env.PYRUN_CPUS ?? '1',
    pyrunMemory: env.PYRUN_MEMORY ?? '512m',
    pyrunPids: Number.parseInt(env.PYRUN_PIDS_LIMIT ?? '256', 10),
    pyrunUser: env.PYRUN_USER ?? '1000:1000',
    modelProvider: env.MODEL_PROVIDER === 'api' ? 'api' : 'agent-sdk',
    model: env.MODEL ?? DEFAULT_MODEL,
    completionsProvider: env.COMPLETIONS_PROVIDER === 'api' ? 'api' : 'agent-sdk',
    completionModel: env.COMPLETION_MODEL ?? DEFAULT_COMPLETION_MODEL,
    completionsWarm: env.COMPLETIONS_WARM !== 'false',
    completionWarmIdleMs: Number.parseInt(env.COMPLETION_WARM_IDLE_MS ?? '600000', 10),
    languageToolUrl: env.LANGUAGETOOL_URL ?? '',
    databaseUrl: env.DATABASE_URL ?? '',
    connectorsMasterKey: env.CONNECTORS_MASTER_KEY ?? '',
    oauthRedirectBaseUrl: env.OAUTH_REDIRECT_BASE_URL ?? `http://127.0.0.1:${Number.parseInt(env.API_PORT ?? '4000', 10)}`,
    webBaseUrl: env.WEB_BASE_URL ?? 'http://127.0.0.1:3000',
    googleOAuthClientId: env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    googleOAuthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    notionOAuthClientId: env.NOTION_OAUTH_CLIENT_ID ?? '',
    notionOAuthClientSecret: env.NOTION_OAUTH_CLIENT_SECRET ?? '',
    dropboxOAuthClientId: env.DROPBOX_OAUTH_CLIENT_ID ?? '',
    dropboxOAuthClientSecret: env.DROPBOX_OAUTH_CLIENT_SECRET ?? '',
    onedriveOAuthClientId: env.ONEDRIVE_OAUTH_CLIENT_ID ?? '',
    onedriveOAuthClientSecret: env.ONEDRIVE_OAUTH_CLIENT_SECRET ?? '',
    zoteroApiKey: env.ZOTERO_API_KEY ?? '',
    semanticScholarApiKey: env.SEMANTIC_SCHOLAR_API_KEY ?? '',
  };
}
