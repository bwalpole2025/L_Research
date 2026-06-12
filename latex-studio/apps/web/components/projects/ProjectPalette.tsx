'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import type { Project, ProjectFolder } from '@latex-studio/shared';
import { api } from '@/lib/api';
import { saveLastProject } from '@/lib/persist';
import { folderPathLabel } from './folderTree';

/**
 * ⌘K / Ctrl-K command palette: jump to ANY project regardless of which folder it
 * lives in. Type to filter (name or folder path), ↑/↓ to move, Enter to open in
 * Studio, Esc to close. Self-contained — loads its data when first opened. Mounted
 * once in the AppShell so it's available across the dashboard.
 */
export function ProjectPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<ProjectFolder[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const loaded = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    void Promise.all([api.listProjects(), api.listProjectFolders()])
      .then(([ps, fr]) => {
        setProjects(ps);
        setFolders(fr.folders);
        loaded.current = true;
      })
      .catch(() => undefined);
  }, []);

  // Global ⌘K / Ctrl-K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      if (!loaded.current) load();
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, load]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withPath = projects.map((p) => ({ project: p, path: folderPathLabel(folders, p.folderId ?? null) }));
    const filtered = q
      ? withPath.filter(({ project, path }) => project.name.toLowerCase().includes(q) || path.toLowerCase().includes(q))
      : withPath;
    return filtered.slice(0, 50);
  }, [projects, folders, query]);

  if (!open) return null;

  const choose = (projectId: string) => {
    saveLastProject(projectId);
    setOpen(false);
    router.push('/studio');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={() => setOpen(false)}
      data-testid="project-palette"
    >
      <div
        className="w-full max-w-[560px] overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface-raised)] shadow-[var(--ls-shadow-soft)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--ls-line)] px-4 py-3">
          <Search className="h-4 w-4 flex-none text-[var(--ls-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const r = results[active];
                if (r) choose(r.project.id);
              } else if (e.key === 'Escape') {
                setOpen(false);
              }
            }}
            placeholder="Jump to a project…"
            className="flex-1 bg-transparent text-[15px] text-[var(--ls-text)] outline-none placeholder:text-[var(--ls-muted)]"
          />
          <kbd className="rounded border border-[var(--ls-line)] px-1.5 py-0.5 text-[10px] text-[var(--ls-muted)]">esc</kbd>
        </div>

        <ul className="max-h-[320px] overflow-y-auto py-1.5">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-[var(--ls-muted)]">No projects found.</li>}
          {results.map(({ project, path }, i) => (
            <li key={project.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(project.id)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left transition-colors ${
                  i === active ? 'bg-[var(--ls-brand-soft)]' : ''
                }`}
              >
                <span className="min-w-0 truncate text-[14px] text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-serif)' }}>
                  {project.name}
                </span>
                <span className="flex-none truncate text-[12px] text-[var(--ls-muted)]">{path}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
