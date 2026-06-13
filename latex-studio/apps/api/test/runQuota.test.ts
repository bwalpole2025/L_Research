import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChatDelta, ChatRequest, EditRequest, ModelProvider } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';

const TOKEN = 'quota-token';
const auth = { authorization: `Bearer ${TOKEN}` };

class MockProvider implements ModelProvider {
  async *chatStream(_req: ChatRequest): AsyncIterable<ChatDelta> {
    yield { text: 'ok' };
  }
  async complete(): Promise<string> {
    return 'ok';
  }
  async editRegion(_req: EditRequest): Promise<string> {
    return 'ok';
  }
}

describe('/run — per-user daily quota (429)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      modelProvider: new MockProvider(),
      config: { bearerToken: TOKEN, execPerUserDailyRuns: 1 },
    });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `quota ${Date.now()}` } });
    projectId = p.json().id;
    await app.prisma.texFile.create({ data: { projectId, path: 's.py', content: 'print(1)' } });
  });

  afterAll(async () => {
    await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('rejects a server-side run once the daily quota is spent, with a Retry-After', async () => {
    // Spend the single daily run on the shared gate for the bearer principal, then
    // release the slot so it's the QUOTA (not concurrency) that blocks the route.
    (await app.execGate.acquire('bearer', { countsAsRun: true }))();
    expect(app.execGate.runsToday('bearer')).toBe(1);

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: { path: 's.py' } });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(res.json().error).toMatch(/quota/i);
  });
});
