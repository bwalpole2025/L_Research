import { PrismaClient } from '@prisma/client';
import fp from 'fastify-plugin';
import { resolveMasterKey } from './vault/keystore.js';
import { setContentMasterKey } from './content/crypto.js';
import { contentEncryptionMiddleware } from './content/middleware.js';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/**
 * Decorates the app with a shared PrismaClient. The client connects lazily on
 * first query, so registering this plugin does not require a reachable database
 * at boot (which keeps `/healthz` dependency-free).
 *
 * Document content (TexFile.content + Snapshot.files) is encrypted at rest via a
 * transparent middleware keyed off the vault master key — a DB-only breach
 * yields ciphertext, while authorised reads/writes see plaintext (see content/).
 */
export const prismaPlugin = fp(
  async (app) => {
    const prisma = new PrismaClient();
    const { key } = await resolveMasterKey(app.config);
    setContentMasterKey(key);
    prisma.$use(contentEncryptionMiddleware(prisma));
    app.decorate('prisma', prisma);
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  },
  { name: 'prisma' },
);
