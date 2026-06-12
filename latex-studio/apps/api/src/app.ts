import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import type { ModelProvider } from '@latex-studio/shared';
import { loadConfig, type AppConfig } from './config.js';
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
import { mathcheckRoutes } from './routes/mathcheck.js';
import { aiRoutes } from './routes/ai.js';
import { thesisRoutes } from './routes/thesis.js';
import { coderiveRoutes } from './routes/coderive.js';
import { reviewRoutes } from './routes/review.js';
import { libraryRoutes } from './routes/library.js';
import { docmodelRoutes } from './routes/docmodel.js';
import { previewRoutes } from './routes/preview.js';
import { usageRoutes } from './routes/usage.js';
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

  // Refuse to boot if an API key would silently override subscription auth.
  // (Injected providers in tests skip this — they don't touch the SDK.)
  if (!options.modelProvider) assertSubscriptionAuth(config);

  // 24 MB body limit accommodates base64-encoded figure/font uploads (~33% larger).
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 24 * 1024 * 1024 });
  app.decorate('config', config);
  app.decorate('compileService', options.compileService ?? new CompileService(config));
  app.decorate('modelProvider', options.modelProvider ?? createModelProvider(config));
  app.decorate('completionService', options.completionService ?? new CompletionService(config));
  app.addHook('onClose', async () => app.completionService.shutdown());

  await app.register(sensible);
  await app.register(cors, { origin: true });
  await app.register(prismaPlugin);

  // The credential vault needs the Prisma client, so it's decorated after it.
  app.decorate('vault', new Vault(app.prisma, config));

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
  await app.register(mathcheckRoutes);
  await app.register(aiRoutes);
  await app.register(thesisRoutes);
  await app.register(coderiveRoutes);
  await app.register(reviewRoutes);
  await app.register(libraryRoutes);
  await app.register(docmodelRoutes);
  await app.register(previewRoutes);
  await app.register(usageRoutes);
  await app.register(connectorRoutes);

  return app;
}
