import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@latex-studio/shared';

/**
 * Liveness endpoint. Deliberately has zero dependencies (no DB, no downstream
 * services) so it stays green even before `prisma migrate` has run.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (): Promise<HealthResponse> => {
    return { status: 'ok', service: 'api' };
  });
}
