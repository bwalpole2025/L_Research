import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  AiErrorKind,
  ChatDelta,
  ChatRequest,
  EditRequest,
  ModelProvider,
} from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { AiProviderError } from '../src/providers/errors.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

/** A deterministic ModelProvider for route tests (no SDK, no network). */
class MockProvider implements ModelProvider {
  constructor(
    private readonly opts: { tokens?: string[]; replacement?: string; throwKind?: AiErrorKind } = {},
  ) {}

  async *chatStream(_req: ChatRequest): AsyncIterable<ChatDelta> {
    if (this.opts.throwKind) throw new AiProviderError(this.opts.throwKind, 'mock failure');
    for (const text of this.opts.tokens ?? ['Hello', ' world']) yield { text };
  }

  async complete(): Promise<string> {
    if (this.opts.throwKind) throw new AiProviderError(this.opts.throwKind, 'mock failure');
    return 'ok';
  }

  async editRegion(_req: EditRequest): Promise<string> {
    if (this.opts.throwKind) throw new AiProviderError(this.opts.throwKind, 'mock failure');
    return this.opts.replacement ?? 'REPLACED';
  }
}

function makeApp(provider: ModelProvider): Promise<FastifyInstance> {
  return buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: provider });
}

function parseSse(payload: string): Array<{ event: string; data: unknown }> {
  return payload
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const event = /event: (.*)/.exec(block)?.[1] ?? '';
      const data = /data: (.*)/.exec(block)?.[1] ?? 'null';
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe('AI routes', () => {
  let okApp: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    okApp = await makeApp(new MockProvider({ tokens: ['Hello', ' world'] }));
    await okApp.ready();
    const res = await okApp.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `ai ${Date.now()}` } });
    projectId = res.json().id;
  });

  afterAll(async () => {
    if (projectId) await okApp.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await okApp.close();
  });

  it('GET /healthz/model does a round trip and reports provider/model/ok/latency', async () => {
    const res = await okApp.inject({ method: 'GET', url: '/healthz/model', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ provider: 'agent-sdk', model: 'claude-sonnet-4-6', ok: true });
    expect(typeof body.latencyMs).toBe('number');
  });

  it('GET /ai/models returns the allowlist including the default', async () => {
    const res = await okApp.inject({ method: 'GET', url: '/ai/models', headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.models).toContain('claude-sonnet-4-6');
    expect(typeof body.live).toBe('boolean');
  });

  it('streams chat token-by-token and persists the transcript (survives reload)', async () => {
    const res = await okApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/chat`,
      headers: auth,
      payload: { message: 'Hi there', context: { activeFile: 'main.tex', cursorLine: 1 } },
    });
    expect(res.statusCode).toBe(200);
    const events = parseSse(res.payload);
    const meta = events.find((e) => e.event === 'meta')?.data as { threadId: string };
    expect(meta.threadId).toBeTruthy();
    expect(events.filter((e) => e.event === 'token').map((e) => (e.data as { text: string }).text)).toEqual(['Hello', ' world']);
    expect(events.some((e) => e.event === 'done')).toBe(true);

    // Reload: history persisted in Postgres.
    const msgs = await okApp.inject({ method: 'GET', url: `/chat/threads/${meta.threadId}/messages`, headers: auth });
    const list = msgs.json() as Array<{ role: string; content: string }>;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ role: 'user', content: 'Hi there' });
    expect(list[1]).toMatchObject({ role: 'assistant', content: 'Hello world' });

    // Thread appears in the project's thread list.
    const threads = await okApp.inject({ method: 'GET', url: `/projects/${projectId}/chat/threads`, headers: auth });
    expect((threads.json() as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('POST /edit returns the replacement and logs the call', async () => {
    const res = await okApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/edit`,
      headers: auth,
      payload: { filePath: 'main.tex', selection: '\\begin{aligm}', context: '', instruction: 'fix the typo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ replacement: 'REPLACED' });

    const logs = await okApp.inject({ method: 'GET', url: `/projects/${projectId}/ai/logs`, headers: auth });
    const rows = logs.json() as Array<{ route: string; ok: boolean }>;
    expect(rows.some((r) => r.route === 'edit' && r.ok)).toBe(true);
  });

  it('POST /fix routes through the same replacement flow', async () => {
    const res = await okApp.inject({
      method: 'POST',
      url: `/projects/${projectId}/fix`,
      headers: auth,
      payload: {
        filePath: 'main.tex',
        region: '\\begin{align}x\\end{equation}',
        diagnostic: { message: '\\begin{align} ended by \\end{equation}', line: 3 },
        logExcerpt: '! LaTeX Error: ...',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ replacement: 'REPLACED' });
  });

  it('GET /ai/status reports available after a successful call', async () => {
    const res = await okApp.inject({ method: 'GET', url: '/ai/status', headers: auth });
    expect(res.json()).toMatchObject({ available: true });
  });

  it('surfaces credit exhaustion: 402 + kind, and gates AI via /ai/status', async () => {
    const creditApp = await makeApp(new MockProvider({ throwKind: 'credit_exhausted' }));
    await creditApp.ready();
    try {
      const res = await creditApp.inject({
        method: 'POST',
        url: `/projects/${projectId}/edit`,
        headers: auth,
        payload: { filePath: 'main.tex', selection: 'x', context: '', instruction: 'change' },
      });
      expect(res.statusCode).toBe(402);
      expect(res.json().kind).toBe('credit_exhausted');

      const status = await creditApp.inject({ method: 'GET', url: '/ai/status', headers: auth });
      expect(status.json()).toMatchObject({ available: false, reason: 'credit_exhausted' });
    } finally {
      await creditApp.close();
    }
  });

  it('surfaces an auth error as a comprehensible status, not a crash', async () => {
    const authApp = await makeApp(new MockProvider({ throwKind: 'auth' }));
    await authApp.ready();
    try {
      const res = await authApp.inject({
        method: 'POST',
        url: `/projects/${projectId}/edit`,
        headers: auth,
        payload: { filePath: 'main.tex', selection: 'x', context: '', instruction: 'change' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().kind).toBe('auth');

      const status = await authApp.inject({ method: 'GET', url: '/ai/status', headers: auth });
      expect(status.json()).toMatchObject({ available: false, reason: 'auth' });
    } finally {
      await authApp.close();
    }
  });
});
