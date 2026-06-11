import { describe, it, expect } from 'vitest';
import { buildTree, basename, parentPath } from '../lib/treeUtils';
import type { FileMeta } from '../lib/types';

const f = (id: string, path: string): FileMeta => ({ id, projectId: 'p', path, updatedAt: '' });

describe('treeUtils', () => {
  it('builds a nested tree with folders before files, each sorted', () => {
    const tree = buildTree([
      f('1', 'main.tex'),
      f('2', 'chapters/intro.tex'),
      f('3', 'chapters/methods.tex'),
      f('4', 'refs.bib'),
    ]);

    expect(tree.map((n) => n.name)).toEqual(['chapters', 'main.tex', 'refs.bib']);
    const chapters = tree[0];
    expect(chapters?.type).toBe('folder');
    if (chapters?.type === 'folder') {
      expect(chapters.children.map((c) => c.name)).toEqual(['intro.tex', 'methods.tex']);
    }
  });

  it('includes client-only empty folders', () => {
    const tree = buildTree([], ['images']);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe('images');
    expect(tree[0]?.type).toBe('folder');
  });

  it('derives basename and parentPath', () => {
    expect(basename('a/b/c.tex')).toBe('c.tex');
    expect(basename('main.tex')).toBe('main.tex');
    expect(parentPath('a/b/c.tex')).toBe('a/b');
    expect(parentPath('main.tex')).toBe('');
  });
});
