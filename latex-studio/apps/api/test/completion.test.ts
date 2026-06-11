import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type {
  ChatDelta,
  ChatRequest,
  CompletionInlineRequest,
  CompletionResult,
  ModelProvider,
} from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import {
  COMPLETION_SYSTEM_PROMPT,
  TOKEN_CAPS,
  buildCompletionUserPrompt,
  parseCompletion,
} from '../src/ai/completion/prompts.js';
import { buildStats } from '../src/ai/completion/stats.js';
import type { CompletionRunner } from '../src/ai/completion/service.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('completion prompts', () => {
  it('uses the exact inline-completion-engine system prompt', () => {
    expect(COMPLETION_SYSTEM_PROMPT).toContain('inline completion engine for LaTeX documents');
    expect(COMPLETION_SYSTEM_PROMPT).toContain('Output ONLY the text to insert at <CURSOR>');
  });

  it('align mode reminds about & alignment and \\\\ terminators and marks the cursor', () => {
    const p = buildCompletionUserPrompt({ prefix: 'x &= 1 \\\\\n', suffix: '\n\\end{align}', mode: 'display-align' });
    expect(p).toContain('&');
    expect(p).toContain('\\\\');
    expect(p).toContain('<CURSOR>');
    expect(p).toContain(`~${TOKEN_CAPS['display-align']} tokens`);
  });

  it('token caps: prose ~40, math ~60, preamble ~20', () => {
    expect(TOKEN_CAPS.prose).toBe(40);
    expect(TOKEN_CAPS['inline-math']).toBe(60);
    expect(TOKEN_CAPS['display-align']).toBe(60);
    expect(TOKEN_CAPS.preamble).toBe(20);
  });

  it('parseCompletion strips fences, <CURSOR>, leading newlines, trailing space', () => {
    expect(parseCompletion('```latex\n\\alpha + \\beta\n```')).toBe('\\alpha + \\beta');
    expect(parseCompletion('foo<CURSOR>bar   ')).toBe('foobar');
    expect(parseCompletion('\n\nx = 1\n')).toBe('x = 1');
    expect(parseCompletion(' leading space kept')).toBe(' leading space kept');
  });
});

describe('buildStats', () => {
  it('computes per-(provider,model,variant) percentiles, okRate, daily, total', () => {
    const rows = [
      { provider: 'agent-sdk', model: 'claude-haiku-4-5', variant: 'warm', latencyMs: 500, ok: true, createdAt: '2026-06-11T10:00:00Z' },
      { provider: 'agent-sdk', model: 'claude-haiku-4-5', variant: 'warm', latencyMs: 700, ok: true, createdAt: '2026-06-11T10:01:00Z' },
      { provider: 'agent-sdk', model: 'claude-haiku-4-5', variant: 'baseline', latencyMs: 3000, ok: true, createdAt: '2026-06-10T10:00:00Z' },
      { provider: 'agent-sdk', model: 'claude-haiku-4-5', variant: 'warm', latencyMs: 0, ok: false, createdAt: '2026-06-11T10:02:00Z' },
    ];
    const s = buildStats(rows);
    expect(s.totalCompletions).toBe(4);
    const warm = s.buckets.find((b) => b.variant === 'warm');
    expect(warm?.stats.count).toBe(2); // only ok rows counted in latency
    expect(warm?.stats.p95).toBe(700);
    expect(warm?.okRate).toBeCloseTo(2 / 3, 5);
    const baseline = s.buckets.find((b) => b.variant === 'baseline');
    expect(baseline?.stats.p95).toBe(3000);
    expect(s.daily).toHaveLength(2);
  });
});

class MockProvider implements ModelProvider {
  // eslint-disable-next-line require-yield
  async *chatStream(_req: ChatRequest): AsyncIterable<ChatDelta> {
    throw new Error('unused');
  }
  async complete(): Promise<string> {
    return 'ok';
  }
  async editRegion(): Promise<string> {
    return 'X';
  }
}

const mockCompletion: CompletionRunner = {
  async complete(_projectId: string, req: CompletionInlineRequest): Promise<CompletionResult> {
    return {
      completion: 'X',
      latencyMs: 42,
      variant: req.baseline ? 'baseline' : 'warm',
      provider: req.provider ?? 'agent-sdk',
      model: req.model ?? 'claude-haiku-4-5',
    };
  },
  shutdown() {},
};

describe('completion route', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      config: { bearerToken: TOKEN },
      modelProvider: new MockProvider(),
      completionService: mockCompletion,
    });
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `complete ${Date.now()}` } });
    projectId = res.json().id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('returns a completion result and logs the call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/complete`,
      headers: auth,
      payload: { prefix: 'Hello ', suffix: '', mode: 'prose' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ completion: 'X', variant: 'warm', provider: 'agent-sdk', model: 'claude-haiku-4-5' });

    const logs = await app.inject({ method: 'GET', url: `/projects/${projectId}/ai/logs`, headers: auth });
    expect((logs.json() as Array<{ route: string }>).some((l) => l.route === 'complete')).toBe(true);
  });

  it('/ai/stats aggregates baseline vs warm', async () => {
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/complete`,
      headers: auth,
      payload: { prefix: 'a', mode: 'prose', baseline: true },
    });
    const res = await app.inject({ method: 'GET', url: '/ai/stats', headers: auth });
    const stats = res.json() as { totalCompletions: number; buckets: Array<{ variant: string }> };
    expect(stats.totalCompletions).toBeGreaterThanOrEqual(2);
    const variants = stats.buckets.map((b) => b.variant);
    expect(variants).toContain('warm');
    expect(variants).toContain('baseline');
  });

  it('rejects an invalid mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/complete`,
      headers: auth,
      payload: { prefix: 'a', mode: 'nonsense' },
    });
    expect(res.statusCode).toBe(400);
  });
});
