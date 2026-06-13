'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  Compass,
  Download,
  EllipsisVertical,
  FileSearch,
  History,
  ListChecks,
  Loader2,
  MessageSquare,
  Moon,
  Play,
  Plus,
  Settings,
  Shapes,
  Share2,
  Sigma,
  Workflow,
  Sparkles,
  SpellCheck,
  Square,
  Sun,
  Terminal,
} from 'lucide-react';
import { computeOverallStatus, useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { useRunStore } from '@/lib/runStore';
import { useThesisStore } from '@/lib/thesisStore';
import { useCoderiveStore } from '@/lib/coderiveStore';
import { useReviewStore } from '@/lib/reviewStore';
import { ApiError } from '@/lib/api';
import { dialog } from '@/lib/dialogStore';
import { loadSession } from '@/lib/session';
import { SaveIndicator } from './SaveIndicator';
import { CompileStatusPill } from './CompileStatusPill';
import { replayProductTour } from './ProductTour';

/**
 * EDITOR TOP BAR — the "LaTeX Studio – Editor" design: back chevron, serif
 * document title with the save state beneath, then Share · Recompile ·
 * download · avatar. Everything else lives in the ⋮ Tools menu (same testids
 * and shortcuts as before — the features moved, they didn't disappear).
 */

interface ToolbarProps {
  onOpenSnapshots: () => void;
  onOpenSettings: () => void;
  onCheckMath: () => void;
}

export function Toolbar({ onOpenSnapshots, onOpenSettings, onCheckMath }: ToolbarProps) {
  const projects = useEditorStore((s) => s.projects);
  const projectId = useEditorStore((s) => s.projectId);
  const selectProject = useEditorStore((s) => s.selectProject);
  const createProject = useEditorStore((s) => s.createProject);
  const theme = useEditorStore((s) => s.theme);
  const toggleTheme = useEditorStore((s) => s.toggleTheme);
  const status = useEditorStore((s) => s.status);
  const openFileIds = useEditorStore((s) => s.openFileIds);
  const compiling = useEditorStore((s) => s.compiling);
  const compileOnSave = useEditorStore((s) => s.compileOnSave);
  const setCompileOnSave = useEditorStore((s) => s.setCompileOnSave);
  const compileProject = useEditorStore((s) => s.compileProject);
  const chatOpen = useAiStore((s) => s.chatOpen);
  const toggleChat = useAiStore((s) => s.toggleChat);
  const aiAvailable = useAiStore((s) => s.status.available);
  const runAudit = useThesisStore((s) => s.runAudit);
  const runProse = useThesisStore((s) => s.runProse);
  const openPreSubmit = useThesisStore((s) => s.openPreSubmit);
  const openCoderive = useCoderiveStore((s) => s.openDialog);
  const runReview = useReviewStore((s) => s.runReview);
  const setBottomTab = useThesisStore((s) => s.setBottomTab);
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const files = useEditorStore((s) => s.files);
  const running = useRunStore((s) => s.running);
  const runActive = useRunStore((s) => s.runActive);
  const stopRun = useRunStore((s) => s.stop);
  const runAndCompile = useRunStore((s) => s.runAndCompile);
  const openRunPicker = useRunStore((s) => s.openPicker);

  const [toolsOpen, setToolsOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toolsOpen) return;
    const close = (e: MouseEvent) => {
      if (!toolsRef.current?.contains(e.target as Node)) setToolsOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [toolsOpen]);

  const overall = computeOverallStatus(status, openFileIds);
  const project = projects.find((p) => p.id === projectId);
  const activePath = files.find((f) => f.id === activeFileId)?.path;
  const canRun = (!!activePath && activePath.toLowerCase().endsWith('.py')) || !!project?.pythonRunTarget;
  const session = loadSession();
  const initials = (session?.name ?? 'LS')
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const newProject = useCallback(async () => {
    const name = (await dialog.prompt({ title: 'New project', placeholder: 'project name' }))?.trim();
    if (!name) return;
    try {
      await createProject(name);
    } catch (err) {
      void dialog.alert({ title: 'Couldn’t create project', message: err instanceof ApiError ? err.message : 'Failed to create project.' });
    }
  }, [createProject]);

  const menuItem =
    'flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left text-[13px] text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-[#c6cde0] dark:hover:bg-[#10182b]';

  const tool = (run: () => void) => () => {
    setToolsOpen(false);
    run();
  };

  return (
    <header className="flex h-14 flex-none items-center justify-between gap-3 border-b border-[var(--ls-line)] bg-[var(--ls-editor-bg)] px-[18px]">
      {/* ── Left: back · title · save state ── */}
      <div className="flex min-w-0 items-center gap-3.5">
        <Link
          href="/files"
          title="Back to dashboard"
          className="flex rounded-[9px] p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#98a2bb] dark:hover:bg-[#131b30] dark:hover:text-[#eef1f8]"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </Link>
        <div className="h-6 w-px bg-[var(--ls-line-strong)]" />
        <div className="flex min-w-0 flex-col">
          <div className="relative flex min-w-0 items-center gap-1.5">
            <span
              className="truncate text-base leading-[1.1] text-zinc-900 dark:text-[#f2f4fa]"
              style={{ fontFamily: 'var(--ls-serif)' }}
            >
              {project?.name ?? 'LaTeX Studio'}
            </span>
            <ChevronDown className="h-3 w-3 flex-none text-zinc-400 dark:text-[#5d688a]" />
            {/* invisible select on top — the title IS the project switcher */}
            <select
              aria-label="Project"
              value={projectId ?? ''}
              onChange={(e) => void selectProject(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <SaveIndicator status={overall} />
        </div>
      </div>

      {/* ── Right: status · tools · share · compile · download · avatar ── */}
      <div className="flex flex-none items-center gap-2.5">
        <CompileStatusPill />
        <div ref={toolsRef} className="relative">
          <button
            type="button"
            aria-label="Tools"
            data-testid="tools-menu"
            aria-expanded={toolsOpen}
            onClick={() => setToolsOpen((v) => !v)}
            className="flex rounded-[9px] p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#98a2bb] dark:hover:bg-[#131b30] dark:hover:text-[#eef1f8]"
          >
            <EllipsisVertical className="h-[18px] w-[18px]" />
          </button>
          {/* Always mounted (hidden when closed) so state-reflecting attributes stay readable. */}
          <div
            className={`absolute right-0 top-11 z-50 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-[#1f2840] dark:bg-[#0d1322] ${toolsOpen ? '' : 'hidden'}`}
          >
            <button type="button" title="Check derivation (⌘⇧↵)" onClick={tool(onCheckMath)} className={menuItem}>
              <Sigma className="h-4 w-4" /> Check math
            </button>
            <button type="button" title="Co-derive (LLM proposes · SymPy verifies)" data-testid="coderive" onClick={tool(openCoderive)} className={menuItem}>
              <Sparkles className="h-4 w-4" /> Co-derive
            </button>
            <button
              type="button"
              title="Document review (⌘⇧R)"
              data-testid="review"
              onClick={tool(() => {
                setBottomTab('review');
                void runReview('project');
              })}
              className={menuItem}
            >
              <FileSearch className="h-4 w-4" /> Review
            </button>
            <button type="button" title="Audit maths (⌘⇧A)" data-testid="audit-maths" onClick={tool(() => void runAudit('file'))} className={menuItem}>
              <ListChecks className="h-4 w-4" /> Audit maths
            </button>
            <button type="button" title="Prose check (⌘⇧L)" data-testid="prose-check" onClick={tool(() => void runProse('file'))} className={menuItem}>
              <SpellCheck className="h-4 w-4" /> Prose check
            </button>
            <button type="button" title="Pre-submit check (⌘⇧S)" data-testid="pre-submit" onClick={tool(openPreSubmit)} className={menuItem}>
              <ClipboardCheck className="h-4 w-4" /> Pre-submit
            </button>
            <button type="button" onClick={tool(onOpenSnapshots)} className={menuItem}>
              <History className="h-4 w-4" /> Snapshots
            </button>
            <div className="mx-2 my-1.5 h-px bg-zinc-200 dark:bg-[#1a2133]" />
            <button
              type="button"
              aria-label="Toggle Claude chat"
              title="Claude chat"
              aria-pressed={chatOpen}
              data-testid="toggle-chat"
              onClick={tool(toggleChat)}
              className={menuItem}
            >
              <MessageSquare className="h-4 w-4" /> Claude chat
              <span className={`ml-auto inline-block h-1.5 w-1.5 rounded-full ${aiAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden />
            </button>
            <label className={`${menuItem} cursor-pointer`}>
              <input type="checkbox" checked={compileOnSave} onChange={(e) => setCompileOnSave(e.target.checked)} className="peer sr-only" />
              <span className="relative h-4 w-7 rounded-full bg-zinc-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-[#4e68f5] peer-checked:after:translate-x-3 dark:bg-zinc-700" />
              Auto compile
            </label>
            <button type="button" onClick={tool(() => void newProject())} className={menuItem}>
              <Plus className="h-4 w-4" /> New project
            </button>
            <div className="mx-2 my-1.5 h-px bg-zinc-200 dark:bg-[#1a2133]" />
            <button
              type="button"
              aria-label="Replay product tour"
              title="Replay the product tour"
              data-testid="replay-tour"
              onClick={tool(replayProductTour)}
              className={menuItem}
            >
              <Compass className="h-4 w-4" /> Replay tour
            </button>
            <button type="button" aria-label="Project settings" title="Project settings (macros, assumptions)" onClick={tool(onOpenSettings)} className={menuItem}>
              <Settings className="h-4 w-4" /> Project settings
            </button>
            <button type="button" aria-label="Toggle theme" onClick={tool(toggleTheme)} className={menuItem}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void dialog.alert({ title: 'Sharing', message: 'Sharing is not available in the local construction build yet.' })}
          className="flex h-9 items-center gap-2 rounded-[9px] border border-zinc-300 px-3.5 text-[13.5px] text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-[#2a3247] dark:text-[#c6cde0] dark:hover:border-[#3a4866] dark:hover:bg-[#10182b]"
        >
          <Share2 className="h-[15px] w-[15px]" /> Share
        </button>

        {/* Visual diagram editor (separate page). */}
        <Link
          href="/diagram"
          data-testid="open-diagram"
          title="Visual diagram editor"
          className="flex h-9 items-center gap-2 rounded-[9px] border border-zinc-300 px-3.5 text-[13.5px] text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-[#2a3247] dark:text-[#c6cde0] dark:hover:border-[#3a4866] dark:hover:bg-[#10182b]"
        >
          <Shapes className="h-[15px] w-[15px]" /> Diagram
        </Link>

        {/* Maths/TikZ diagram editor — its own full page, like /diagram. */}
        <Link
          href={projectId ? `/math-diagram?project=${projectId}` : '/math-diagram'}
          data-testid="open-math-diagram"
          title="Maths diagram editor (TikZ — labels typeset with your document)"
          className="flex h-9 items-center gap-2 rounded-[9px] border border-zinc-300 px-3.5 text-[13.5px] text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-[#2a3247] dark:text-[#c6cde0] dark:hover:border-[#3a4866] dark:hover:bg-[#10182b]"
        >
          <Workflow className="h-[15px] w-[15px]" /> Math diagram
        </Link>

        {/* Run Python (separate from Compile) — flips to Stop while running. */}
        <div className="relative flex items-center">
          {running ? (
            <button
              type="button"
              data-testid="run-stop"
              title="Stop the running script"
              onClick={() => void stopRun()}
              className="flex h-9 items-center gap-2 rounded-[9px] bg-rose-500 px-4 text-[13.5px] font-semibold text-white shadow-[0_4px_14px_rgba(244,63,94,0.25)] transition-colors hover:bg-rose-600"
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
          ) : (
            <div className="flex">
              <button
                type="button"
                data-testid="run-python"
                title="Run Python (⌘R)"
                disabled={!canRun}
                onClick={runActive}
                className="flex h-9 items-center gap-2 rounded-l-[9px] bg-emerald-500 px-3.5 text-[13.5px] font-semibold text-white shadow-[0_4px_14px_rgba(16,185,129,0.25)] transition-colors hover:bg-emerald-600 disabled:pointer-events-none disabled:opacity-50"
              >
                <Terminal className="h-3.5 w-3.5" /> Run
              </button>
              <button
                type="button"
                aria-label="Run options"
                onClick={() => setRunMenuOpen((v) => !v)}
                className="flex h-9 items-center rounded-r-[9px] border-l border-emerald-600/60 bg-emerald-500 px-1.5 text-white transition-colors hover:bg-emerald-600"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {runMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setRunMenuOpen(false)} />
              <div className="absolute right-0 top-11 z-50 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-[#1f2840] dark:bg-[#0d1322]">
                <button type="button" data-testid="run-picker" onClick={() => { setRunMenuOpen(false); openRunPicker(); }} className={menuItem}>
                  <Terminal className="h-4 w-4" /> Run Python file…
                </button>
                <button type="button" data-testid="run-and-compile" onClick={() => { setRunMenuOpen(false); void runAndCompile(); }} className={menuItem}>
                  <Play className="h-4 w-4" /> Run &amp; Compile
                </button>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          title="Compile (⌘↵)"
          data-tour="compile"
          onClick={() => void compileProject()}
          disabled={compiling}
          className="flex h-9 items-center gap-2 rounded-[9px] bg-[#4e68f5] px-4 text-[13.5px] font-semibold text-white shadow-[0_4px_14px_rgba(78,104,245,0.30)] transition-colors hover:bg-[#5f78f8] disabled:pointer-events-none disabled:opacity-60"
        >
          {compiling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Compile
        </button>

        <button
          type="button"
          aria-label="Download PDF"
          title="Download PDF"
          onClick={() => window.dispatchEvent(new CustomEvent('ls:download-pdf'))}
          className="flex rounded-[9px] p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#98a2bb] dark:hover:bg-[#131b30] dark:hover:text-[#eef1f8]"
        >
          <Download className="h-[18px] w-[18px]" />
        </button>

        <Link
          href="/files"
          title={session ? `${session.name} — dashboard` : 'Dashboard'}
          className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#4e68f5] text-[13px] font-semibold text-white"
          style={{ fontFamily: 'var(--ls-serif)' }}
        >
          {initials}
        </Link>
      </div>
    </header>
  );
}
