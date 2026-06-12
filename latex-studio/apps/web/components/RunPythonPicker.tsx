'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Search } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useRunStore } from '@/lib/runStore';

/**
 * "Run Python file…" picker (the palette command): a mini command palette scoped
 * to the project's .py files. Type to filter, ↑/↓ to move, Enter to run, Esc to
 * close. Runs any .py regardless of which one is open.
 */
export function RunPythonPicker() {
  const open = useRunStore((s) => s.pickerOpen);
  const close = useRunStore((s) => s.closePicker);
  const runPath = useRunStore((s) => s.runPath);
  const files = useEditorStore((s) => s.files);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pys = files.filter((f) => f.path.toLowerCase().endsWith('.py')).map((f) => f.path).sort();
    return (q ? pys.filter((p) => p.toLowerCase().includes(q)) : pys).slice(0, 50);
  }, [files, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const choose = (path: string) => {
    close();
    runPath(path);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]" onClick={close} data-testid="run-python-picker">
      <div className="w-full max-w-[520px] overflow-hidden rounded-[14px] border border-[var(--ls-line)] bg-[var(--ls-surface-raised)] shadow-[var(--ls-shadow-soft)]" onClick={(e) => e.stopPropagation()}>
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
                const p = results[active];
                if (p) choose(p);
              } else if (e.key === 'Escape') {
                close();
              }
            }}
            placeholder="Run Python file…"
            className="flex-1 bg-transparent text-[15px] text-[var(--ls-text)] outline-none placeholder:text-[var(--ls-muted)]"
          />
        </div>
        <ul className="max-h-[320px] overflow-y-auto py-1.5">
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-[var(--ls-muted)]">No .py files in this project.</li>}
          {results.map((p, i) => (
            <li key={p}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
                className={`flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors ${i === active ? 'bg-[var(--ls-brand-soft)]' : ''}`}
              >
                <Play className="h-3.5 w-3.5 flex-none text-[var(--ls-muted)]" />
                <span className="min-w-0 truncate text-[13.5px] text-[var(--ls-text)]" style={{ fontFamily: 'var(--ls-mono)' }}>
                  {p}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
