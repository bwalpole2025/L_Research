'use client';

import { X } from 'lucide-react';
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
      className="flex items-stretch overflow-x-auto border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
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
            className={`group flex max-w-[200px] cursor-pointer items-center gap-2 border-r border-slate-200 px-3 py-1.5 text-xs dark:border-slate-800 ${
              active
                ? 'bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'
            }`}
            title={file.path}
            data-testid={`tab-${file.path}`}
          >
            <span className="truncate">{basename(file.path)}</span>
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
              className="shrink-0 rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-200 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-700"
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
