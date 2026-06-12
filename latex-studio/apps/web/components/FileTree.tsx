'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Shapes,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileImage,
  FilePlus,
  FileTerminal,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Pencil,
  Trash2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore } from '@/lib/thesisStore';
import { ApiError } from '@/lib/api';
import { ALL_EXTENSIONS, isBinaryPath, isPythonPath } from '@/lib/fileKind';
import { itemsFromDataTransfer, itemsFromFileList } from '@/lib/dropUpload';
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
      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

export function FileTree() {
  const files = useEditorStore((s) => s.files);
  const folders = useEditorStore((s) => s.folders);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const uploadFiles = useEditorStore((s) => s.uploadFiles);
  const unverifiedByFile = useThesisStore((s) => s.auditReport?.byFile ?? {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadDirRef = useRef<string>('');

  const triggerUpload = useCallback((dir: string) => {
    uploadDirRef.current = dir;
    fileInputRef.current?.click();
  }, []);

  const triggerFolderUpload = useCallback((dir: string) => {
    uploadDirRef.current = dir;
    folderInputRef.current?.click();
  }, []);

  const runUpload = useCallback(
    async (items: { file: File; relativePath: string }[], dir: string) => {
      if (items.length === 0) return;
      const { uploaded, skipped, errors } = await uploadFiles(items, dir);
      const notes: string[] = [];
      if (skipped > 0) notes.push(`${skipped} unsupported file(s) skipped.`);
      if (errors.length > 0) notes.push(`Errors:\n${errors.join('\n')}`);
      if (notes.length > 0) {
        window.alert(`Uploaded ${uploaded} file(s).\n\n${notes.join('\n\n')}`);
      }
    },
    [uploadFiles],
  );

  const onUploadChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const items = itemsFromFileList(e.target.files);
      e.target.value = ''; // allow re-selecting the same file/folder
      await runUpload(items, uploadDirRef.current);
    },
    [runUpload],
  );

  // Drag a file or folder from the OS straight onto the tree (or a folder row).
  // `dropTarget` is the directory the drop would land in ('' = project root);
  // null means nothing is being dragged over.
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const onDragOverInto = useCallback((e: React.DragEvent, dir: string) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      setDropTarget(dir);
    }
  }, []);
  const onDropInto = useCallback(
    async (e: React.DragEvent, dir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropTarget(null);
      const items = await itemsFromDataTransfer(e.dataTransfer);
      await runUpload(items, dir);
    },
    [runUpload],
  );
  const openFile = useEditorStore((s) => s.openFile);
  const createFile = useEditorStore((s) => s.createFile);
  const createFolder = useEditorStore((s) => s.createFolder);
  const renameFile = useEditorStore((s) => s.renameFile);
  const renameFolder = useEditorStore((s) => s.renameFolder);
  const deleteFile = useEditorStore((s) => s.deleteFile);
  const deleteFolder = useEditorStore((s) => s.deleteFolder);

  // `webkitdirectory`/`directory` aren't in React's input typings — set them on
  // the DOM node directly so folder selection works without an unsafe cast.
  useEffect(() => {
    const el = folderInputRef.current;
    if (!el) return;
    el.setAttribute('webkitdirectory', '');
    el.setAttribute('directory', '');
  }, []);

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
    async (folder: string, presetName?: string) => {
      const name = presetName ?? window.prompt(`New file in ${folder || 'root'} (e.g. chapter.tex)`);
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
              className={`group mx-1 flex h-7 items-center gap-1 rounded-md pr-2 text-[13px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50 ${
                dropTarget === node.path ? 'bg-blue-100 ring-1 ring-inset ring-blue-400 dark:bg-blue-500/20 dark:ring-blue-500' : ''
              }`}
              style={pad}
              onDragOver={(e) => onDragOverInto(e, node.path)}
              onDrop={(e) => void onDropInto(e, node.path)}
            >
              <button
                type="button"
                onClick={() => toggle(node.path)}
                className="shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-600 dark:group-hover:text-zinc-300"
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {open ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-blue-500" />
              ) : (
                <FolderClosed className="h-4 w-4 shrink-0 text-blue-500" />
              )}
              <span
                className="flex-1 cursor-pointer truncate"
                onClick={() => toggle(node.path)}
              >
                {node.name}
              </span>
              <div className="hidden items-center group-hover:flex">
                <IconButton icon={FilePlus} label="New file" onClick={() => void newFile(node.path)} />
                <IconButton icon={Upload} label="Upload files here" onClick={() => triggerUpload(node.path)} />
                <IconButton icon={FolderUp} label="Upload folder here" onClick={() => triggerFolderUpload(node.path)} />
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
          className={`group mx-1 flex h-7 items-center gap-1.5 rounded-md pr-2 text-[13px] transition-colors ${
            active
              ? 'bg-blue-50 font-medium text-zinc-950 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/15 dark:text-blue-50 dark:ring-blue-500/30'
              : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-zinc-50'
          }`}
          style={pad}
        >
          {isPythonPath(node.path) ? (
            <FileTerminal className="ml-[18px] h-4 w-4 shrink-0 text-[#3776ab]" />
          ) : isBinaryPath(node.path) ? (
            <FileImage className="ml-[18px] h-4 w-4 shrink-0 text-violet-500" />
          ) : (
            node.path.toLowerCase().endsWith('.diagram.json') ? (
            <Shapes className="ml-[18px] h-4 w-4 shrink-0 text-[#4e68f5]" />
          ) : (
            <FileCode className="ml-[18px] h-4 w-4 shrink-0 text-zinc-400" />
          )
          )}
          <span
            className="flex-1 cursor-pointer truncate"
            data-testid={`file-${node.path}`}
            onClick={() => void openFile(node.id)}
          >
            {node.name}
          </span>
          {(unverifiedByFile[node.path] ?? 0) > 0 && (
            <span
              data-testid={`unverified-${node.path}`}
              title={`${unverifiedByFile[node.path]} unverified equation(s)`}
              className="shrink-0 rounded bg-amber-100 px-1.5 text-[10px] font-semibold text-amber-800 group-hover:hidden dark:bg-amber-500/15 dark:text-amber-200"
            >
              {unverifiedByFile[node.path]}
            </span>
          )}
          <div className="hidden items-center group-hover:flex">
            <IconButton icon={Pencil} label="Rename file" onClick={() => void doRenameFile(node.id, node.path)} />
            <IconButton icon={Trash2} label="Delete file" onClick={() => void doDeleteFile(node.id, node.path)} />
          </div>
        </div>
      );
    });

  return (
    <div
      className={`relative flex h-full flex-col bg-[var(--ls-surface)] ${
        dropTarget === '' ? 'ring-2 ring-inset ring-blue-400 dark:ring-blue-500' : ''
      }`}
      onDragOver={(e) => onDragOverInto(e, '')}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
      }}
      onDrop={(e) => void onDropInto(e, '')}
      data-testid="file-tree-root"
    >
      <div className="flex h-10 items-center justify-between border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs font-semibold text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>Files</span>
        <div className="flex items-center gap-0.5">
          <IconButton icon={FilePlus} label="New file" onClick={() => void newFile('')} />
          <IconButton
            icon={Shapes}
            label="New TikZ diagram"
            onClick={() => {
              const name = window.prompt('New diagram name (e.g. setup)');
              if (name?.trim()) void newFile('', `${name.trim().replace(/\.diagram\.json$/i, '')}.diagram.json`);
            }}
          />
          <IconButton icon={Upload} label="Upload files" onClick={() => triggerUpload('')} />
          <IconButton icon={FolderUp} label="Upload folder" onClick={() => triggerFolderUpload('')} />
          <IconButton icon={FolderPlus} label="New folder" onClick={() => newFolder('')} />
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALL_EXTENSIONS.join(',')}
        data-testid="file-upload-input"
        className="hidden"
        onChange={(e) => void onUploadChange(e)}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        data-testid="folder-upload-input"
        className="hidden"
        onChange={(e) => void onUploadChange(e)}
      />
      <div className="flex-1 overflow-auto py-1.5 text-sm">
        {tree.length === 0 ? (
          <p className="px-3 py-4 text-xs text-zinc-400">No files yet.</p>
        ) : (
          renderNodes(tree, 0)
        )}
      </div>
    </div>
  );
}
