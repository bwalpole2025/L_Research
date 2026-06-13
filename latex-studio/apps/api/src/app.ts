import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import rateLimit from '@fastify/rate-limit';
import type { ModelProvider } from '@latex-studio/shared';
import { loadConfig, isLoopbackHost, type AppConfig } from './config.js';
import { authPlugin } from './plugins/auth.js';
import { prismaPlugin } from './prisma.js';
import { CompileService } from './compile/service.js';
import { CompletionService, type CompletionRunner } from './ai/completion/service.js';
import { assertSubscriptionAuth, createModelProvider } from './providers/index.js';
import { healthRoutes } from './routes/health.js';
import { projectRoutes } from './routes/projects.js';
import { projectFolderRoutes } from './routes/projectFolders.js';
import { fileRoutes } from './routes/files.js';
import { snapshotRoutes } from './routes/snapshots.js';
import { compileRoutes } from './routes/compile.js';
import { runRoutes } from './routes/run.js';
import { pythonCheckRoutes } from './routes/pythonCheck.js';
import { mathcheckRoutes } from './routes/mathcheck.js';
import { aiRoutes } from './routes/ai.js';
import { thesisRoutes } from './routes/thesis.js';
import { coderiveRoutes } from './routes/coderive.js';
import { reviewRoutes } from './routes/review.js';
import { libraryRoutes } from './routes/library.js';
import { docmodelRoutes } from './routes/docmodel.js';
import { previewRoutes } from './routes/preview.js';
import { usageRoutes } from './routes/usage.js';
import { diagramRoutes } from './routes/diagram.js';
import { connectorRoutes } from './routes/connectors.js';
import { Vault } from './vault/vault.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    vault: Vault;
  }
}

export interface BuildAppOptions {
  /** Overrides merged over values read from the environment. */
  config?: Partial<AppConfig>;
  /** Forwarded to Fastify; disable logging in tests with `false`. */
  logger?: boolean;
  /** Inject a CompileService (e.g. with a mock runner in tests). */
  compileService?: CompileService;
  /** Inject a ModelProvider (e.g. a mock in tests). */
  modelProvider?: ModelProvider;
  /** Inject a CompletionRunner (e.g. a mock in tests). */
  completionService?: CompletionRunner;
}

