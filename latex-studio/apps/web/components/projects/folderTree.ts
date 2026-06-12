import type { ProjectFolder } from '@latex-studio/shared';

/**
 * Pure helpers for the Home project-explorer. The API returns folders as a flat
 * `parentId` array (like the literature library); these rebuild the tree, paths,
 * and descendant sets, and encode the drag-and-drop payload. `null` is the root
 * ("All projects" / "Unfiled").
 */

/** Direct child folders of `parentId`, name-sorted. */
export function childFolders(folders: ProjectFolder[], parentId: string | null): ProjectFolder[] {
  return folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
}

export function folderById(folders: ProjectFolder[], id: string | null): ProjectFolder | null {
  if (!id) return null;
  return folders.find((f) => f.id === id) ?? null;
}

/** Root→…→folder chain (empty array for the root). */
export function folderPath(folders: ProjectFolder[], id: string | null): ProjectFolder[] {
  const path: ProjectFolder[] = [];
  let cur = folderById(folders, id);
  let guard = 0;
  while (cur && guard++ < 1000) {
    path.unshift(cur);
    cur = folderById(folders, cur.parentId);
  }
  return path;
}

/** "Ferrofluid / Plateau border" — or "All projects" for the root. */
export function folderPathLabel(folders: ProjectFolder[], id: string | null): string {
  const path = folderPath(folders, id);
  return path.length ? path.map((f) => f.name).join(' / ') : 'All projects';
}

/** `{id, …descendants}` — the folders whose projects fall "under" `id`. */
export function descendantIds(folders: ProjectFolder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        added = true;
      }
    }
  }
  return out;
}

// ── Drag-and-drop payload (folder move + project move share one MIME type) ──────

const DND_TYPE = 'application/x-ls-home';
export type DragPayload = { kind: 'folder' | 'project'; id: string };

export function setDragPayload(e: React.DragEvent, payload: DragPayload): void {
  e.dataTransfer.setData(DND_TYPE, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = 'move';
}

export function readDragPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DND_TYPE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DragPayload;
    return parsed.kind === 'folder' || parsed.kind === 'project' ? parsed : null;
  } catch {
    return null;
  }
}
