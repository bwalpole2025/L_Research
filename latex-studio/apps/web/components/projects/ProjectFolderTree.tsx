'use client';

import { useState } from 'react';
import type { Project, ProjectFolder } from '@latex-studio/shared';
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { childFolders, readDragPayload, setDragPayload, type DragPayload } from './folderTree';

/**
 * Left-rail folder tree for the Home explorer. Rebuilds the nested tree from the
 * flat `parentId` array (same approach as the literature library's FolderNode),
 * with expand/collapse, inline rename, hover actions, and HTML5 drag-and-drop —
 * folders and project cards can be dropped onto any folder (or the root).
 */

interface TreeProps {
  folders: ProjectFolder[];
  projects: Project[];
  selectedId: string | null;
  expanded: Set<string>;
  onSelect: (id: string | null) => void;
  onToggle: (id: string) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  /** A folder or project was dropped onto `targetId` (null = root). */
  onDrop: (payload: DragPayload, targetId: string | null) => void;
}

export function ProjectFolderTree(props: TreeProps) {
  const { folders, selectedId, onSelect, onCreateFolder, onDrop } = props;
  const [dropTarget, setDropTarget] = useState<string | null | 'none'>('none');

  const rootCount = props.projects.filter((p) => !p.folderId).length;
  const rootSelected = selectedId === null;
  const rootDrop = dropTarget === null;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between px-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[var(--ls-muted)]">Folders</span>
        <button
          type="button"
          aria-label="New folder at root"
          onClick={() => onCreateFolder(null)}
          className="flex rounded-md p-1 text-[var(--ls-muted)] transition-colors hover:bg-[var(--ls-surface-muted)] hover:text-[var(--ls-text)]"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto">
        {/* Root: "All projects" — also a drop target (move to root). */}
        <li>
          <div
            data-testid="folder-root"
            onClick={() => onSelect(null)}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(null);
            }}
            onDragLeave={() => setDropTarget('none')}
            onDrop={(e) => {
              e.preventDefault();
              setDropTarget('none');
              const payload = readDragPayload(e);
              if (payload) onDrop(payload, null);
            }}
            className={`flex cursor-pointer items-center gap-2 rounded-[8px] px-2 py-1.5 text-[13px] transition-colors ${
              rootSelected
                ? 'bg-[var(--ls-brand-soft)] font-medium text-[var(--ls-text)]'
                : rootDrop
                  ? 'bg-[var(--ls-brand-soft)]'
                  : 'text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]'
            }`}
          >
            <FolderOpen className="h-4 w-4 flex-none text-[var(--ls-brand)]" />
            <span className="flex-1 truncate">All projects</span>
            {rootCount > 0 && <span className="text-[11px] text-[var(--ls-muted)]">{rootCount}</span>}
          </div>
        </li>

        {childFolders(folders, null).map((f) => (
          <FolderNode key={f.id} folder={f} depth={0} dropTarget={dropTarget} setDropTarget={setDropTarget} {...props} />
        ))}
      </ul>
    </div>
  );
}

function FolderNode({
  folder,
  depth,
  dropTarget,
  setDropTarget,
  folders,
  projects,
  selectedId,
  expanded,
  onSelect,
  onToggle,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDrop,
}: TreeProps & {
  folder: ProjectFolder;
  depth: number;
  dropTarget: string | null | 'none';
  setDropTarget: (v: string | null | 'none') => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  const open = expanded.has(folder.id);
  const kids = childFolders(folders, folder.id);
  const directCount = projects.filter((p) => p.folderId === folder.id).length;
  const selected = selectedId === folder.id;
  const isDrop = dropTarget === folder.id;

  const commit = () => {
    const name = draft.trim();
    setEditing(false);
    if (name && name !== folder.name) onRenameFolder(folder.id, name);
    else setDraft(folder.name);
  };

  return (
    <li>
      <div
        data-testid="folder-node"
        draggable={!editing}
        onDragStart={(e) => setDragPayload(e, { kind: 'folder', id: folder.id })}
        onClick={() => onSelect(folder.id)}
        onDragOver={(e) => {
          e.preventDefault();
          setDropTarget(folder.id);
        }}
        onDragLeave={() => setDropTarget('none')}
        onDrop={(e) => {
          e.preventDefault();
          setDropTarget('none');
          const payload = readDragPayload(e);
          if (payload) onDrop(payload, folder.id);
        }}
        className={`group flex items-center gap-1 rounded-[8px] py-1.5 pr-2 text-[13px] transition-colors ${
          selected
            ? 'bg-[var(--ls-brand-soft)] font-medium text-[var(--ls-text)]'
            : isDrop
              ? 'bg-[var(--ls-brand-soft)]'
              : 'text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]'
        }`}
        style={{ paddingLeft: `${0.4 + depth * 0.8}rem` }}
      >
        <button
          type="button"
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation();
            onToggle(folder.id);
          }}
          className="flex-none text-[var(--ls-muted)]"
        >
          {kids.length ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="inline-block h-3.5 w-3.5" />
          )}
        </button>
        {open ? <FolderOpen className="h-4 w-4 flex-none text-[var(--ls-brand)]" /> : <Folder className="h-4 w-4 flex-none text-[var(--ls-brand)]" />}

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setEditing(false);
                setDraft(folder.name);
              }
            }}
            className="min-w-0 flex-1 rounded border border-[var(--ls-brand)] bg-[var(--ls-surface)] px-1 py-0.5 text-[13px] text-[var(--ls-text)] outline-none"
          />
        ) : (
          <span className="flex-1 truncate">{folder.name}</span>
        )}

        {!editing && (
          <>
            {directCount > 0 && <span className="text-[11px] text-[var(--ls-muted)] group-hover:hidden">{directCount}</span>}
            <div className="hidden items-center gap-0.5 group-hover:flex">
              <button
                type="button"
                aria-label="New subfolder"
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateFolder(folder.id);
                }}
                className="text-[var(--ls-muted)] hover:text-[var(--ls-text)]"
              >
                <FolderPlus className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Rename folder"
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft(folder.name);
                  setEditing(true);
                }}
                className="text-[var(--ls-muted)] hover:text-[var(--ls-text)]"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label="Delete folder"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFolder(folder.id);
                }}
                className="text-[var(--ls-muted)] hover:text-[#e05c7e]"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {open && kids.length > 0 && (
        <ul>
          {kids.map((child) => (
            <FolderNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              folders={folders}
              projects={projects}
              selectedId={selectedId}
              expanded={expanded}
              onSelect={onSelect}
              onToggle={onToggle}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onDrop={onDrop}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
