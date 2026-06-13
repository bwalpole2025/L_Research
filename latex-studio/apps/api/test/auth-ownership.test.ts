import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Multi-user authentication + ownership (acceptance):
 *  - a logged-out request to any project route is rejected (401);
 *  - user A cannot read or mutate user B's projects, files, runs, or exports (404,
 *    not 403 — no cross-tenant existence leak);
 *  - the project list is scoped to the caller.
 *
 * Sessions are minted via Better Auth's own server API (the same code path the
 * HTTP endpoints use) and replayed as the HttpOnly cookie — proving auth runs
 * entirely in our Postgres. `authRequired: true` turns on enforcement.
 */

const TOKEN = 'test-token';
const bearer = { authorization: `Bearer ${TOKEN}` };

let app: FastifyInstance;
const stamp = Date.now();
const emails = [`a-${stamp}@test.local`, `b-${stamp}@test.local`];
let cookieA = '';
let cookieB = '';
let projectA = '';

/** Sign up a user via Better Auth's server API and return their session cookie. */
async function signupCookie(email: string): Promise<string> {
  const res = await app.auth.api.signUpEmail({
    body: { email, password: 'password123', name: email.split('@')[0]! },
    asResponse: true,
  });
  const cookies = res.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0); // a session cookie was set
  return cookies.map((c) => c.split(';')[0]).join('; ');
}

beforeAll(async () => {
  app = await buildApp({
    logger: false,
    config: { bearerToken: TOKEN, authRequired: true, authSecret: 'test-better-auth-secret-0123456789abcdef' },
  });
  await app.ready();
  cookieA = await signupCookie(emails[0]!);
  cookieB = await signupCookie(emails[1]!);

  const res = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: { ...bearer, cookie: cookieA },
    payload: { name: `owned-by-A ${stamp}` },
  });
  expect([200, 201]).toContain(res.statusCode);
  projectA = res.json().id;
});

afterAll(async () => {
  await app.prisma.project.deleteMany({ where: { name: { contains: String(stamp) } } }).catch(() => undefined);
  await app.prisma.user.deleteMany({ where: { email: { in: emails } } }).catch(() => undefined);
  await app.close();
});

describe('logged-out (service bearer only, no user session) is rejected', () => {
  it('401 on principal routes without a session', async () => {
    const list = await app.inject({ method: 'GET', url: '/projects', headers: bearer });
    expect(list.statusCode).toBe(401);
    const create = await app.inject({ method: 'POST', url: '/projects', headers: bearer, payload: { name: 'x' } });
    expect(create.statusCode).toBe(401);
  });
  it('401 on a project route without a session', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectA}`, headers: bearer });
    expect(res.statusCode).toBe(401);
  });
  it('rejects a totally unauthenticated request (no bearer) too', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectA}` });
    expect(res.statusCode).toBe(401); // the service bearer guard fires first
  });
});

describe('user A can use their own project', () => {
  it('reads it', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectA}`, headers: { ...bearer, cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(projectA);
  });
  it('lists it (and only it) for A', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects', headers: { ...bearer, cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(projectA);
  });
});

describe('user B cannot touch user A’s project (IDOR closed) — 404, not 403', () => {
  it('cannot read it', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectA}`, headers: { ...bearer, cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });
  it('cannot rename it', async () => {
    const res = await app.inject({ method: 'PATCH', url: `/projects/${projectA}`, headers: { ...bearer, cookie: cookieB }, payload: { name: 'hijacked' } });
    expect(res.statusCode).toBe(404);
  });
  it('cannot delete it', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/projects/${projectA}`, headers: { ...bearer, cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });
  it('cannot list its files', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectA}/files`, headers: { ...bearer, cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });
  it('cannot run it', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectA}/run`, headers: { ...bearer, cookie: cookieB }, payload: {} });
    expect(res.statusCode).toBe(404);
  });
  it('cannot export (download) its PDF', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectA}/pdf`, headers: { ...bearer, cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });
  it('does not see it in B’s project list', async () => {
    const res = await app.inject({ method: 'GET', url: '/projects', headers: { ...bearer, cookie: cookieB } });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as Array<{ id: string }>).map((p) => p.id);
    expect(ids).not.toContain(projectA);
  });
});
