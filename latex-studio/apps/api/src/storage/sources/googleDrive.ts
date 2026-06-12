import type { StorageCapabilities, StorageConnector, StorageEntry } from '@latex-studio/shared';

/** A function returning a currently-valid access token (auto-refreshed upstream). */
export type TokenProvider = () => Promise<string>;

/**
 * Google Drive over the Drive v3 REST API. `path` is a folder id ("root" for the
 * top level); `fileId` is a Drive file id. All calls carry a fresh OAuth token
 * resolved server-side — no token ever reaches the browser.
 */
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
}

export class GoogleDriveConnector implements StorageConnector {
  readonly capabilities: StorageCapabilities = { list: true, read: true, write: true, delete: true, metadata: true };

  constructor(private readonly token: TokenProvider) {}

  private async authed(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await this.token()}`, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`Google Drive ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  async list(path: string): Promise<StorageEntry[]> {
    const folder = path || 'root';
    const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
    const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime)');
    const res = await this.authed(`${DRIVE}/files?q=${q}&fields=${fields}&pageSize=200`);
    const json = (await res.json()) as { files?: DriveFile[] };
    return (json.files ?? []).map((f) => toEntry(f, folder));
  }

  async read(fileId: string): Promise<Uint8Array> {
    const res = await this.authed(`${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async write(path: string, bytes: Uint8Array): Promise<StorageEntry> {
    // Multipart upload: metadata (name + optional parent) + media in one request.
    const slash = path.lastIndexOf('/');
    const name = slash >= 0 ? path.slice(slash + 1) : path;
    const parent = slash > 0 ? path.slice(0, slash) : '';
    const metadata = { name, ...(parent ? { parents: [parent] } : {}) };
    const boundary = 'ls-drive-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      Buffer.from(bytes),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const res = await this.authed(`${UPLOAD}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return toEntry((await res.json()) as DriveFile, parent);
  }

  async delete(fileId: string): Promise<void> {
    await this.authed(`${DRIVE}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }

  async getMetadata(fileId: string): Promise<StorageEntry> {
    const res = await this.authed(`${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime`);
    return toEntry((await res.json()) as DriveFile, '');
  }
}

function toEntry(f: DriveFile, parent: string): StorageEntry {
  return {
    id: f.id,
    name: f.name,
    path: parent ? `${parent}/${f.id}` : f.id,
    isFolder: f.mimeType === 'application/vnd.google-apps.folder',
    ...(f.size ? { sizeBytes: Number(f.size) } : {}),
    ...(f.mimeType ? { mimeType: f.mimeType } : {}),
    ...(f.modifiedTime ? { modifiedAt: f.modifiedTime } : {}),
  };
}
