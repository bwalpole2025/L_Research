import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { ConnectorConnectResult, ConnectorStatus, StorageConnector } from '@latex-studio/shared';
import { connectorStatus, listConnectors } from '../connectors/registry.js';
import { getManifest, oauthAppKey, oauthRedirectUri, resolveOAuthConfig } from '../connectors/manifest.js';
import { literatureSource, LiteratureSourceError } from '../literature/sources/index.js';
import { storageConnector, StorageConnectorError } from '../storage/sources/index.js';
import { isBinaryPath, validateFilePath } from '../lib/paths.js';
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
const oauthAppBody = z.object({ clientId: z.string().trim().min(1), clientSecret: z.string().trim().min(1) });
// Import a storage file INTO the project: `fileId` is the provider file id, `path`
// is the project-relative destination (validated/whitelisted like any project file).
const storageImportBody = z.object({ fileId: z.string().min(1), path: z.string().min(1).max(512) });
// Upload a project file TO storage: `fileId` is the project TexFile, `parentFolderId`
// the destination folder id ('' / 'root' / omitted ⇒ the provider's top level).
const storageUploadBody = z.object({ fileId: z.string().min(1), parentFolderId: z.string().optional() });

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

  // ── Import a storage file INTO a project ──────────────────────────────────────
  // Reads the provider file server-side and stores it as a project file (utf8 for
  // text, base64 for binary). Upserts by path so re-importing refreshes in place.
  app.post<{ Params: { projectId: string; id: string }; Body: unknown }>(
    '/projects/:projectId/storage/:id/import',
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({ where: { id: request.params.projectId } });
      if (!project) return reply.callNotFound();
      const parsed = storageImportBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
      const check = validateFilePath(parsed.data.path);
      if (!check.ok) return reply.code(400).send({ error: check.error });

      const conn = await resolveStorage(app, request.params.id, reply);
      if (!conn) return reply; // resolveStorage already sent the error response

      let bytes: Uint8Array;
      try {
        bytes = await conn.read(parsed.data.fileId);
      } catch (err) {
        if (err instanceof StorageConnectorError) return reply.code(409).send({ error: err.message, kind: 'needs_connect' });
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Import failed' });
      }

      const binary = isBinaryPath(parsed.data.path);
      const buf = Buffer.from(bytes);
      const content = binary ? buf.toString('base64') : buf.toString('utf8');
      const encoding = binary ? 'base64' : 'utf8';
      const existing = await app.prisma.texFile.findUnique({ where: { projectId_path: { projectId: project.id, path: parsed.data.path } } });
      const file = existing
        ? await app.prisma.texFile.update({ where: { id: existing.id }, data: { content, encoding } })
        : await app.prisma.texFile.create({ data: { projectId: project.id, path: parsed.data.path, content, encoding } });
      await app.vault.touchLastUsed(request.params.id).catch(() => undefined);
      return reply.code(existing ? 200 : 201).send({
        id: file.id,
        projectId: file.projectId,
        path: file.path,
        encoding: file.encoding,
        updatedAt: file.updatedAt.toISOString(),
      });
    },
  );

  // ── Upload a project file TO storage ──────────────────────────────────────────
  // Reads the project file server-side and writes its bytes to the provider under
  // its basename, in the chosen folder (default: the provider's top level).
  app.post<{ Params: { projectId: string; id: string }; Body: unknown }>(
    '/projects/:projectId/storage/:id/upload',
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({ where: { id: request.params.projectId } });
      if (!project) return reply.callNotFound();
      const parsed = storageUploadBody.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
      const file = await app.prisma.texFile.findFirst({ where: { id: parsed.data.fileId, projectId: project.id } });
      if (!file) return reply.callNotFound();

      const conn = await resolveStorage(app, request.params.id, reply);
      if (!conn) return reply;

      const bytes = file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf8');
      const name = file.path.split('/').pop() ?? file.path;
      const parent = parsed.data.parentFolderId?.trim();
      const target = parent && parent !== 'root' ? `${parent}/${name}` : name;
      try {
        const entry = await conn.write(target, new Uint8Array(bytes));
        await app.vault.touchLastUsed(request.params.id).catch(() => undefined);
        return { entry };
      } catch (err) {
        if (err instanceof StorageConnectorError) return reply.code(409).send({ error: err.message, kind: 'needs_connect' });
        return reply.code(502).send({ error: err instanceof Error ? err.message : 'Upload failed' });
      }
    },
  );

  // Begin a connection.
  app.post<{ Params: { id: string } }>('/connectors/:id/connect', async (request, reply) => {
    const manifest = getManifest(request.params.id);
    if (!manifest) return reply.callNotFound();

    if (manifest.authType === 'oauth2') {
      const cfg = await resolveOAuthConfig(app, manifest.id);
      if (!cfg) return reply.code(400).send({ error: `No OAuth configuration for "${manifest.id}".` });
      // Capture where the user is browsing from so the callback returns them to
      // the SAME origin (localhost vs 127.0.0.1 differ for the session).
      const origin = safeWebOrigin((request.body as { origin?: string } | undefined)?.origin);
      try {
        const { authUrl } = beginAuthorization(manifest.id, cfg, manifest.scopes, Date.now(), origin);
        return { authUrl } satisfies ConnectorConnectResult;
      } catch (err) {
        if (err instanceof OAuthError && err.kind === 'config') {
          return reply.code(400).send({
            error:
              `${manifest.name} isn't set up yet. Register an OAuth app${manifest.setupUrl ? ` at ${manifest.setupUrl}` : ''}, ` +
              `add the redirect URI ${oauthRedirectUri(manifest.id, app.config)}, then save its client id/secret here.`,
            needsSetup: true,
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

  // Save an OAuth connector's app credentials (client id/secret) — so the user
  // can set up Drive/Notion/etc. from the UI instead of editing .env + restart.
  // Stored encrypted in the vault, separate from the user token. Never returned.
  app.post<{ Params: { id: string } }>('/connectors/:id/configure', async (request, reply) => {
    const manifest = getManifest(request.params.id);
    if (!manifest) return reply.callNotFound();
    if (manifest.authType !== 'oauth2') return reply.code(400).send({ error: 'Only OAuth connectors take client credentials.' });
    const parsed = oauthAppBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'A client id and client secret are required.' });
    await app.vault.store(oauthAppKey(manifest.id), {
      authType: 'apiKey',
      secret: { clientId: parsed.data.clientId.trim(), clientSecret: parsed.data.clientSecret.trim() },
    });
    return statusResult(await connectorStatus(app, manifest.id));
  });

  // OAuth redirect target (PUBLIC — see auth allow-list). Validates `state`,
  // exchanges the code, stores the encrypted token, and bounces back to the web app.
  app.get<{ Params: { id: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    '/connectors/:id/callback',
    async (request, reply) => {
      const { id } = request.params;
      const { code, state, error } = request.query;
      // The web base for the bounce-back: overridden per-attempt by the origin we
      // captured at connect time, so the user returns to localhost (or 127.0.0.1)
      // — whichever they came from — and keeps their session.
      let webBase = app.config.webBaseUrl;
      // Return a tiny page that closes the consent POPUP (and, if this was a
      // full-page fallback rather than a popup, redirects back to /plugins).
      const back = (qs: string): never => {
        const url = `${webBase.replace(/\/+$/, '')}/plugins?${qs}`;
        void reply.type('text/html').send(connectorCallbackPage(url));
        return undefined as never;
      };

      if (error) return back(`connector=${encodeURIComponent(id)}&error=${encodeURIComponent(error)}`);
      const cfg = await resolveOAuthConfig(app, id);
      if (!code || !state || !cfg) return back(`connector=${encodeURIComponent(id)}&error=invalid_callback`);

      try {
        const pending = consumePending(state, id, Date.now());
        if (pending.webOrigin) webBase = pending.webOrigin;
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
      const cfg = await resolveOAuthConfig(app, manifest.id);
      if (token?.accessToken && cfg) await revoke(cfg, token.refreshToken ?? token.accessToken);
    }
    // Delete the user token; keep the saved app credentials so reconnect is easy.
    await app.vault.delete(manifest.id);
    return statusResult(await connectorStatus(app, manifest.id));
  });
}

/** Wrap a possibly-null status into a ConnectorConnectResult (no `undefined` field). */
function statusResult(status: ConnectorStatus | null): ConnectorConnectResult {
  return status ? { status } : {};
}

/**
 * Resolve a storage adapter, or send the right error response and return null:
 * 404 for an unknown connector, 409 ("needs connect") for one that isn't linked.
 * Callers return `reply` immediately when this yields null.
 */
async function resolveStorage(app: FastifyInstance, id: string, reply: FastifyReply): Promise<StorageConnector | null> {
  try {
    return await storageConnector(app, id);
  } catch (err) {
    if (err instanceof StorageConnectorError) {
      void reply.code(err.kind === 'needs_connect' ? 409 : 404).send({ error: err.message, kind: err.kind });
      return null;
    }
    throw err;
  }
}

/**
 * The page the OAuth callback returns. When the consent ran in a popup (the
 * normal path) `window.close()` shuts it and the studio page's poller notices the
 * new status. If consent ran as a full-page redirect (popups blocked), the page
 * can't close itself, so it navigates back to `/plugins`. `returnUrl` is already
 * a localhost URL (validated at connect time).
 */
function connectorCallbackPage(returnUrl: string): string {
  const safe = returnUrl.replace(/[<>"']/g, '');
  return `<!doctype html><html><head><meta charset="utf-8"><title>LaTeX Studio</title></head>
<body style="font-family:system-ui,sans-serif;background:#0a0e18;color:#dbe3ff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<p style="text-align:center;line-height:1.6">Finishing up — you can close this window.<br>
<a href="${safe}" style="color:#8fa3ff">Return to LaTeX Studio</a></p>
<script>
  try { if (window.opener) window.opener.postMessage({ source: 'ls-oauth' }, '*'); } catch (e) {}
  try { window.close(); } catch (e) {}
  setTimeout(function () { if (!window.closed) window.location.replace(${JSON.stringify(safe)}); }, 500);
</script></body></html>`;
}

/**
 * Only accept a localhost web origin for the post-callback redirect — this is a
 * single-user localhost app, so anything else is rejected (no open redirect).
 */
function safeWebOrigin(origin: string | undefined): string | undefined {
  if (!origin) return undefined;
  try {
    const u = new URL(origin);
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && (u.protocol === 'http:' || u.protocol === 'https:')) {
      return u.origin;
    }
  } catch {
    /* not a URL */
  }
  return undefined;
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
