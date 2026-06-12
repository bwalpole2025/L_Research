import type { StorageCapabilities, StorageConnector, StorageEntry } from '@latex-studio/shared';
import type { TokenProvider } from './googleDrive.js';

/**
 * OneDrive over Microsoft Graph. `path` is a folder item id ("root" = top), and
 * `fileId` is a drive item id. Tokens are resolved + refreshed server-side.
 */
const GRAPH = 'https://graph.microsoft.com/v1.0/me/drive';

interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  folder?: unknown;
  file?: { mimeType?: string };
}

export class OneDriveConnector implements StorageConnector {
  readonly capabilities: StorageCapabilities = { list: true, read: true, write: true, delete: true, metadata: true };

  constructor(private readonly token: TokenProvider) {}

  private async authed(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`OneDrive ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async list(path: string): Promise<StorageEntry[]> {
    const where = !path || path === 'root' ? '/root/children' : `/items/${encodeURIComponent(path)}/children`;
    const res = await this.authed(`${GRAPH}${where}?$select=id,name,size,lastModifiedDateTime,folder,file&$top=200`);
    const json = (await res.json()) as { value?: GraphItem[] };
    return (json.value ?? []).map(toEntry);
  }

  async read(fileId: string): Promise<Uint8Array> {
    const res = await this.authed(`${GRAPH}/items/${encodeURIComponent(fileId)}/content`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<StorageEntry> {
    // Simple (≤4 MB) upload to a drive path: PUT /root:/<path>:/content.
    const res = await this.authed(`${GRAPH}/root:/${encodeURI(path)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(bytes),
    });
    return toEntry((await res.json()) as GraphItem);
  }

  async delete(fileId: string): Promise<void> {
    await this.authed(`${GRAPH}/items/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }

  async getMetadata(fileId: string): Promise<StorageEntry> {
    const res = await this.authed(`${GRAPH}/items/${encodeURIComponent(fileId)}?$select=id,name,size,lastModifiedDateTime,folder,file`);
    return toEntry((await res.json()) as GraphItem);
  }
}

function toEntry(i: GraphItem): StorageEntry {
  return {
    id: i.id,
    name: i.name,
    path: i.id,
    isFolder: i.folder !== undefined,
    ...(i.size !== undefined ? { sizeBytes: i.size } : {}),
    ...(i.file?.mimeType ? { mimeType: i.file.mimeType } : {}),
    ...(i.lastModifiedDateTime ? { modifiedAt: i.lastModifiedDateTime } : {}),
  };
}
