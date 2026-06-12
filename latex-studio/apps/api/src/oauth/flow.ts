import { challengeFor, createVerifier, randomState } from './pkce.js';
import type { Vault } from '../vault/vault.js';

/**
 * Generic, config-driven OAuth2 + PKCE client. One instance of this logic serves
 * every storage/content connector — only the per-connector endpoints/clientId
 * differ (declared in the connector manifest). Tokens are obtained server-side
 * and handed straight to the vault (encrypted); they never reach the browser.
 */

export interface OAuthClientConfig {
  authUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Extra auth-request params (e.g. Google's access_type=offline & prompt=consent). */
  extraAuthParams?: Record<string, string>;
  /** Token endpoint expects HTTP Basic client auth instead of body creds (Notion). */
  basicAuth?: boolean;
}

/** A stored token set (this is the secret JSON encrypted in the vault). */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Absolute expiry (epoch ms), computed from `expires_in` at grant time. */
  expiresAt?: number;
  scope?: string;
  tokenType?: string;
}

/** Raw token endpoint response shape (snake_case from the provider). */
interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

/** Typed failure the routes turn into a clear "reconnect" prompt (never a 500). */
export class OAuthError extends Error {
  constructor(
    readonly kind: 'config' | 'exchange' | 'refresh' | 'state' | 'needs_reconnect',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

// ── Pending authorizations (server-side, for the redirect round-trip) ─────────

interface Pending {
  connectorId: string;
  verifier: string;
  state: string;
  scopes: string[];
  createdAt: number;
  /** The web origin the user started from, to return them to the SAME origin
   *  after the callback (avoids the localhost vs 127.0.0.1 session mismatch). */
  webOrigin?: string;
}

const PENDING_TTL_MS = 10 * 60 * 1000; // an auth attempt must complete within 10 min
const pending = new Map<string, Pending>(); // keyed by state

function sweep(now: number): void {
  for (const [state, p] of pending) if (now - p.createdAt > PENDING_TTL_MS) pending.delete(state);
}

/**
 * Begin an authorization: stash a PKCE verifier + state server-side and return
 * the consent URL (with the S256 challenge + least-privilege scopes).
 */
export function beginAuthorization(
  connectorId: string,
  cfg: OAuthClientConfig,
  scopes: string[],
  now: number,
  webOrigin?: string,
): { authUrl: string; state: string } {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new OAuthError('config', `Connector "${connectorId}" has no OAuth client credentials configured.`);
  }
  sweep(now);
  const verifier = createVerifier();
  const state = randomState();
  pending.set(state, { connectorId, verifier, state, scopes, createdAt: now, ...(webOrigin ? { webOrigin } : {}) });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: scopes.join(' '),
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    ...(cfg.extraAuthParams ?? {}),
  });
  return { authUrl: `${cfg.authUrl}?${params.toString()}`, state };
}

/** Look up + consume a pending authorization by its state (single use). */
export function consumePending(state: string, connectorId: string, now: number): Pending {
  sweep(now);
  const p = pending.get(state);
  if (!p || p.connectorId !== connectorId) {
    throw new OAuthError('state', 'Unknown or expired authorization state — please start the connection again.');
  }
  pending.delete(state);
  return p;
}

// ── Token endpoint calls ──────────────────────────────────────────────────────

function toTokenSet(raw: RawTokenResponse, now: number, fallbackRefresh?: string): TokenSet {
  if (!raw.access_token) {
    throw new OAuthError('exchange', raw.error_description ?? raw.error ?? 'token endpoint returned no access_token');
  }
  const out: TokenSet = { accessToken: raw.access_token };
  // Providers often omit refresh_token on refresh; keep the prior one.
  const refresh = raw.refresh_token ?? fallbackRefresh;
  if (refresh) out.refreshToken = refresh;
  if (typeof raw.expires_in === 'number') out.expiresAt = now + raw.expires_in * 1000;
  if (raw.scope) out.scope = raw.scope;
  if (raw.token_type) out.tokenType = raw.token_type;
  return out;
}

async function postForm(url: string, body: Record<string, string>, basicAuth?: string): Promise<RawTokenResponse> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...(basicAuth ? { Authorization: `Basic ${basicAuth}` } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  let json: RawTokenResponse = {};
  try {
    json = text ? (JSON.parse(text) as RawTokenResponse) : {};
  } catch {
    json = { error: 'invalid_response', error_description: text.slice(0, 200) };
  }
  return json;
}

/** Base64 of `clientId:clientSecret` for Basic-auth token endpoints. */
function basicHeader(cfg: OAuthClientConfig): string | undefined {
  return cfg.basicAuth ? Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64') : undefined;
}

/** Client credentials in the body, unless the endpoint uses Basic auth. */
function clientCreds(cfg: OAuthClientConfig): Record<string, string> {
  return cfg.basicAuth ? {} : { client_id: cfg.clientId, client_secret: cfg.clientSecret };
}

/** Exchange an authorization code for tokens (with the PKCE verifier). */
export async function exchangeCode(cfg: OAuthClientConfig, code: string, verifier: string, now: number): Promise<TokenSet> {
  const raw = await postForm(
    cfg.tokenUrl,
    { grant_type: 'authorization_code', code, redirect_uri: cfg.redirectUri, code_verifier: verifier, ...clientCreds(cfg) },
    basicHeader(cfg),
  );
  return toTokenSet(raw, now);
}

/** Refresh an access token. Throws `needs_reconnect` when the grant is dead. */
export async function refreshToken(cfg: OAuthClientConfig, refresh: string, now: number): Promise<TokenSet> {
  const raw = await postForm(
    cfg.tokenUrl,
    { grant_type: 'refresh_token', refresh_token: refresh, ...clientCreds(cfg) },
    basicHeader(cfg),
  );
  if (!raw.access_token) {
    throw new OAuthError('needs_reconnect', 'The connection has expired or was revoked — please reconnect.');
  }
  return toTokenSet(raw, now, refresh);
}

/** Best-effort token revocation (provider support varies). */
export async function revoke(cfg: OAuthClientConfig, token: string): Promise<void> {
  if (!cfg.revokeUrl) return;
  try {
    await postForm(cfg.revokeUrl, { token, ...clientCreds(cfg) }, basicHeader(cfg));
  } catch {
    /* revocation is best-effort; we still delete the local credential */
  }
}

// ── Auto-refresh wrapper ──────────────────────────────────────────────────────

/** Skew so we refresh slightly before the hard expiry. */
const EXPIRY_SKEW_MS = 60 * 1000;

/**
 * Return a valid access token for a connector, transparently refreshing (and
 * re-storing the new token) when it has expired. Raises `needs_reconnect` (a
 * typed error, not a 500) when no usable credential exists.
 */
export async function withFreshToken(
  vault: Vault,
  connectorId: string,
  cfg: OAuthClientConfig,
  now: number,
): Promise<string> {
  const token = await vault.get<TokenSet>(connectorId);
  if (!token?.accessToken) {
    throw new OAuthError('needs_reconnect', `Connector "${connectorId}" is not connected.`);
  }
  const expired = token.expiresAt !== undefined && token.expiresAt - EXPIRY_SKEW_MS <= now;
  if (!expired) return token.accessToken;

  if (!token.refreshToken) {
    throw new OAuthError('needs_reconnect', `Connector "${connectorId}" token expired and has no refresh token — reconnect.`);
  }
  const refreshed = await refreshToken(cfg, token.refreshToken, now);
  await vault.store(connectorId, { authType: 'oauth2', secret: refreshed, scopes: token.scope?.split(' ') ?? [] });
  return refreshed.accessToken;
}