/**
 * Build a configured Fastify instance. Kept separate from server startup so
 * tests can `app.inject()` without binding a port.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config: AppConfig = { ...loadConfig(), ...options.config };

  const localOnly = isLoopbackHost(config.host);

  // Fail fast: a non-loopback bind (a real deployment) with no bearer token
  // would leave every route open behind a fail-closed-but-tokenless auth hook.
  // Local dev (loopback) may run tokenless; a non-local box must set
  // API_BEARER_TOKEN, unless the operator opts in explicitly with
  // API_ALLOW_EMPTY_BEARER=1.
  if (!config.bearerToken && !localOnly && !config.allowEmptyBearer) {
    throw new Error(
      `Refusing to boot: API_BEARER_TOKEN is empty while bound to a non-loopback host (${config.host}). ` +
        'Set API_BEARER_TOKEN, or set API_ALLOW_EMPTY_BEARER=1 to override (NOT for production).',
    );
  }

  // Refuse to boot if an API key would silently override subscription auth.
  // (Injected providers in tests skip this — they don't touch the SDK.)
  if (!options.modelProvider) assertSubscriptionAuth(config);

  // 24 MB body limit accommodates base64-encoded figure/font uploads (~33% larger).
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 24 * 1024 * 1024 });
  app.decorate('config', config);
  app.decorate('compileService', options.compileService ?? new CompileService(config));
  app.decorate('modelProvider', options.modelProvider ?? createModelProvider(config));
  app.decorate('completionService', options.completionService ?? new CompletionService(config, app.modelProvider));
  app.addHook('onClose', async () => app.completionService.shutdown());

  await app.register(sensible);
  // CORS: reflect any origin only on a local (loopback) box — a single-user dev
  // machine. On a real deployment, pin to the web app's origin so a hostile page
  // can't drive the api with the user's ambient credentials.
  await app.register(cors, { origin: localOnly ? true : config.webBaseUrl });
  await app.register(prismaPlugin);

  // Attach a per-route rate limit to the expensive endpoints WITHOUT editing the
  // route files (keeps the verification stack untouched). Matched by method+URL.
  // This onRoute hook is added BEFORE the rate-limit plugin registers its own, so
  // that config.rateLimit is set by the time the plugin inspects each new route.
  const RATE_LIMITS: Array<{ method: string; url: string; max: number }> = [
    { method: 'POST', url: '/projects/:id/compile', max: config.rateLimitCompileMax },
    { method: 'POST', url: '/projects/:id/run', max: config.rateLimitRunMax },
    { method: 'POST', url: '/projects/:id/chat', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/edit', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/fix', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/complete', max: config.rateLimitAiMax },
    // Remaining heavy AI / compute routes (LLM and/or SymPy + RAG).
    { method: 'POST', url: '/projects/:id/coderive', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/review', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/check', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/audit-maths', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/prose-check', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/python-check', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/explain-step', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/outline', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/pre-submit', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/predict-next', max: config.rateLimitAiMax },
    { method: 'POST', url: '/projects/:id/chat/threads/:tid/messages', max: config.rateLimitAiMax },
  ];
  app.addHook('onRoute', (routeOptions) => {
    const methods = ([] as string[]).concat(routeOptions.method);
    const match = RATE_LIMITS.find(
      (r) => r.url === routeOptions.url && methods.includes(r.method),
    );
    if (!match) return;
    const cfg = (routeOptions.config ?? {}) as Record<string, unknown>;
    cfg.rateLimit = { max: match.max, timeWindow: config.rateLimitWindowMs };
    routeOptions.config = cfg;
  });

  // Rate limiting: registered non-global so ONLY the expensive routes opt in
  // (via the onRoute hook above). Cheap reads and the verification stack are
  // left untouched. Per-route buckets keyed by IP; a clear 429 past the limit.
  await app.register(rateLimit, {
    global: false,
    timeWindow: config.rateLimitWindowMs,
  });

  // The credential vault needs the Prisma client, so it's decorated after it.
  app.decorate('vault', new Vault(app.prisma, config));

  // Global error handler: normalise any unhandled route error into a consistent
  // JSON shape and log it with request context. 5xx messages are hidden (no
  // internals leak); 4xx pass their message through.
  //
  // NB: this MUST precede the route registrations. Fastify captures each route's
  // error handler at REGISTRATION time (route.js: context.errorHandler =
  // this[kErrorHandler]); a setErrorHandler called *after* the encapsulated
  // feature routes register would never govern them (their 429s/500s would fall
  // through to Fastify's default serializer).
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, 'unhandled route error');
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.code(status).send({ error: status >= 500 ? 'Internal server error' : err.message });
  });

  // Auth first (global onRequest hook), then routes. Public paths are
  // allow-listed inside the auth plugin.
  await app.register(authPlugin);
  await app.register(healthRoutes);

  // Feature routes (all bearer-protected).
  await app.register(projectRoutes);
  await app.register(projectFolderRoutes);
  await app.register(fileRoutes);
  await app.register(snapshotRoutes);
  await app.register(compileRoutes);
  await app.register(runRoutes);
  await app.register(pythonCheckRoutes);
  await app.register(mathcheckRoutes);
  await app.register(aiRoutes);
  await app.register(thesisRoutes);
  await app.register(coderiveRoutes);
  await app.register(reviewRoutes);
  await app.register(libraryRoutes);
  await app.register(docmodelRoutes);
  await app.register(previewRoutes);
  await app.register(usageRoutes);
  await app.register(diagramRoutes);
  await app.register(connectorRoutes);

  return app;
}
