import type { StorageCapabilities, StorageConnector, StorageEntry } from '@latex-studio/shared';
import type { TokenProvider } from './googleDrive.js';

/**
 * Dropbox over the v2 API. `path` and `fileId` are both Dropbox paths
 * ("/folder/file.pdf"; "" = root). Content endpoints pass the path in the
 * `Dropbox-API-Arg` header. Tokens are resolved + refreshed server-side.
 */
const RPC = 'https://api.dropboxapi.com/2';
const CONTENT = 'https://content.dropboxapi.com/2';

interface DbxEntry {
  '.tag': 'file' | 'folder';
  name: string;
  path_lower?: string;
  path_display?: string;
  size?: number;
  server_modified?: string;
}

export class DropboxConnector implements StorageConnector {
  readonly capabilities: StorageCapabilities = { list: true, read: true, write: true, delete: true, metadata: true };

  constructor(private readonly token: TokenProvider) {}

  private async rpc<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${RPC}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Dropbox ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  async list(path: string): Promise<StorageEntry[]> {
    const json = await this.rpc<{ entries?: DbxEntry[] }>('/files/list_folder', { path: path === '' ? '' : path });
    return (json.entries ?? []).map(toEntry);
  }

  async read(fileId: string): Promise<Uint8Array> {
    const res = await fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await this.token()}`, 'Dropbox-API-Arg': JSON.stringify({ path: fileId }) },
    });
    if (!res.ok) throw new Error(`Dropbox download ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<StorageEntry> {
    const res = await fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
      },
      body: Buffer.from(bytes),
    });
    if (!res.ok) throw new Error(`Dropbox upload ${res.status}`);
    return toEntry((await res.json()) as DbxEntry);
  }

  async delete(fileId: string): Promise<void> {
    await this.rpc('/files/delete_v2', { path: fileId });
  }

  async getMetadata(fileId: string): Promise<StorageEntry> {
    return toEntry(await this.rpc<DbxEntry>('/files/get_metadata', { path: fileId }));
  }
}

function toEntry(e: DbxEntry): StorageEntry {
  const path = e.path_display ?? e.path_lower ?? e.name;
  return {
    id: path,
    name: e.name,
    path,
    isFolder: e['.tag'] === 'folder',
    ...(e.size !== undefined ? { sizeBytes: e.size } : {}),
    ...(e.server_modified ? { modifiedAt: e.server_modified } : {}),
  };
}
