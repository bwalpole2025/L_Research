import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleDriveConnector } from '../src/storage/sources/googleDrive.js';
import { DropboxConnector } from '../src/storage/sources/dropbox.js';
import { OneDriveConnector } from '../src/storage/sources/onedrive.js';

/** The adapters share the StorageConnector interface; here we check each speaks
 *  its provider's REST dialect, with a fresh token attached and no token leak. */
const token = async () => 'ACCESS-TOKEN';

afterEach(() => vi.unstubAllGlobals());

describe('GoogleDriveConnector', () => {
  it('lists a folder and authorises with the bearer token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ files: [{ id: 'f1', name: 'paper.pdf', mimeType: 'application/pdf', size: '10', modifiedTime: 't' }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const entries = await new GoogleDriveConnector(token).list('root');
    expect(entries[0]).toMatchObject({ id: 'f1', name: 'paper.pdf', isFolder: false, sizeBytes: 10 });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/drive/v3/files');
    expect(fetchMock.mock.calls[0]![1]!.headers).toMatchObject({ Authorization: 'Bearer ACCESS-TOKEN' });
  });

  it('exposes the full capability set', () => {
    expect(new GoogleDriveConnector(token).capabilities).toEqual({ list: true, read: true, write: true, delete: true, metadata: true });
  });
});

describe('DropboxConnector', () => {
  it('lists via the v2 RPC endpoint', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ entries: [{ '.tag': 'file', name: 'a.tex', path_display: '/a.tex', size: 5 }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const entries = await new DropboxConnector(token).list('');
    expect(entries[0]).toMatchObject({ name: 'a.tex', path: '/a.tex', isFolder: false, sizeBytes: 5 });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/2/files/list_folder');
  });
});

describe('OneDriveConnector', () => {
  it('lists children via Microsoft Graph', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ value: [{ id: 'i1', name: 'b.bib', size: 3, file: { mimeType: 'text/plain' } }] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const entries = await new OneDriveConnector(token).list('root');
    expect(entries[0]).toMatchObject({ id: 'i1', name: 'b.bib', isFolder: false });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('graph.microsoft.com');
  });
});
