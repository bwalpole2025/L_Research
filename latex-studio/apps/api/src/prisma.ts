import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Decorates the app with a shared PrismaClient. The client connects lazily on
 * first query, so registering this plugin does not require a reachable database
 * at boot (which keeps `/healthz` dependency-free).
 */
export const prismaPlugin = fp(
  async (app) => {
    const prisma = new PrismaClient();
    app.decorate('prisma', prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);
