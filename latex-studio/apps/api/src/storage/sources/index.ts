import type { FastifyInstance } from 'fastify';
import type { StorageConnector } from '@latex-studio/shared';
import { oauthConfigFor } from '../../connectors/manifest.js';
import { OAuthError, withFreshToken } from '../../oauth/flow.js';
import { GoogleDriveConnector } from './googleDrive.js';
import { DropboxConnector } from './dropbox.js';
import { OneDriveConnector } from './onedrive.js';

/** Typed error so routes can return a clean "connect this storage first" prompt. */
export class StorageConnectorError extends Error {
  constructor(
    readonly kind: 'unknown' | 'needs_connect',
    message: string,
  ) {
    super(message);
    this.name = 'StorageConnectorError';
  }
}

/**
 * Resolve a `StorageConnector` adapter by connector id. Each adapter gets a token
 * provider that lazily resolves + auto-refreshes the stored OAuth token via the
 * vault — so the access token is fetched fresh per call and never leaves the api.
 */
export async function storageConnector(app: FastifyInstance, id: string): Promise<StorageConnector> {
  const cfg = oauthConfigFor(id, app.config);
  if (!cfg) throw new StorageConnectorError('unknown', `Unknown storage connector "${id}".`);
  if (!(await app.vault.has(id))) throw new StorageConnectorError('needs_connect', `${id} is not connected.`);

  const token = async (): Promise<string> => {
    try {
      const t = await withFreshToken(app.vault, id, cfg, Date.now());
      await app.vault.touchLastUsed(id).catch(() => undefined);
      return t;
    } catch (err) {
      if (err instanceof OAuthError) throw new StorageConnectorError('needs_connect', err.message);
      throw err;
    }
  };

  switch (id) {
    case 'google-drive':
      return new GoogleDriveConnector(token);
    case 'dropbox':
      return new DropboxConnector(token);
    case 'onedrive':
      return new OneDriveConnector(token);
    default:
      throw new StorageConnectorError('unknown', `No storage adapter for "${id}".`);
  }
}
