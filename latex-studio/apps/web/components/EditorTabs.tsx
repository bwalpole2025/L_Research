'use client';

import { FileText, X } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { basename } from '@/lib/treeUtils';

export function EditorTabs() {
  const files = useEditorStore((s) => s.files);
  const openFileIds = useEditorStore((s) => s.openFileIds);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const status = useEditorStore((s) => s.status);
  const setActive = useEditorStore((s) => s.setActive);
  const closeFile = useEditorStore((s) => s.closeFile);

  if (openFileIds.length === 0) return null;

  return (
    <div
      className="flex h-10 items-end overflow-x-auto border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-1.5 pt-1.5 dark:border-zinc-800"
      role="tablist"
    >
      {openFileIds.map((id) => {
        const file = files.find((f) => f.id === id);
        if (!file) return null;
        const active = id === activeFileId;
        const dirty = status[id] === 'dirty' || status[id] === 'saving';
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            onMouseDown={() => setActive(id)}
            className={`group flex h-8 max-w-[220px] cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors ${
              active
                ? 'border-zinc-200 bg-[var(--ls-editor-bg)] text-zinc-950 shadow-[0_-1px_0_rgba(18,25,38,0.02)] dark:border-zinc-800 dark:text-zinc-50'
                : 'border-transparent text-zinc-500 hover:bg-white/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/80 dark:hover:text-zinc-100'
            }`}
            title={file.path}
            data-testid={`tab-${file.path}`}
          >
            <FileText className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-blue-500' : 'text-zinc-400'}`} />
            <span className="truncate font-medium">{basename(file.path)}</span>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400 ${dirty ? '' : 'invisible'}`}
              aria-hidden
            />
            <button
              type="button"
              onMouseDown={(e) => {
                e.stopPropagation();
                closeFile(id);
              }}
              className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-200 hover:text-zinc-800 group-hover:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              aria-label={`Close ${file.path}`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
