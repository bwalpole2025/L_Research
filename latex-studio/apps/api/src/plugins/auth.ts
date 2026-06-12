import fp from 'fastify-plugin';

/**
 * Paths reachable without the bearer token. Health probes must stay public so
 * docker/orchestrators can check liveness without holding the secret.
 */
const PUBLIC_PATHS = new Set<string>(['/healthz', '/readyz']);

/**
 * The OAuth redirect target is reached by the browser via the provider's
 * redirect, which cannot carry our bearer token. It is protected instead by the
 * single-use, server-generated `state` value (validated in the route). Shape:
 * `/connectors/:id/callback`.
 */
function isPublicCallback(path: string): boolean {
  return /^\/connectors\/[^/]+\/callback$/.test(path);
}

/**
 * Bearer-token guard. Registered as a global `onRequest` hook so it runs before
 * routing — even unknown routes are rejected unless they are explicitly public.
 *
 * Fails closed: if `API_BEARER_TOKEN` is not configured, every protected route
 * returns 503 rather than silently allowing unauthenticated access.
 */
export const authPlugin = fp(
  async (app) => {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (PUBLIC_PATHS.has(path) || isPublicCallback(path)) return;

      const token = app.config.bearerToken;
      if (!token) {
        reply.code(503).send({ error: 'API_BEARER_TOKEN is not configured' });
        return reply;
      }

      const header = request.headers.authorization;
      if (header !== `Bearer ${token}`) {
        reply.code(401).send({ error: 'Unauthorized' });
        return reply;
      }
    });
  },
  { name: 'auth' },
);
