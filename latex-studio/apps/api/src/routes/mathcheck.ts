import type { FastifyInstance } from 'fastify';

/** Proxy the bearer-protected /mathcheck/* routes to the internal mathcheck service. */
const ROUTES: Array<[string, string]> = [
  ['/mathcheck/parse', '/parse'],
  ['/mathcheck/equivalent', '/equivalent'],
  ['/mathcheck/check-derivation', '/check-derivation'],
];

export async function mathcheckRoutes(app: FastifyInstance): Promise<void> {
  for (const [route, target] of ROUTES) {
    app.post(route, async (request, reply) => {
      let upstream: Response;
      try {
        upstream = await fetch(`${app.config.mathcheckUrl}${target}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request.body ?? {}),
        });
      } catch {
        return reply.code(502).send({ error: 'mathcheck service is unavailable' });
      }
      const text = await upstream.text();
      reply.code(upstream.status);
      reply.header('content-type', upstream.headers.get('content-type') ?? 'application/json');
      return reply.send(text);
    });
  }
}
