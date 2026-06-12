import { describe, expect, it } from 'vitest';
import { itemsFromDataTransfer, itemsFromFileList } from '../lib/dropUpload';

function makeFile(name: string, relativePath?: string): File {
  const f = new File(['x'], name, { type: 'text/plain' });
  if (relativePath !== undefined) Object.defineProperty(f, 'webkitRelativePath', { value: relativePath });
  return f;
}

describe('itemsFromFileList — input selections', () => {
  it('uses webkitRelativePath when present (folder pick), else the bare name', () => {
    const items = itemsFromFileList([
      makeFile('plot.png', 'thesis/figs/plot.png'),
      makeFile('notes.tex'),
    ]);
    expect(items).toEqual([
      { file: expect.any(File), relativePath: 'thesis/figs/plot.png' },
      { file: expect.any(File), relativePath: 'notes.tex' },
    ]);
  });

  it('handles an empty / null list', () => {
    expect(itemsFromFileList(null)).toEqual([]);
    expect(itemsFromFileList([])).toEqual([]);
  });
});

// ── Drag-and-drop folder traversal (mocked FileSystem entry API) ───────────────

function fileEntry(name: string) {
  return { isFile: true, isDirectory: false, name, file: (ok: (f: File) => void) => ok(makeFile(name)) };
}
function dirEntry(name: string, children: unknown[]) {
  let served = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      // Real readers yield in batches and end with an empty array; emulate that.
      readEntries: (ok: (e: unknown[]) => void) => {
        if (served) return ok([]);
        served = true;
        ok(children);
      },
    }),
  };
}
function dataTransferWithEntries(entries: unknown[]): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files: [] as unknown as FileList,
  } as unknown as DataTransfer;
}

describe('itemsFromDataTransfer — drag-and-drop', () => {
  it('recursively walks a dropped folder, preserving relative paths', async () => {
    const dt = dataTransferWithEntries([
      dirEntry('thesis', [
        fileEntry('main.tex'),
        dirEntry('figs', [fileEntry('a.png'), fileEntry('b.png')]),
      ]),
    ]);
    const items = await itemsFromDataTransfer(dt);
    expect(items.map((i) => i.relativePath).sort()).toEqual([
      'thesis/figs/a.png',
      'thesis/figs/b.png',
      'thesis/main.tex',
    ]);
  });

  it('handles a mix of a top-level file and a folder', async () => {
    const dt = dataTransferWithEntries([fileEntry('readme.tex'), dirEntry('imgs', [fileEntry('x.png')])]);
    const items = await itemsFromDataTransfer(dt);
    expect(items.map((i) => i.relativePath).sort()).toEqual(['imgs/x.png', 'readme.tex']);
  });

  it('falls back to flat dataTransfer.files when the entry API is unavailable', async () => {
    const dt = { items: [], files: [makeFile('lone.tex')] } as unknown as DataTransfer;
    const items = await itemsFromDataTransfer(dt);
    expect(items).toEqual([{ file: expect.any(File), relativePath: 'lone.tex' }]);
  });
});
