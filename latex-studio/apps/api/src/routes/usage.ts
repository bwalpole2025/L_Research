import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bumpUsageScore, type UsageStatRow } from '@latex-studio/shared';

/**
 * ADAPTIVE AUTOCOMPLETE usage stats. The dropdown learns which items the user
 * accepts; this is the durable store behind the client cache. Two scopes:
 *  · "app"        — general typing habits (commands, environments, snippets,
 *                   packages) shared across every project;
 *  · <projectId>  — document-specific keys (cite keys, labels, file paths)
 *                   that mean nothing elsewhere.
 * Scoring is frequency + recency with a 30-day half-life — see the shared
 * usage-scoring module. Local usage data only; never sent anywhere external.
 */

const postBody = z.object({
  events: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        scope: z.enum(['app', 'project']),
        at: z.string().datetime().optional(),
      }),
    )
    .min(1)
    .max(200),
});

function toRow(s: { key: string; count: number; score: number; firstUsedAt: Date; lastUsedAt: Date }): UsageStatRow {
  return {
    key: s.key,
    count: s.count,
    score: s.score,
    firstUsedAt: s.firstUsedAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
  };
}

export async function usageRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/projects/:id/usage', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const rows = await app.prisma.usageStat.findMany({ where: { scope: { in: ['app', project.id] } } });
    return {
      app: rows.filter((r) => r.scope === 'app').map(toRow),
      project: rows.filter((r) => r.scope === project.id).map(toRow),
    };
  });

  app.post<{ Params: { id: string } }>('/projects/:id/usage', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = postBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    for (const ev of parsed.data.events) {
      const scope = ev.scope === 'app' ? 'app' : project.id;
      const at = ev.at ? Date.parse(ev.at) : Date.now();
      const existing = await app.prisma.usageStat.findUnique({ where: { scope_key: { scope, key: ev.key } } });
      if (existing) {
        const bumped = bumpUsageScore(existing.score, existing.lastUsedAt, at);
        await app.prisma.usageStat.update({
          where: { id: existing.id },
          data: { count: existing.count + 1, score: bumped.score, lastUsedAt: new Date(bumped.lastUsedAt) },
        });
      } else {
        await app.prisma.usageStat.create({
          data: { scope, key: ev.key, count: 1, score: 1, firstUsedAt: new Date(at), lastUsedAt: new Date(at) },
        });
      }
    }
    return reply.code(204).send();
  });

  app.delete<{ Params: { id: string }; Querystring: { scope?: string } }>(
    '/projects/:id/usage',
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
      if (!project) return reply.callNotFound();
      const scope = request.query.scope === 'app' ? 'app' : project.id;
      await app.prisma.usageStat.deleteMany({ where: { scope } });
      return reply.code(204).send();
    },
  );
}
