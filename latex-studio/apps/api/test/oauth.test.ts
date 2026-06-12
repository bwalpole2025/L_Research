import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { challengeFor, createVerifier, randomState } from '../src/oauth/pkce.js';
import {
  OAuthError,
  beginAuthorization,
  consumePending,
  exchangeCode,
  refreshToken,
  type OAuthClientConfig,
} from '../src/oauth/flow.js';

const CFG: OAuthClientConfig = {
  authUrl: 'https://auth.example/authorize',
  tokenUrl: 'https://auth.example/token',
  clientId: 'client-123',
  clientSecret: 'secret-xyz',
  redirectUri: 'http://127.0.0.1:4000/connectors/test/callback',
  extraAuthParams: { access_type: 'offline' },
};

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

afterEach(() => vi.unstubAllGlobals());

describe('PKCE', () => {
  it('S256 challenge matches base64url(sha256(verifier))', () => {
    const v = createVerifier();
    expect(challengeFor(v)).toBe(base64url(createHash('sha256').update(v).digest()));
    expect(v).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes → 43 base64url chars
    expect(randomState()).not.toBe(randomState());
  });
});

describe('beginAuthorization', () => {
  it('builds a consent URL with the scopes, S256 challenge, and state', () => {
    const { authUrl, state } = beginAuthorization('test', CFG, ['scope.a', 'scope.b'], 1000);
    const url = new URL(authUrl);
    expect(url.origin + url.pathname).toBe('https://auth.example/authorize');
    expect(url.searchParams.get('scope')).toBe('scope.a scope.b');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(url.searchParams.get('state')).toBe(state);
    expect(url.searchParams.get('access_type')).toBe('offline'); // extra params passed through
    // The pending authorization is consumable exactly once.
    expect(consumePending(state, 'test', 1000).scopes).toEqual(['scope.a', 'scope.b']);
    expect(() => consumePending(state, 'test', 1000)).toThrow(OAuthError);
  });

  it('rejects connect with no client credentials', () => {
    expect(() => beginAuthorization('test', { ...CFG, clientId: '' }, [], 0)).toThrow(OAuthError);
  });
});

describe('token endpoint', () => {
  it('exchangeCode posts the code + verifier and computes expiry', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, scope: 'a b' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const token = await exchangeCode(CFG, 'the-code', 'the-verifier', 10_000);
    expect(token).toMatchObject({ accessToken: 'AT', refreshToken: 'RT', scope: 'a b' });
    expect(token.expiresAt).toBe(10_000 + 3600 * 1000);
    const body = fetchMock.mock.calls[0]![1]!.body as string;
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('code=the-code');
    expect(body).toContain('code_verifier=the-verifier');
  });

  it('refreshToken keeps the prior refresh token when the response omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'AT2', expires_in: 60 }), { status: 200 })));
    const token = await refreshToken(CFG, 'OLD-RT', 0);
    expect(token.accessToken).toBe('AT2');
    expect(token.refreshToken).toBe('OLD-RT');
  });

  it('refreshToken raises needs_reconnect when the grant is dead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })));
    await expect(refreshToken(CFG, 'dead', 0)).rejects.toMatchObject({ kind: 'needs_reconnect' });
  });
});
