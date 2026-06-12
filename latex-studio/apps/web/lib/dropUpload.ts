'use client';

/**
 * Turn a picked FileList or a drag-and-dropped DataTransfer into a flat list of
 * upload items, preserving folder structure.
 *
 * - `<input>` selections expose the in-folder path on `File.webkitRelativePath`.
 * - Drag-and-drop does NOT: a dropped folder shows up as a single
 *   `DataTransferItem` whose `webkitGetAsEntry()` is a directory we must walk
 *   recursively. We snapshot the entries synchronously (the item list is
 *   invalidated after the first await / once the drop handler returns), then
 *   traverse them.
 */

import type { UploadItem } from './fileKind';

/** Map an `<input type=file>` FileList (incl. webkitdirectory) to upload items. */
export function itemsFromFileList(list: FileList | File[] | null | undefined): UploadItem[] {
  const files = list ? Array.from(list) : [];
  return files.map((file) => ({
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

// Minimal structural types for the non-standard FileSystem entry API.
interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}
interface FsFileEntry extends FsEntry {
  file(success: (f: File) => void, error: (e: unknown) => void): void;
}
interface FsDirEntry extends FsEntry {
  createReader(): { readEntries(success: (entries: FsEntry[]) => void, error: (e: unknown) => void): void };
}

function readFile(entry: FsFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDir(entry: FsDirEntry): Promise<FsEntry[]> {
  const reader = entry.createReader();
  const all: FsEntry[] = [];
  // readEntries yields at most ~100 entries per call; loop until it returns none.
  return new Promise((resolve, reject) => {
    const pump = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          pump();
        }
      }, reject);
    pump();
  });
}

async function walkEntry(entry: FsEntry, prefix: string, out: UploadItem[]): Promise<void> {
  if (entry.isFile) {
    try {
      const file = await readFile(entry as FsFileEntry);
      out.push({ file, relativePath: prefix + entry.name });
    } catch {
      /* unreadable file — skip */
    }
  } else if (entry.isDirectory) {
    const children = await readDir(entry as FsDirEntry);
    for (const child of children) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

/**
 * Collect upload items from a drop. Uses the FileSystem entry API to recurse
 * into dropped folders; falls back to the flat `dataTransfer.files` when the
 * browser doesn't expose entries.
 */
export async function itemsFromDataTransfer(dt: DataTransfer): Promise<UploadItem[]> {
  const items = dt.items;
  const entries: FsEntry[] = [];
  if (items && items.length > 0) {
    // Snapshot entries synchronously before any await.
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const getAsEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry;
      const entry = typeof getAsEntry === 'function' ? getAsEntry.call(item) : null;
      if (entry) entries.push(entry);
    }
  }
  if (entries.length === 0) return itemsFromFileList(dt.files); // no entry API → flat files

  const out: UploadItem[] = [];
  for (const entry of entries) await walkEntry(entry, '', out);
  return out;
}
