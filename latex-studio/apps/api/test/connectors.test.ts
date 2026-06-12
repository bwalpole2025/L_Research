import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { resetMasterKeyCache } from '../src/vault/keystore.js';

/**
 * Connector routes: status listing never leaks secret material; the OAuth
 * connect → callback flow stores an ENCRYPTED token (browser never sees it);
 * disconnect deletes the credential. Token endpoints are mocked — no live
 * Google/Notion. Requires Postgres (DATABASE_URL from the repo .env).
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
const MASTER = 'Y29ubmVjdG9ycy10ZXN0LW1hc3Rlci1rZXktMzJieXRlcw==';

describe('connector routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    resetMasterKeyCache();
    app = await buildApp({
      logger: false,
      config: {
        bearerToken: TOKEN,
        connectorsMasterKey: MASTER,
        googleOAuthClientId: 'gcid',
        googleOAuthClientSecret: 'gsecret',
        oauthRedirectBaseUrl: 'http://127.0.0.1:4000',
        webBaseUrl: 'http://127.0.0.1:3000',
      },
    });
    await app.ready();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await app.prisma.credential.deleteMany({ where: { connectorId: 'google-drive' } });
  });
  afterAll(async () => {
    await app.prisma.credential.deleteMany({ where: { connectorId: 'google-drive' } });
    await app.close();
  });

  it('lists model/storage/literature connectors and never returns secret material', async () => {
    // Seed a stored credential so we can prove the list excludes it.
    await app.vault.store('google-drive', { authType: 'oauth2', secret: { accessToken: 'SECRET-DRIVE-TOKEN' }, scopes: ['drive.file'] });

    const res = await app.inject({ method: 'GET', url: '/connectors', headers: auth });
    expect(res.statusCode).toBe(200);
    const { connectors } = res.json() as { connectors: Array<{ id: string; kind: string; connected: boolean }> };
    expect(connectors.some((c) => c.kind === 'model')).toBe(true);
    expect(connectors.some((c) => c.kind === 'storage')).toBe(true);
    expect(connectors.some((c) => c.kind === 'literature')).toBe(true);
    expect(connectors.find((c) => c.id === 'google-drive')?.connected).toBe(true);
    // The crucial assertion: NO secret material in any response.
    expect(res.payload).not.toContain('SECRET-DRIVE-TOKEN');
  });

  it('OAuth connect returns a consent URL with least-privilege scopes + S256 challenge', async () => {
    const res = await app.inject({ method: 'POST', url: '/connectors/google-drive/connect', headers: auth });
    expect(res.statusCode).toBe(200);
    const url = new URL((res.json() as { authUrl: string }).authUrl);
    expect(url.searchParams.get('scope')).toContain('drive.file');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4000/connectors/google-drive/callback');
  });

  it('the callback exchanges the code, stores an ENCRYPTED token, and never echoes it', async () => {
    // 1. Begin from a localhost origin → capture state (origin steers the bounce-back).
    const connectRes = await app.inject({ method: 'POST', url: '/connectors/google-drive/connect', headers: auth, payload: { origin: 'http://localhost:3000' } });
    const state = new URL((connectRes.json() as { authUrl: string }).authUrl).searchParams.get('state')!;

    // 2. Mock Google's token + userinfo endpoints.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u.includes('/token')) return new Response(JSON.stringify({ access_token: 'ENCRYPT-ME', refresh_token: 'R', expires_in: 3600, scope: 'drive.file' }), { status: 200 });
        if (u.includes('userinfo')) return new Response(JSON.stringify({ email: 'me@example.com' }), { status: 200 });
        return new Response('{}', { status: 200 });
      }),
    );

    // 3. Hit the callback (public route — no bearer, like a real provider redirect).
    const cb = await app.inject({ method: 'GET', url: `/connectors/google-drive/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(cb.statusCode).toBe(200); // a self-closing popup page (not a 302)
    expect(cb.headers['content-type']).toContain('text/html');
    // Returns to the SAME origin we started from (localhost), not the 127.0.0.1 default.
    expect(cb.payload).toContain('http://localhost:3000/plugins?connected=google-drive');

    // 4. The token is stored as ciphertext, never plaintext, and no route returns it.
    const row = await app.prisma.credential.findUnique({ where: { connectorId: 'google-drive' } });
    expect(row).not.toBeNull();
    expect(JSON.stringify(row)).not.toContain('ENCRYPT-ME');
    expect(await app.vault.get<{ accessToken: string }>('google-drive')).toMatchObject({ accessToken: 'ENCRYPT-ME' });

    const status = await app.inject({ method: 'GET', url: '/connectors/google-drive', headers: auth });
    expect(status.json()).toMatchObject({ connected: true, accountLabel: 'me@example.com' });
    expect(status.payload).not.toContain('ENCRYPT-ME');
  });

  it('disconnect deletes the stored credential', async () => {
    await app.vault.store('google-drive', { authType: 'oauth2', secret: { accessToken: 'T', refreshToken: 'R' }, scopes: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))); // revoke endpoint
    const res = await app.inject({ method: 'POST', url: '/connectors/google-drive/disconnect', headers: auth });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: { connected: boolean } }).status.connected).toBe(false);
    expect(await app.vault.has('google-drive')).toBe(false);
  });

  it('callback with an unknown state fails safe (error page, not a crash)', async () => {
    const cb = await app.inject({ method: 'GET', url: '/connectors/google-drive/callback?code=x&state=bogus' });
    expect(cb.statusCode).toBe(200);
    expect(cb.payload).toContain('error=');
    expect(await app.vault.has('google-drive')).toBe(false);
  });

  it('rejects an unauthenticated non-callback connector route', async () => {
    const res = await app.inject({ method: 'GET', url: '/connectors' }); // no bearer
    expect(res.statusCode).toBe(401);
  });

  // Dropbox has no env credentials in this test config — so it exercises the
  // pure UI-setup path: connect-before-setup is a clear prompt, /configure saves
  // the client creds (encrypted), and connect then yields a consent URL.
  it('configure saves OAuth app credentials and unblocks connect (no .env needed)', async () => {
    // Not configured yet → status says so, and connect prompts for setup.
    const before = await app.inject({ method: 'GET', url: '/connectors/dropbox', headers: auth });
    expect(before.json()).toMatchObject({ configured: false, redirectUri: expect.stringContaining('/connectors/dropbox/callback') });

    const blocked = await app.inject({ method: 'POST', url: '/connectors/dropbox/connect', headers: auth });
    expect(blocked.statusCode).toBe(400);
    expect((blocked.json() as { needsSetup?: boolean }).needsSetup).toBe(true);

    // Save client id/secret via the UI route.
    const cfg = await app.inject({ method: 'POST', url: '/connectors/dropbox/configure', headers: auth, payload: { clientId: 'DBX_ID', clientSecret: 'DBX_SECRET' } });
    expect(cfg.statusCode).toBe(200);
    expect((cfg.json() as { status: { configured: boolean } }).status.configured).toBe(true);
    expect(cfg.payload).not.toContain('DBX_SECRET'); // secret never echoed

    // The stored app creds are ciphertext, not plaintext.
    const row = await app.prisma.credential.findUnique({ where: { connectorId: 'dropbox::app' } });
    expect(JSON.stringify(row)).not.toContain('DBX_SECRET');

    // Now connect yields a consent URL carrying our client id.
    const connect = await app.inject({ method: 'POST', url: '/connectors/dropbox/connect', headers: auth });
    expect(connect.statusCode).toBe(200);
    expect(new URL((connect.json() as { authUrl: string }).authUrl).searchParams.get('client_id')).toBe('DBX_ID');

    await app.prisma.credential.deleteMany({ where: { connectorId: 'dropbox::app' } });
  });
});
