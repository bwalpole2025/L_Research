'use client';

import { useEffect, useRef, useState } from 'react';
import { BookText, ChevronDown, ChevronRight, FolderPlus, Pencil, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useLibraryStore } from '@/lib/libraryStore';
import type { LibraryFolder, LiteratureItem } from '@/lib/types';

function LinkBadge({ item }: { item: LiteratureItem }) {
  if (item.citeKey && item.hasText) return <span className="rounded bg-emerald-100 px-1 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="linked + text extracted">{item.citeKey} ✓</span>;
  if (item.citeKey) return <span className="rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title="linked, no extracted text">{item.citeKey}</span>;
  return <span className="rounded bg-zinc-200 px-1 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title="not linked to a cite key">unlinked</span>;
}

function ItemEditor({ item }: { item: LiteratureItem }) {
  const patchItem = useLibraryStore((s) => s.patchItem);
  const linkItem = useLibraryStore((s) => s.linkItem);
  const generateBib = useLibraryStore((s) => s.generateBib);
  const citeKeys = useLibraryStore((s) => s.citeKeys);
  const [draft, setDraft] = useState({ title: item.title, authors: item.authors, year: item.year, doi: item.doi ?? '', abstract: item.abstract ?? '' });

  const field = (label: string, key: keyof typeof draft, area = false) => (
    <label className="block text-[11px] text-zinc-500 dark:text-zinc-400">
      {label}
      {area ? (
        <textarea value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} rows={2} className="mt-0.5 w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700" />
      ) : (
        <input value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} className="mt-0.5 w-full rounded border border-zinc-200 bg-transparent px-1.5 py-1 text-xs dark:border-zinc-700" />
      )}
    </label>
  );

  return (
    <div className="space-y-1.5 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
      {field('Title', 'title')}
      {field('Authors', 'authors')}
      <div className="flex gap-2">
        <div className="flex-1">{field('Year', 'year')}</div>
        <div className="flex-1">{field('DOI', 'doi')}</div>
      </div>
      {field('Abstract', 'abstract', true)}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button type="button" onClick={() => void patchItem(item.id, { title: draft.title, authors: draft.authors, year: draft.year, doi: draft.doi || null, abstract: draft.abstract || null })} className="rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Save
        </button>
        <select
          data-testid="link-citekey"
          value={item.citeKey ?? ''}
          onChange={(e) => e.target.value && void linkItem(item.id, e.target.value)}
          className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-[11px] dark:border-zinc-700"
        >
          <option value="">link to cite key…</option>
          {citeKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void generateBib(item.id)} className="inline-flex items-center gap-1 rounded border border-blue-300 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/10">
          <Sparkles className="h-3 w-3" /> Generate .bib
        </button>
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: LiteratureItem }) {
  const viewItem = useLibraryStore((s) => s.viewItem);
  const deleteItem = useLibraryStore((s) => s.deleteItem);
  const selectedItemId = useLibraryStore((s) => s.selectedItemId);
  const select = useLibraryStore((s) => s.select);
  const editing = selectedItemId === item.id;

  return (
    <li className="rounded-md">
      <div className="group flex items-center gap-1.5 px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
        <BookText className="h-3.5 w-3.5 shrink-0 text-violet-400" />
        <button type="button" onClick={() => viewItem(item)} className="min-w-0 flex-1 truncate text-left text-zinc-700 hover:underline dark:text-zinc-200" title={item.title || item.fileName}>
          {item.title || item.fileName}
        </button>
        <LinkBadge item={item} />
        <button type="button" aria-label="Edit metadata" onClick={() => select(editing ? null : item.id)} className="text-zinc-400 opacity-0 hover:text-zinc-700 group-hover:opacity-100 dark:hover:text-zinc-200">
          <Pencil className="h-3 w-3" />
        </button>
        <button type="button" aria-label="Delete" onClick={() => { if (window.confirm(`Move “${item.title || item.fileName}” to trash?`)) void deleteItem(item.id); }} className="text-zinc-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {editing && <ItemEditor item={item} />}
    </li>
  );
}

