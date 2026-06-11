'use client';

import { BookText, Files, ListTree } from 'lucide-react';
import { useThesisStore } from '@/lib/thesisStore';
import { FileTree } from '../FileTree';
import { OutlinePanel } from './OutlinePanel';
import { LibraryPanel } from '../library/LibraryPanel';

const TABS = [
  { key: 'files', label: 'Files', icon: Files },
  { key: 'outline', label: 'Outline', icon: ListTree },
  { key: 'literature', label: 'Library', icon: BookText },
] as const;

export function LeftRail() {
  const tab = useThesisStore((s) => s.leftTab);
  const setTab = useThesisStore((s) => s.setLeftTab);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]">
      <div className="shrink-0 border-b border-zinc-200 bg-[var(--ls-surface-muted)] p-2 dark:border-zinc-800" role="tablist">
        <div className="grid grid-cols-3 gap-1 rounded-md border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-950">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            data-testid={`left-tab-${key}`}
            onClick={() => setTab(key)}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors ${
              tab === key
                ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-900 dark:text-zinc-50'
                : 'text-zinc-500 hover:bg-white/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/70 dark:hover:text-zinc-100'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        ))}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'files' && <FileTree />}
        {tab === 'outline' && <OutlinePanel />}
        {tab === 'literature' && <LibraryPanel />}
      </div>
    </div>
  );
}
