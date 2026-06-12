import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ConnectorConnectResult, ConnectorStatus } from '@latex-studio/shared';
import { connectorStatus, listConnectors } from '../connectors/registry.js';
import { getManifest, oauthConfigFor } from '../connectors/manifest.js';
import { literatureSource, LiteratureSourceError } from '../literature/sources/index.js';
import { storageConnector, StorageConnectorError } from '../storage/sources/index.js';
import {
  OAuthError,
  beginAuthorization,
  consumePending,
  exchangeCode,
  revoke,
  type TokenSet,
} from '../oauth/flow.js';

/**
 * Connector management API. The browser drives connect/disconnect through these
 * routes; secrets are exchanged + stored entirely server-side. No response on
 * this router ever carries token/key material — only `ConnectorStatus`.
 *
 * The OAuth callback is the one public route here (the browser arrives on it via
 * the provider's redirect, without our bearer token); it is protected instead by
 * the single-use, server-generated `state` value.
 */

const apiKeyBody = z.object({ apiKey: z.string().min(1) });

export async function connectorRoutes(app: FastifyInstance): Promise<void> {
  // List all connectors with live status.
  app.get('/connectors', async () => ({ connectors: await listConnectors(app) }));

  app.get<{ Params: { id: string } }>('/connectors/:id', async (request, reply) => {
    const status = await connectorStatus(app, request.params.id);
    if (!status) return reply.callNotFound();
    return status;
  });

  // Search a literature connector (arXiv/CrossRef/Zotero/Semantic Scholar). The
  // results are DATA — adding one to the library is a separate explicit action
  // (POST /projects/:id/library/from-literature).
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>('/connectors/literature/:id/search', async (request, reply) => {
    const q = (request.query.q ?? '').trim();
    if (!q) return { results: [] };
    let src;
    try {
      src = await literatureSource(app, request.params.id);
    } catch (err) {
      const message = err instanceof LiteratureSourceError ? err.message : 'Unknown literature source';
      return reply.code(400).send({ error: message });
    }
    try {
      const results = await src.search(q);
      await app.vault.touchLastUsed(request.params.id).catch(() => undefined);
      return { results };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  // List entries in a storage connector (Drive/Dropbox/OneDrive). The access
  // token is resolved + refreshed server-side; an expired grant surfaces a clean
  // reconnect prompt, never a crash.
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/connectors/storage/:id/list', async (request, reply) => {
    let conn;
    try {
      conn = await storageConnector(app, request.params.id);
    } catch (err) {
      if (err instanceof StorageConnectorError) {
        return reply.code(err.kind === 'needs_connect' ? 409 : 404).send({ error: err.message, kind: err.kind });
      }
      throw err;
    }
    try {
      return { entries: await conn.list(request.query.path ?? '') };
    } catch (err) {
      if (err instanceof StorageConnectorError) return reply.code(409).send({ error: err.message, kind: 'needs_connect' });
      return reply.code(502).send({ error: err instanceof Error ? err.message : 'List failed' });
    }
  });

  // Begin a connection.
  app.post<{ Params: { id: string } }>('/connectors/:id/connect', async (request, reply) => {
    const manifest = getManifest(request.params.id);
    if (!manifest) return reply.callNotFound();

    if (manifest.authType === 'oauth2') {
      const cfg = oauthConfigFor(manifest.id, app.config);
      if (!cfg) return reply.code(400).send({ error: `No OAuth configuration for "${manifest.id}".` });
      try {
        const { authUrl } = beginAuthorization(manifest.id, cfg, manifest.scopes, Date.now());
        return { authUrl } satisfies ConnectorConnectResult;
      } catch (err) {
        if (err instanceof OAuthError && err.kind === 'config') {
          return reply.code(400).send({
            error:
              `${manifest.name} has no OAuth client credentials. Register an OAuth app and set ` +
              `the client id/secret in .env (see docs/decisions.md), then try again.`,
          });
        }
        throw err;
      }
    }

    if (manifest.authType === 'apiKey') {
      const parsed = apiKeyBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'An apiKey is required.' });
      await app.vault.store(manifest.id, { authType: 'apiKey', secret: { apiKey: parsed.data.apiKey }, scopes: manifest.scopes });
      return statusResult(await connectorStatus(app, manifest.id));
    }

    if (manifest.authType === 'subscriptionCli') {
      // Nothing to store — the CLI owns the login. Return refreshed status so the
      // UI reflects install/login state and shows the sign-in hint.
      return statusResult(await connectorStatus(app, manifest.id));
    }

    return reply.code(400).send({ error: `Connector "${manifest.id}" needs no connection.` });
  });

  // OAuth redirect target (PUBLIC — see auth allow-list). Validates `state`,
  // exchanges the code, stores the encrypted token, and bounces back to the web app.
  app.get<{ Params: { id: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/connectors/:id/callback',
    async (request, reply) => {
      const { id } = request.params;
      const { code, state, error } = request.query;
      const back = (qs: string): never => {
        void reply.redirect(`${app.config.webBaseUrl.replace(/\/+$/, '')}/plugins?${qs}`);
        return undefined as never;
      };

      if (error) return back(`connector=${encodeURIComponent(id)}&error=${encodeURIComponent(error)}`);
      const cfg = oauthConfigFor(id, app.config);
      if (!code || !state || !cfg) return back(`connector=${encodeURIComponent(id)}&error=invalid_callback`);

      try {
        const pending = consumePending(state, id, Date.now());
        const token = await exchangeCode(cfg, code, pending.verifier, Date.now());
        await app.vault.store(id, {
          authType: 'oauth2',
          secret: token,
          scopes: token.scope?.split(' ') ?? pending.scopes,
          accountLabel: await fetchAccountLabel(id, token).catch(() => null),
        });
        return back(`connected=${encodeURIComponent(id)}`);
      } catch (err) {
        app.log.warn({ err, connector: id }, 'oauth callback failed');
        const message = err instanceof OAuthError ? err.message : 'connection_failed';
        return back(`connector=${encodeURIComponent(id)}&error=${encodeURIComponent(message)}`);
      }
    },
  );

  // Disconnect: revoke (oauth) + delete the stored credential. Idempotent.
  app.post<{ Params: { id: string } }>('/connectors/:id/disconnect', async (request, reply) => {
    const manifest = getManifest(request.params.id);
    if (!manifest) return reply.callNotFound();

    if (manifest.authType === 'oauth2') {
      const token = await app.vault.get<TokenSet>(manifest.id);
      const cfg = oauthConfigFor(manifest.id, app.config);
      if (token?.accessToken && cfg) await revoke(cfg, token.refreshToken ?? token.accessToken);
    }
    await app.vault.delete(manifest.id);
    return statusResult(await connectorStatus(app, manifest.id));
  });
}

/** Wrap a possibly-null status into a ConnectorConnectResult (no `undefined` field). */
function statusResult(status: ConnectorStatus | null): ConnectorConnectResult {
  return status ? { status } : {};
}

/**
 * Fetch a display label (account email) for the connected account. Best-effort,
 * provider-specific, and read-only; failures are swallowed (label stays null).
 */
async function fetchAccountLabel(id: string, token: TokenSet): Promise<string | null> {
  if (id === 'google-drive') {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string };
    return json.email ?? null;
  }
  return null;
}
