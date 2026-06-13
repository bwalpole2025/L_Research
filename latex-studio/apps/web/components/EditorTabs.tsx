'use client';

import { FileText, Loader2, X } from 'lucide-react';
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
      className="flex h-10 items-stretch overflow-x-auto border-b border-[var(--ls-line)] bg-[var(--ls-editor-bg)] px-1.5"
      role="tablist"
    >
      {openFileIds.map((id) => {
        const file = files.find((f) => f.id === id);
        if (!file) return null;
        const active = id === activeFileId;
        const st = status[id];
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            onMouseDown={() => setActive(id)}
            className={`group flex max-w-[220px] cursor-pointer items-center gap-2 border-b-2 px-3 text-[13px] transition-colors ${
              active
                ? 'border-[#4e68f5] text-zinc-950 dark:text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-900 dark:text-[#707b99] dark:hover:text-[#c6cde0]'
            }`}
            title={file.path}
            data-testid={`tab-${file.path}`}
          >
            <FileText className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-blue-500' : 'text-zinc-400'}`} />
            <span className="truncate font-medium">{basename(file.path)}</span>
            {st === 'saving' ? (
              // In progress → spinner; dirty → amber dot; error → red dot; saved → nothing.
              <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-500" aria-label="Saving" />
            ) : (
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${st === 'error' ? 'bg-red-500' : 'bg-amber-400'} ${st === 'dirty' || st === 'error' ? '' : 'invisible'}`}
                role={st === 'error' || st === 'dirty' ? 'img' : undefined}
                aria-label={st === 'error' ? 'Save failed' : st === 'dirty' ? 'Unsaved changes' : undefined}
                aria-hidden={st === 'error' || st === 'dirty' ? undefined : true}
              />
            )}
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
