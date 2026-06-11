'use client';

import { create } from 'zustand';
import { api, ApiError } from './api';
import { useEditorStore } from './store';
import { useReviewStore } from './reviewStore';
import { fileToBase64, isImagePath } from './fileKind';
import type { CiteLink, LibraryFolder, LiteratureItem, TrashItem } from './types';

interface PendingUpload {
  files: File[];
  folderId: string | null;
}

function expandedKey(projectId: string): string {
  return `latex-studio:lib-expanded:${projectId}`;
}

interface LibraryState {
  folders: LibraryFolder[];
  items: LiteratureItem[];
  trashCount: number;
  loading: boolean;
  error: string | null;
  expanded: Set<string>;
  search: string;
  searchResults: LiteratureItem[] | null;
  citeKeys: string[];
  citeLinks: CiteLink[];
  selectedItemId: string | null;
  pendingUpload: PendingUpload | null;
  trashOpen: boolean;
  trashItems: TrashItem[];

  load: () => Promise<void>;
  createFolder: (name: string, parentId: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  requestUpload: (files: File[], folderId: string | null) => void;
  confirmUpload: () => Promise<void>;
  cancelUpload: () => void;
  patchItem: (id: string, body: Partial<LiteratureItem>) => Promise<void>;
  linkItem: (id: string, citeKey: string) => Promise<void>;
  generateBib: (id: string) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  doSearch: (q: string) => Promise<void>;
  viewItem: (item: LiteratureItem) => void;
  toggleFolder: (id: string) => void;
  select: (id: string | null) => void;
  openTrash: () => Promise<void>;
  closeTrash: () => void;
  restore: (trashId: string) => Promise<void>;
  empty: () => Promise<void>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  folders: [],
  items: [],
  trashCount: 0,
  loading: false,
  error: null,
  expanded: new Set(),
  search: '',
  searchResults: null,
  citeKeys: [],
  citeLinks: [],
  selectedItemId: null,
  pendingUpload: null,
  trashOpen: false,
  trashItems: [],

  async load() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ loading: true, error: null });
    try {
      const [tree, keys] = await Promise.all([api.getLibrary(ed.projectId), api.getCiteKeys(ed.projectId).catch(() => ({ keys: [] }))]);
      let expanded = get().expanded;
      try {
        const raw = window.localStorage.getItem(expandedKey(ed.projectId));
        if (raw) expanded = new Set(JSON.parse(raw) as string[]);
      } catch {
        /* ignore */
      }
      set({ folders: tree.folders, items: tree.items, trashCount: tree.trashCount, citeKeys: keys.keys, loading: false, expanded });
    } catch (err) {
      set({ loading: false, error: err instanceof ApiError ? err.message : 'Could not load the library' });
    }
  },

  async createFolder(name, parentId) {
    const ed = useEditorStore.getState();
    if (!ed.projectId || !name.trim()) return;
    try {
      await api.createLibFolder(ed.projectId, name.trim(), parentId);
      await get().load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not create the folder');
    }
  },

  async renameFolder(id, name) {
    if (!name.trim()) return;
    try {
      await api.renameLibFolder(id, { name: name.trim() });
      await get().load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not rename');
    }
  },

  async deleteFolder(id) {
    try {
      await api.deleteLibFolder(id);
      await get().load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not delete');
    }
  },

  requestUpload(files, folderId) {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || (!isImagePath(f.name) && f.type === 'application/pdf'));
    if (pdfs.length === 0) {
      window.alert('Only PDF files can be added to the library.');
      return;
    }
    set({ pendingUpload: { files: pdfs, folderId } });
  },

  async confirmUpload() {
    const ed = useEditorStore.getState();
    const pending = get().pendingUpload;
    if (!ed.projectId || !pending) return;
    set({ pendingUpload: null });
    for (const file of pending.files) {
      try {
        const fileBase64 = await fileToBase64(file);
        await api.uploadLibItem(ed.projectId, { fileName: file.name, fileBase64, folderId: pending.folderId });
      } catch (err) {
        window.alert(`${file.name}: ${err instanceof ApiError ? err.message : 'upload failed'}`);
      }
    }
    await get().load();
  },

  cancelUpload() {
    set({ pendingUpload: null });
  },

  async patchItem(id, body) {
    try {
      await api.patchLibItem(id, body);
      await get().load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not save');
    }
  },

  async linkItem(id, citeKey) {
    try {
      await api.linkLibItem(id, citeKey);
      await get().load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not link');
    }
  },

  async generateBib(id) {
    const ed = useEditorStore.getState();
    try {
      const { citeKey } = await api.generateBib(id);
      await get().load();
      if (ed.projectId) await ed.refreshFiles().catch(() => undefined);
      window.alert(`Created and linked \\cite{${citeKey}} in your .bib.`);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not generate a .bib entry');
    }
  },

  async deleteItem(id) {
    try {
      await api.deleteLibItem(id);
      await get().load();
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not delete');
    }
  },

  async doSearch(q) {
    const ed = useEditorStore.getState();
    set({ search: q });
    if (!q.trim() || !ed.projectId) {
      set({ searchResults: null });
      return;
    }
    try {
      const res = await api.searchLibrary(ed.projectId, q.trim());
      set({ searchResults: res.items });
    } catch {
      set({ searchResults: null });
    }
  },

  viewItem(item) {
    useReviewStore.getState().viewLiterature(api.libItemPdfUrl(item.id), item.title || item.fileName);
    set({ selectedItemId: item.id });
  },

  toggleFolder(id) {
    set((s) => {
      const next = new Set(s.expanded);
      next.has(id) ? next.delete(id) : next.add(id);
      const projectId = useEditorStore.getState().projectId;
      if (projectId) {
        try {
          window.localStorage.setItem(expandedKey(projectId), JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
      }
      return { expanded: next };
    });
  },

  select: (selectedItemId) => set({ selectedItemId }),

  async openTrash() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    set({ trashOpen: true });
    try {
      const res = await api.getTrash(ed.projectId);
      set({ trashItems: res.items });
    } catch {
      set({ trashItems: [] });
    }
  },
  closeTrash: () => set({ trashOpen: false }),

  async restore(trashId) {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    try {
      await api.restoreTrash(ed.projectId, trashId);
      await Promise.all([get().load(), get().openTrash()]);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not restore');
    }
  },

  async empty() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    try {
      await api.emptyTrash(ed.projectId);
      await Promise.all([get().load(), get().openTrash()]);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not empty trash');
    }
  },
}));
