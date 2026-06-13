import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ChatDelta, ChatRequest, EditRequest, ModelProvider } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';

const TOKEN = 'resilience-token';
const auth = { authorization: `Bearer ${TOKEN}` };

/** A no-op ModelProvider so buildApp skips the SDK/subscription check. */
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

describe('boot: bearer fail-fast', () => {
  it('refuses to boot with an empty bearer on a non-loopback host', async () => {
    await expect(
      buildApp({
        logger: false,
        config: { host: '0.0.0.0', bearerToken: '' },
        modelProvider: new MockProvider(),
      }),
    ).rejects.toThrow(/Refusing to boot/);
  });

  it('still boots with an empty bearer on loopback (local dev)', async () => {
    const app = await buildApp({
      logger: false,
      config: { host: '127.0.0.1', bearerToken: '' },
      modelProvider: new MockProvider(),
    });
    await app.ready();
    expect(app.config.bearerToken).toBe('');
    await app.close();
  });

  it('boots with an empty bearer on a non-loopback host given the explicit escape', async () => {
    const app = await buildApp({
      logger: false,
      config: { host: '0.0.0.0', bearerToken: '', allowEmptyBearer: true },
      modelProvider: new MockProvider(),
    });
    await app.ready();
    await app.close();
  });
});

describe('CORS origin pinning', () => {
  const PINNED = 'https://app.example.com';
  const ATTACKER = 'https://evil.example';
  let localApp: FastifyInstance;
  let prodApp: FastifyInstance;

  beforeAll(async () => {
    localApp = await buildApp({
      logger: false,
      config: { host: '127.0.0.1', bearerToken: TOKEN, webBaseUrl: PINNED },
      modelProvider: new MockProvider(),
    });
    prodApp = await buildApp({
      logger: false,
      config: { host: '0.0.0.0', bearerToken: TOKEN, webBaseUrl: PINNED },
      modelProvider: new MockProvider(),
    });
    await localApp.ready();
    await prodApp.ready();
  });

  afterAll(async () => {
    await localApp.close();
    await prodApp.close();
  });

  it('reflects any origin on loopback (permissive local dev)', async () => {
    const res = await localApp.inject({ method: 'GET', url: '/healthz', headers: { origin: ATTACKER } });
    expect(res.headers['access-control-allow-origin']).toBe(ATTACKER);
  });

  it('pins the allowed origin on a non-loopback host, ignoring the request origin', async () => {
    const res = await prodApp.inject({ method: 'GET', url: '/healthz', headers: { origin: ATTACKER } });
    expect(res.headers['access-control-allow-origin']).toBe(PINNED);
    expect(res.headers['access-control-allow-origin']).not.toBe(ATTACKER);
  });
});

describe('rate limiting on expensive routes', () => {
  // A non-existent project id so each handler 404s fast (before docker/SDK).
  const MISSING = '00000000-0000-0000-0000-000000000000';
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      modelProvider: new MockProvider(),
      config: {
        bearerToken: TOKEN,
        rateLimitWindowMs: 60_000,
        rateLimitCompileMax: 2,
        rateLimitRunMax: 2,
        rateLimitAiMax: 2,
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function hammer(url: string, n: number): Promise<number[]> {
    const codes: number[] = [];
    for (let i = 0; i < n; i++) {
      const res = await app.inject({ method: 'POST', url, headers: auth, payload: {} });
      codes.push(res.statusCode);
    }
    return codes;
  }

  it('returns a clear 429 on /compile past the limit', async () => {
    const codes = await hammer(`/projects/${MISSING}/compile`, 3);
    expect(codes.slice(0, 2).every((c) => c !== 429)).toBe(true);
    expect(codes[2]).toBe(429);

    const blocked = await app.inject({
      method: 'POST',
      url: `/projects/${MISSING}/compile`,
      headers: auth,
      payload: {},
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(blocked.json().error).toMatch(/rate limit/i);
  });

  it('returns 429 on /run past the limit', async () => {
    const codes = await hammer(`/projects/${MISSING}/run`, 3);
    expect(codes[2]).toBe(429);
  });

  it('limits the AI routes (e.g. /chat)', async () => {
    const codes = await hammer(`/projects/${MISSING}/chat`, 3);
    expect(codes[2]).toBe(429);
  });

  it('keeps separate buckets per route (exhausting /compile does not 429 /edit)', async () => {
    // /compile is already exhausted by the test above; /edit has its own counter.
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${MISSING}/edit`,
      headers: auth,
      payload: {},
    });
    expect(res.statusCode).not.toBe(429);
  });

  it('does not rate-limit a verification-stack route', async () => {
    // The mathcheck routes carry no rate limit — hammering one never 429s.
    // A prose payload trips the maths guard (422) without any upstream call.
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/mathcheck/parse',
        headers: auth,
        payload: { latex: 'the quick brown fox jumps' },
      });
      expect(res.statusCode).not.toBe(429);
    }
  });
});

describe('global error handler', () => {
  let app: FastifyInstance;
  let logError: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = await buildApp({
      logger: false,
      config: { bearerToken: TOKEN },
      modelProvider: new MockProvider(),
    });
    // Add probe routes BEFORE ready(); they inherit the global error handler + auth.
    app.get('/__boom__', async () => {
      throw new Error('kaboom internals: secret stack');
    });
    app.get('/__bad__', async () => {
      const err = new Error('that input was invalid') as Error & { statusCode?: number };
      err.statusCode = 400;
      throw err;
    });
    await app.ready();
    logError = vi.spyOn(app.log, 'error');
  });

  afterAll(async () => {
    logError.mockRestore();
    await app.close();
  });

  it('normalises an unhandled 5xx error and hides internals', async () => {
    const res = await app.inject({ method: 'GET', url: '/__boom__', headers: auth });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error' });
    expect(res.body).not.toContain('kaboom');
  });

  it('logs the unhandled error with request context', async () => {
    logError.mockClear();
    await app.inject({ method: 'GET', url: '/__boom__', headers: auth });
    expect(logError).toHaveBeenCalled();
    const call = logError.mock.calls.at(-1);
    expect(call?.[0]).toMatchObject({ err: expect.anything() });
    expect(call?.[1]).toBe('unhandled route error');
  });

  it('passes a 4xx error message through unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/__bad__', headers: auth });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'that input was invalid' });
  });
});
