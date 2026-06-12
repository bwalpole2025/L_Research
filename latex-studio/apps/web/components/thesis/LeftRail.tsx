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

  const heading = tab === 'files' ? 'Project files' : tab === 'outline' ? 'Outline' : 'Library';

  return (
    <div className="flex h-full flex-col bg-[var(--ls-editor-bg)]">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--ls-line)] pl-4 pr-2" role="tablist">
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-[#5d688a]">{heading}</span>
        <div className="flex items-center gap-0.5">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              data-testid={`left-tab-${key}`}
              title={label}
              onClick={() => setTab(key)}
              className={`flex rounded-[7px] p-1.5 transition-colors ${
                tab === key
                  ? 'bg-zinc-100 text-zinc-900 dark:bg-[#131b30] dark:text-[#8fa3ff]'
                  : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:text-[#5d688a] dark:hover:bg-[#10182b] dark:hover:text-[#aab3c8]'
              }`}
            >
              <Icon className="h-4 w-4" />
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
