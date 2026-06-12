'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { extractBibEntries } from '@/lib/latexIndex';
import { AppShell, PageHeader, ShellSearch } from '@/components/AppNav';
import { RequireSession } from '@/components/RequireSession';

interface RefRow {
  key: string;
  title: string;
  authors: string;
  year: string;
  project: string;
  source: string; // "refs.bib" or "Library PDF"
}

/** Every bibliography reference the studio knows about: entries parsed from the
 *  projects' .bib files plus the PDF library's items — searchable, with
 *  one-click \cite{…} copying. */
function ReferencesIndex() {
  const [rows, setRows] = useState<RefRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const out: RefRow[] = [];
      try {
        const projects = await api.listProjects();
        for (const p of projects) {
          // 1. .bib files
          const files = await api.listFiles(p.id).catch(() => []);
          for (const f of files.filter((f) => f.path.toLowerCase().endsWith('.bib'))) {
            const full = await api.getFile(f.id).catch(() => null);
            if (!full || full.encoding === 'base64') continue;
            for (const e of extractBibEntries(full.content)) {
              out.push({
                key: e.key,
                title: e.title ?? '',
                authors: e.author ?? '',
                year: e.year ?? '',
                project: p.name,
                source: f.path,
              });
            }
          }
          // 2. PDF library items with cite keys
          const lib = await api.getLibrary(p.id).catch(() => null);
          for (const item of lib?.items ?? []) {
            out.push({
              key: item.citeKey ?? '',
              title: item.title,
              authors: item.authors,
              year: item.year,
              project: p.name,
              source: 'Library PDF',
            });
          }
        }
      } finally {
        if (!cancelled) {
          setRows(out);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => rows.filter((r) => !q || [r.key, r.title, r.authors, r.year, r.project].some((v) => v.toLowerCase().includes(q))),
    [rows, q],
  );

  const copyCite = async (key: string) => {
    try {
      await navigator.clipboard.writeText(`\\cite{${key}}`);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1180px] px-11 pb-20 pt-12">
        <PageHeader
          eyebrow="Workspace · Bibliography"
          title="References"
          sub={loading ? 'Loading…' : `${rows.length} entries from .bib files and the PDF library.`}
        />
        <div className="mt-7">
          <ShellSearch
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="refs-search"
            placeholder="Search key, author, title…"
          />
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-[0_18px_50px_-28px_rgba(0,0,0,0.25)] dark:border-[#1d2640] dark:bg-[#0d1322] dark:shadow-[0_18px_50px_-28px_rgba(0,0,0,0.7)]">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-[11.5px] uppercase tracking-[0.13em] text-zinc-500 dark:border-[#1d2640] dark:text-[#6b7693]">
              <tr>
                <th className="px-4 py-2">Cite key</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Authors</th>
                <th className="px-4 py-2">Year</th>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r, i) => (
                <tr key={`${r.key}:${i}`} data-testid="refs-row" className="border-t border-zinc-100 transition-colors hover:bg-zinc-50 dark:border-[#161d31] dark:hover:bg-[#10182b]">
                  <td className="px-4 py-3 font-mono text-xs text-zinc-700 dark:text-[#aab6d8]">{r.key || '—'}</td>
                  <td className="max-w-md truncate px-4 py-3 text-[14.5px] text-zinc-900 dark:text-[#eef1f8]" style={{ fontFamily: 'var(--ls-serif)' }} title={r.title}>{r.title || '—'}</td>
                  <td className="max-w-[14rem] truncate px-4 py-3 text-zinc-500 dark:text-[#98a2bb]" title={r.authors}>{r.authors || '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-[#8a93a8]">{r.year || '—'}</td>
                  <td className="px-4 py-3 text-zinc-500 dark:text-[#8a93a8]">{r.project}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-zinc-400 dark:text-[#5d688a]">{r.source}</td>
                  <td className="px-4 py-3 text-right">
                    {r.key && (
                      <button
                        type="button"
                        onClick={() => void copyCite(r.key)}
                        data-testid="refs-copy"
                        className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-[#2a3247] dark:text-[#c6cde0] dark:hover:bg-[#1c2740] dark:hover:text-[#8fa3ff]"
                      >
                        {copied === r.key ? 'Copied ✓' : 'Copy \\cite'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-zinc-400 dark:text-[#5d688a]">
                    No references found{q ? ' for this search' : ' — add a .bib file or import PDFs into the library'}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

export default function ReferencesPage() {
  return (
    <RequireSession>
      <ReferencesIndex />
    </RequireSession>
  );
}
