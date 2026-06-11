'use client';

import { useCallback, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileCode,
  FilePlus,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Pencil,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { ApiError } from '@/lib/api';
import { basename, buildTree, parentPath, type TreeNode } from '@/lib/treeUtils';

function reportError(err: unknown): void {
  window.alert(err instanceof ApiError ? err.message : 'Something went wrong');
}

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}

function IconButton({ icon: Icon, label, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function FileTree() {
  const files = useEditorStore((s) => s.files);
  const folders = useEditorStore((s) => s.folders);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const openFile = useEditorStore((s) => s.openFile);
  const createFile = useEditorStore((s) => s.createFile);
  const createFolder = useEditorStore((s) => s.createFolder);
  const renameFile = useEditorStore((s) => s.renameFile);
  const renameFolder = useEditorStore((s) => s.renameFolder);
  const deleteFile = useEditorStore((s) => s.deleteFile);
  const deleteFolder = useEditorStore((s) => s.deleteFolder);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = buildTree(files, folders);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const newFile = useCallback(
    async (folder: string) => {
      const name = window.prompt(`New file in ${folder || 'root'} (e.g. chapter.tex)`);
      if (!name?.trim()) return;
      const path = folder ? `${folder}/${name.trim()}` : name.trim();
      try {
        await createFile(path);
      } catch (err) {
        reportError(err);
      }
    },
    [createFile],
  );

  const newFolder = useCallback(
    (folder: string) => {
      const name = window.prompt(`New folder in ${folder || 'root'}`);
      if (!name?.trim()) return;
      createFolder(folder ? `${folder}/${name.trim()}` : name.trim());
    },
    [createFolder],
  );

  const doRenameFile = async (id: string, path: string) => {
    const name = window.prompt('Rename file', basename(path));
    if (!name?.trim()) return;
    const parent = parentPath(path);
    try {
      await renameFile(id, parent ? `${parent}/${name.trim()}` : name.trim());
    } catch (err) {
      reportError(err);
    }
  };

  const doRenameFolder = async (path: string) => {
    const name = window.prompt('Rename folder', basename(path));
    if (!name?.trim()) return;
    const parent = parentPath(path);
    try {
      await renameFolder(path, parent ? `${parent}/${name.trim()}` : name.trim());
    } catch (err) {
      reportError(err);
    }
  };

  const doDeleteFile = async (id: string, path: string) => {
    if (!window.confirm(`Delete ${path}?`)) return;
    try {
      await deleteFile(id);
    } catch (err) {
      reportError(err);
    }
  };

  const doDeleteFolder = async (path: string) => {
    if (!window.confirm(`Delete folder "${path}" and all files inside it?`)) return;
    try {
      await deleteFolder(path);
    } catch (err) {
      reportError(err);
    }
  };

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const pad = { paddingLeft: `${depth * 12 + 8}px` };
      if (node.type === 'folder') {
        const open = !collapsed.has(node.path);
        return (
          <div key={`d:${node.path}`}>
            <div
              className="group flex items-center gap-1 py-1 pr-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
              style={pad}
            >
              <button
                type="button"
                onClick={() => toggle(node.path)}
                className="shrink-0 text-slate-400"
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {open ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-sky-500" />
              ) : (
                <FolderClosed className="h-4 w-4 shrink-0 text-sky-500" />
              )}
              <span
                className="flex-1 cursor-pointer truncate"
                onClick={() => toggle(node.path)}
              >
                {node.name}
              </span>
              <div className="hidden items-center group-hover:flex">
                <IconButton icon={FilePlus} label="New file" onClick={() => void newFile(node.path)} />
                <IconButton icon={FolderPlus} label="New folder" onClick={() => newFolder(node.path)} />
                <IconButton icon={Pencil} label="Rename folder" onClick={() => void doRenameFolder(node.path)} />
                <IconButton icon={Trash2} label="Delete folder" onClick={() => void doDeleteFolder(node.path)} />
              </div>
            </div>
            {open && renderNodes(node.children, depth + 1)}
          </div>
        );
      }

      const active = node.id === activeFileId;
      return (
        <div
          key={`f:${node.id}`}
          className={`group flex items-center gap-1.5 py-1 pr-2 ${
            active
              ? 'bg-sky-100 text-slate-900 dark:bg-sky-500/20 dark:text-slate-50'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
          }`}
          style={pad}
        >
          <FileCode className="ml-[18px] h-4 w-4 shrink-0 text-slate-400" />
          <span
            className="flex-1 cursor-pointer truncate"
            data-testid={`file-${node.path}`}
            onClick={() => void openFile(node.id)}
          >
            {node.name}
          </span>
          <div className="hidden items-center group-hover:flex">
            <IconButton icon={Pencil} label="Rename file" onClick={() => void doRenameFile(node.id, node.path)} />
            <IconButton icon={Trash2} label="Delete file" onClick={() => void doDeleteFile(node.id, node.path)} />
          </div>
        </div>
      );
    });

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-900/40">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Files
        <div className="flex items-center gap-0.5">
          <IconButton icon={FilePlus} label="New file" onClick={() => void newFile('')} />
          <IconButton icon={FolderPlus} label="New folder" onClick={() => newFolder('')} />
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1 text-sm">
        {tree.length === 0 ? (
          <p className="px-3 py-4 text-xs text-slate-400">No files yet — create one above.</p>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>
    </div>
  );
}
