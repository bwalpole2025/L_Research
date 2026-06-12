import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { decayedUsageScore, type UsageStatRow } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';

/**
 * Adaptive-autocomplete usage store (UsageStat). Requires a reachable Postgres.
 * Keys carry a unique suffix and every row this suite creates is removed in
 * afterAll, so it is safe against the dev DB.
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const RUN = `vt${Date.now()}`;
const DAY = 24 * 60 * 60 * 1000;

describe('usage routes (adaptive autocomplete)', () => {
  let app: FastifyInstance;
  let projectA: string;
  let projectB: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    for (const name of ['A', 'B']) {
      const res = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `usage ${RUN} ${name}` } });
      expect(res.statusCode).toBe(201);
      if (name === 'A') projectA = res.json().id;
      else projectB = res.json().id;
    }
  });

  afterAll(async () => {
    await app.prisma.usageStat.deleteMany({ where: { key: { contains: RUN } } }).catch(() => undefined);
    for (const id of [projectA, projectB]) {
      await app.prisma.project.delete({ where: { id } }).catch(() => undefined);
      await app.prisma.usageStat.deleteMany({ where: { scope: id } }).catch(() => undefined);
    }
    await app.close();
  });

  const post = (projectId: string, events: Array<{ key: string; scope: 'app' | 'project'; at?: string }>) =>
    app.inject({ method: 'POST', url: `/projects/${projectId}/usage`, headers: auth, payload: { events } });

  const get = async (projectId: string) => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/usage`, headers: auth });
    expect(res.statusCode).toBe(200);
    return res.json() as { app: UsageStatRow[]; project: UsageStatRow[] };
  };

  it('accepts reconcile into UsageStat: count increments, score folds with decay, lastUsedAt advances', async () => {
    const t0 = Date.now() - 30 * DAY; // one half-life ago
    expect((await post(projectA, [{ key: `cmd:frac-${RUN}`, scope: 'app', at: new Date(t0).toISOString() }])).statusCode).toBe(204);
    expect((await post(projectA, [{ key: `cmd:frac-${RUN}`, scope: 'app' }])).statusCode).toBe(204);

    const row = await app.prisma.usageStat.findFirst({ where: { key: `cmd:frac-${RUN}`, scope: 'app' } });
    expect(row).not.toBeNull();
    expect(row!.count).toBe(2);
    // Second accept: decayed first (≈0.5) + 1.
    expect(row!.score).toBeGreaterThan(1.45);
    expect(row!.score).toBeLessThan(1.55);
    expect(Date.now() - row!.lastUsedAt.getTime()).toBeLessThan(60_000);
  });

  it('RECENCY at read time: heavy-but-stale decays below light-but-fresh', async () => {
    const stale = Date.now() - 90 * DAY;
    await post(projectA, Array.from({ length: 8 }, () => ({ key: `cmd:stale-${RUN}`, scope: 'app' as const, at: new Date(stale).toISOString() })));
    await post(projectA, Array.from({ length: 3 }, () => ({ key: `cmd:fresh-${RUN}`, scope: 'app' as const })));

    const { app: rows } = await get(projectA);
    const now = Date.now();
    const eff = (key: string) => {
      const r = rows.find((x) => x.key === key)!;
      return decayedUsageScore(r.score, r.lastUsedAt, now);
    };
    expect(eff(`cmd:fresh-${RUN}`)).toBeGreaterThan(eff(`cmd:stale-${RUN}`));
  });

  it('SCOPING: app habits are visible from another project; project keys never leak', async () => {
    await post(projectA, [{ key: `cite:basset-${RUN}`, scope: 'project' }]);

    const fromB = await get(projectB);
    expect(fromB.app.map((r) => r.key)).toContain(`cmd:frac-${RUN}`); // habit carried
    expect(fromB.project.map((r) => r.key)).not.toContain(`cite:basset-${RUN}`); // key did not leak

    const fromA = await get(projectA);
    expect(fromA.project.map((r) => r.key)).toContain(`cite:basset-${RUN}`);
  });

  it('reset clears exactly the chosen scope', async () => {
    await post(projectB, [{ key: `cite:other-${RUN}`, scope: 'project' }]);
    const del = await app.inject({ method: 'DELETE', url: `/projects/${projectB}/usage?scope=project`, headers: auth });
    expect(del.statusCode).toBe(204);

    const after = await get(projectB);
    expect(after.project).toEqual([]); // project scope gone
    expect(after.app.map((r) => r.key)).toContain(`cmd:frac-${RUN}`); // app scope untouched
  });

  it('validates the body and requires auth', async () => {
    const bad = await app.inject({ method: 'POST', url: `/projects/${projectA}/usage`, headers: auth, payload: { events: [] } });
    expect(bad.statusCode).toBe(400);
    const unauth = await app.inject({ method: 'GET', url: `/projects/${projectA}/usage` });
    expect(unauth.statusCode).toBe(401);
  });
});
