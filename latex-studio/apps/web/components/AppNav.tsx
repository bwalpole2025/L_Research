'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Project } from '@latex-studio/shared';
import { api } from '@/lib/api';
import { saveLastProject } from '@/lib/persist';
import { loadSession, signOut } from '@/lib/session';
import { Wordmark } from '@/components/Wordmark';
import { BrandIcon } from '@/components/BrandIcon';
import { ProjectPalette } from '@/components/projects/ProjectPalette';

/**
 * APP SHELL — the dashboard chrome from the "LaTeX Studio – Dashboard" design
 * export: a 286px sidebar (wordmark, primary action, nav with an active bar,
 * user card with sign-out) beside a scrollable main pane.
 */

const LINKS: Array<{ href: string; label: string }> = [
  { href: '/files', label: 'All projects' },
  { href: '/references', label: 'References' },
  { href: '/plugins', label: 'Plugins' },
  { href: '/stats', label: 'Stats' },
];

/** Tag-dot palette (cycled per project, deterministic). */
export const TAG_COLORS = ['#5b76f7', '#e8a33d', '#e05c7e', '#45b89e', '#a78bfa'];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = loadSession();
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    void api.listProjects().then(setProjects).catch(() => undefined);
  }, []);
  const initials = (session?.name ?? 'LS')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--ls-bg)]">
      {/* ── Sidebar ── */}
      <aside className="flex w-[286px] flex-none flex-col border-r border-[var(--ls-line)] bg-[var(--ls-editor-bg)] px-[18px] pb-[18px] pt-[26px]">
        <div className="flex flex-col gap-[3px] px-1.5">
          <Link href="/" className="flex items-center gap-2.5">
            <BrandIcon size={26} />
            <Wordmark size={25} />
          </Link>
          <div className="mt-[7px] text-[10.5px] uppercase tracking-[0.2em] text-zinc-400 dark:text-[#5d688a]">Typesetting Studio</div>
        </div>

        <button
          type="button"
          data-testid="new-project"
          onClick={() => {
            const name = window.prompt('Name the new project:');
            if (!name?.trim()) return;
            void api.createProject(name.trim()).then((p) => {
              saveLastProject(p.id);
              router.push('/studio');
            });
          }}
          className="mt-[26px] flex h-[46px] w-full items-center justify-center gap-2 rounded-[11px] bg-[#4e68f5] text-[14.5px] font-semibold text-white shadow-[0_6px_20px_rgba(78,104,245,0.30)] transition-colors hover:bg-[#5f78f8]"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
          New project
        </button>

        <nav className="mt-6 flex flex-col gap-0.5">
          {LINKS.map((l) => {
            const active = pathname?.startsWith(l.href) ?? false;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative flex items-center gap-3 rounded-[9px] px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? 'bg-[rgba(78,104,245,0.10)] font-medium text-zinc-900 dark:bg-[rgba(91,118,247,0.08)] dark:text-[#dbe3ff]'
                    : 'text-zinc-500 hover:bg-zinc-100 dark:text-[#98a2bb] dark:hover:bg-[#10182b]'
                }`}
              >
                <span
                  className="absolute bottom-[9px] left-0 top-[9px] w-[2.5px] rounded-sm bg-[#5b76f7]"
                  style={{ opacity: active ? 1 : 0 }}
                />
                <span className="whitespace-nowrap">{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mx-1.5 my-5 h-px bg-[var(--ls-line)]" />

        <div className="flex items-center justify-between px-2 pb-3">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-zinc-400 dark:text-[#5d688a]">Tags</span>
          <Link href="/studio" className="flex items-center gap-1 text-xs text-zinc-400 transition-colors hover:text-[#4e68f5] dark:text-[#5d688a] dark:hover:text-[#8fa3ff]">
            Open Studio
          </Link>
        </div>
        <div className="-mx-1 flex flex-1 flex-col gap-px overflow-y-auto px-1">
          {projects.map((p, i) => (
            <Link
              key={p.id}
              href={`/files?tag=${p.id}`}
              data-testid="tag-row"
              className="flex items-center gap-[11px] rounded-[9px] px-3 py-2 transition-colors hover:bg-zinc-100 dark:hover:bg-[#10182b]"
            >
              <span className="h-[11px] w-[11px] flex-none rounded-[3px]" style={{ background: TAG_COLORS[i % TAG_COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-600 dark:text-[#aab3c8]">{p.name}</span>
            </Link>
          ))}
        </div>

        <div className="mt-auto flex items-center gap-2.5 border-t border-[var(--ls-line)] px-2 pb-0.5 pt-3">
          <div
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] text-[15px] font-semibold text-[#ffffff]"
            style={{ background: 'linear-gradient(135deg, #4e68f5, #3247b8)', fontFamily: 'var(--ls-serif)' }}
          >
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-zinc-800 dark:text-[#d3daea]">{session?.name ?? 'Signed out'}</div>
            <div data-testid="nav-user" className="truncate text-[11px] text-zinc-400 dark:text-[#5d688a]">
              {session?.email ?? '—'} · Studio Premium
            </div>
          </div>
          <button
            type="button"
            data-testid="nav-signout"
            title="Sign out"
            onClick={() => {
              signOut();
              router.push('/');
            }}
            className="flex rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-[#5d688a] dark:hover:bg-[#10182b] dark:hover:text-[#aab3c8]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 11l3-3-3-3M13 8H6M9 3H4.5A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>

      {/* ⌘K palette — jump to any project across folders. */}
      <ProjectPalette />
    </div>
  );
}

/** Page header in the template's voice: tracked eyebrow + Newsreader headline. */
export function PageHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div>
      <div className="mb-2 text-[11.5px] uppercase tracking-[0.16em] text-zinc-400 dark:text-[#5d688a]">{eyebrow}</div>
      <h1 className="m-0 text-[40px] font-medium leading-none text-zinc-900 dark:text-[#f2f4fa]" style={{ fontFamily: 'var(--ls-serif)', letterSpacing: '.005em' }}>
        {title}
      </h1>
      {sub && <p className="mt-3 text-sm text-zinc-500 dark:text-[#8a93a8]">{sub}</p>}
    </div>
  );
}

/** Search input in the template's style. */
export function ShellSearch(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex h-[52px] items-center gap-3 rounded-[13px] border border-zinc-200 bg-white px-[18px] transition-colors focus-within:border-[#4e68f5] dark:border-[#1f2840] dark:bg-[#0d1322]">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="flex-none text-zinc-400 dark:text-[#5d688a]">
        <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M12 12l3.2 3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <input {...props} className="flex-1 bg-transparent text-[15px] text-zinc-900 outline-none dark:text-[#eef1f8]" />
    </div>
  );
}