function FolderNode({ folder, depth }: { folder: LibraryFolder; depth: number }) {
  const folders = useLibraryStore((s) => s.folders);
  const items = useLibraryStore((s) => s.items);
  const expanded = useLibraryStore((s) => s.expanded);
  const toggle = useLibraryStore((s) => s.toggleFolder);
  const createFolder = useLibraryStore((s) => s.createFolder);
  const renameFolder = useLibraryStore((s) => s.renameFolder);
  const deleteFolder = useLibraryStore((s) => s.deleteFolder);
  const requestUpload = useLibraryStore((s) => s.requestUpload);
  const open = expanded.has(folder.id);
  const childFolders = folders.filter((f) => f.parentId === folder.id);
  const childItems = items.filter((i) => i.folderId === folder.id);
  const [drag, setDrag] = useState(false);

  return (
    <li>
      <div
        className={`group flex items-center gap-1 py-1 pr-2 text-xs ${drag ? 'bg-blue-50 dark:bg-blue-500/10' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/60'}`}
        style={{ paddingLeft: `${0.25 + depth * 0.75}rem` }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files); if (files.length) requestUpload(files, folder.id); }}
      >
        <button type="button" onClick={() => toggle(folder.id)} className="text-zinc-400">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="flex-1 cursor-pointer truncate font-medium text-zinc-600 dark:text-zinc-300" onClick={() => toggle(folder.id)}>
          {folder.name}
        </span>
        <div className="hidden items-center gap-0.5 group-hover:flex">
          <button type="button" aria-label="New subfolder" onClick={() => { const n = window.prompt('Folder name'); if (n) void createFolder(n, folder.id); }} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <FolderPlus className="h-3 w-3" />
          </button>
          <button type="button" aria-label="Rename folder" onClick={() => { const n = window.prompt('Rename folder', folder.name); if (n) void renameFolder(folder.id, n); }} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <Pencil className="h-3 w-3" />
          </button>
          <button type="button" aria-label="Delete folder" onClick={() => { if (window.confirm(`Move folder “${folder.name}” and its articles to trash?`)) void deleteFolder(folder.id); }} className="text-zinc-400 hover:text-red-600">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {open && (
        <ul style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}>
          {childFolders.map((f) => (
            <FolderNode key={f.id} folder={f} depth={depth + 1} />
          ))}
          {childItems.map((i) => (
            <ItemRow key={i.id} item={i} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function LibraryPanel() {
  const projectId = useEditorStore((s) => s.projectId);
  const load = useLibraryStore((s) => s.load);
  const folders = useLibraryStore((s) => s.folders);
  const items = useLibraryStore((s) => s.items);
  const search = useLibraryStore((s) => s.search);
  const searchResults = useLibraryStore((s) => s.searchResults);
  const doSearch = useLibraryStore((s) => s.doSearch);
  const createFolder = useLibraryStore((s) => s.createFolder);
  const requestUpload = useLibraryStore((s) => s.requestUpload);
  const trashCount = useLibraryStore((s) => s.trashCount);
  const openTrash = useLibraryStore((s) => s.openTrash);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (projectId) void load();
  }, [projectId, load]);

  const rootFolders = folders.filter((f) => f.parentId === null);
  const rootItems = items.filter((i) => i.folderId === null);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]" data-testid="library-panel">
      <div className="flex h-10 items-center gap-1 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-2 text-xs dark:border-zinc-800">
        <span className="font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Library</span>
        <button type="button" aria-label="New folder" data-testid="lib-new-folder" onClick={() => { const n = window.prompt('Folder name'); if (n) void createFolder(n, null); }} className="ml-auto rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Upload PDF" data-testid="lib-upload" onClick={() => fileInput.current?.click()} className="rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          <Upload className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-label="Trash" data-testid="lib-trash" onClick={() => void openTrash()} className="relative rounded p-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-700">
          <Trash2 className="h-3.5 w-3.5" />
          {trashCount > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-zinc-500 px-1 text-[9px] text-white">{trashCount}</span>}
        </button>
      </div>
      <input ref={fileInput} data-testid="lib-file-input" type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) requestUpload(files, null); }} />

      <div className="border-b border-zinc-100 p-2 dark:border-zinc-800">
        <div className="flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900">
          <Search className="h-3 w-3 text-zinc-400" />
          <input value={search} onChange={(e) => void doSearch(e.target.value)} placeholder="Search title, author, full text…" data-testid="lib-search" className="h-7 flex-1 bg-transparent text-xs outline-none" />
        </div>
      </div>

      <div className="flex-1 overflow-auto py-1 text-sm">
        {searchResults ? (
          <ul>
            {searchResults.length === 0 ? <li className="px-3 py-2 text-xs text-zinc-400">No matches.</li> : searchResults.map((i) => <ItemRow key={i.id} item={i} />)}
          </ul>
        ) : (
          <ul>
            {rootFolders.map((f) => (
              <FolderNode key={f.id} folder={f} depth={0} />
            ))}
            {rootItems.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
            {folders.length === 0 && items.length === 0 && (
              <li className="px-3 py-3 text-xs text-zinc-400">
                Empty. <FolderPlus className="inline h-3 w-3" /> a folder or <Upload className="inline h-3 w-3" /> a PDF. Drag PDFs onto a folder to add them.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
