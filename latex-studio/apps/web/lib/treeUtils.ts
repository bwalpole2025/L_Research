import type { FileMeta } from './types';

export interface TreeFileNode {
  type: 'file';
  id: string;
  name: string;
  path: string;
}

export interface TreeFolderNode {
  type: 'folder';
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = TreeFileNode | TreeFolderNode;

/** Parent folder path of a file/folder path, or '' for top level. */
export function parentPath(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Build a sorted nested tree from a flat list of files plus any client-only
 * empty folders. Folders are virtual: they are derived from file paths, with
 * `extraFolders` covering folders the user created before adding a file.
 */
export function buildTree(files: FileMeta[], extraFolders: string[] = []): TreeNode[] {
  const root: TreeFolderNode = { type: 'folder', name: '', path: '', children: [] };

  const folderAt = (segments: string[]): TreeFolderNode => {
    let node = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let child = node.children.find(
        (c): c is TreeFolderNode => c.type === 'folder' && c.name === seg,
      );
      if (!child) {
        child = { type: 'folder', name: seg, path: acc, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    return node;
  };

  for (const folder of extraFolders) {
    if (folder) folderAt(folder.split('/'));
  }

  for (const file of files) {
    const segments = file.path.split('/');
    const name = segments.pop()!;
    const parent = folderAt(segments);
    parent.children.push({ type: 'file', id: file.id, name, path: file.path });
  }

  sortNodes(root);
  return root.children;
}

/** Folders before files; each group alphabetical (case-insensitive). */
function sortNodes(node: TreeFolderNode): void {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  for (const child of node.children) {
    if (child.type === 'folder') sortNodes(child);
  }
}
