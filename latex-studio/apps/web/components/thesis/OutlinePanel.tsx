'use client';

import { useEffect, useMemo } from 'react';
import { Hash, Loader2, Tag } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useThesisStore } from '@/lib/thesisStore';
import type { OutlineNode } from '@/lib/types';

function flatten(nodes: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (n: OutlineNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return out;
}

function NodeRow({ node, currentId }: { node: OutlineNode; currentId: string | null }) {
  const reveal = useEditorStore((s) => s.revealLocation);
  const isCurrent = node.id === currentId;
  return (
    <li>
      <button
        type="button"
        onClick={() => void reveal(node.file, node.line)}
        style={{ paddingLeft: `${0.5 + node.level * 0.75}rem` }}
        className={`mx-1 flex h-7 w-[calc(100%-0.5rem)] items-center gap-1 rounded-md pr-2 text-left text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
          isCurrent ? 'bg-blue-50 font-medium text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30' : 'text-zinc-700 dark:text-zinc-200'
        }`}
      >
        <Hash className="h-3 w-3 shrink-0 text-zinc-400" />
        <span className="truncate">{node.title || '(untitled)'}</span>
      </button>
      {node.labels.map((l) => (
        <button
          key={`${l.name}:${l.line}`}
          type="button"
          onClick={() => void reveal(node.file, l.line)}
          style={{ paddingLeft: `${1.25 + node.level * 0.75}rem` }}
          className="mx-1 flex h-6 w-[calc(100%-0.5rem)] items-center gap-1 rounded-md pr-2 text-left text-[11px] text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
          title={`\\label{${l.name}}`}
        >
          <Tag className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate font-mono">{l.name}</span>
        </button>
      ))}
      {node.children.map((c) => (
        <ul key={c.id}>
          <NodeRow node={c} currentId={currentId} />
        </ul>
      ))}
    </li>
  );
}

export function OutlinePanel() {
  const outline = useThesisStore((s) => s.outline);
  const loading = useThesisStore((s) => s.outlineLoading);
  const refresh = useThesisStore((s) => s.refreshOutline);
  const projectId = useEditorStore((s) => s.projectId);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const files = useEditorStore((s) => s.files);
  const cursors = useEditorStore((s) => s.cursors);
  const activeContent = useEditorStore((s) => (s.activeFileId ? s.contents[s.activeFileId] : undefined));

  // Refresh on edit (debounced) so the outline stays in sync while typing.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 500);
    return () => clearTimeout(t);
  }, [projectId, activeContent, refresh]);

  const activePath = files.find((f) => f.id === activeFileId)?.path;
  const currentId = useMemo(() => {
    if (!activeFileId || !activePath || activeContent === undefined) return null;
    const head = cursors[activeFileId]?.head;
    if (head === undefined) return null;
    let line = 1;
    for (let i = 0; i < head && i < activeContent.length; i++) if (activeContent[i] === '\n') line += 1;
    let best: OutlineNode | null = null;
    for (const n of flatten(outline)) {
      if (n.file === activePath && n.line <= line && (!best || n.line > best.line)) best = n;
    }
    return best?.id ?? null;
  }, [outline, activeFileId, activePath, activeContent, cursors]);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-surface)]" data-testid="outline-panel">
      <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-[var(--ls-surface-muted)] px-3 text-xs dark:border-zinc-800">
        <span className="font-semibold text-zinc-500 dark:text-zinc-400">Outline</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />}
      </div>
      <div className="flex-1 overflow-auto py-1.5">
        {outline.length === 0 ? (
          <p className="px-3 py-3 text-xs text-zinc-400">No sections found.</p>
        ) : (
          <ul>
            {outline.map((n) => (
              <NodeRow key={n.id} node={n} currentId={currentId} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
