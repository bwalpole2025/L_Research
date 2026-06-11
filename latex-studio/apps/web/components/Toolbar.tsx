'use client';

import { useCallback } from 'react';
import {
  ClipboardCheck,
  FileSearch,
  FileText,
  History,
  ListChecks,
  Loader2,
  MessageSquare,
  Moon,
  Play,
  Plus,
  Settings,
  Sigma,
  Sparkles,
  SpellCheck,
  Sun,
} from 'lucide-react';
import { computeOverallStatus, useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { useThesisStore } from '@/lib/thesisStore';
import { useCoderiveStore } from '@/lib/coderiveStore';
import { useReviewStore } from '@/lib/reviewStore';
import { ApiError } from '@/lib/api';
import { SaveIndicator } from './SaveIndicator';

const buttonBase =
  'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/25 disabled:pointer-events-none disabled:opacity-50';
const secondaryButton =
  `${buttonBase} border-zinc-200 bg-white px-2.5 text-zinc-700 shadow-[0_1px_0_rgba(18,25,38,0.03)] hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-700 dark:hover:bg-zinc-800`;
const primaryButton =
  `${buttonBase} border-blue-600 bg-blue-600 px-3 text-white shadow-[0_8px_18px_rgba(37,99,235,0.22)] hover:border-blue-500 hover:bg-blue-500 dark:border-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400`;
const iconButton =
  `${buttonBase} h-8 w-8 border-zinc-200 bg-white p-0 text-zinc-600 shadow-[0_1px_0_rgba(18,25,38,0.03)] hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-white`;
const compactLabel = 'hidden xl:inline';

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

  const overall = computeOverallStatus(status, openFileIds);

  const newProject = useCallback(async () => {
    const name = window.prompt('New project name');
    if (!name?.trim()) return;
    try {
      await createProject(name.trim());
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Failed to create project');
    }
  }, [createProject]);

  return (
    <header className="flex min-h-14 items-center gap-3 border-b border-zinc-200/80 bg-[var(--ls-surface-raised)] px-4 shadow-[0_1px_0_rgba(18,25,38,0.05)] dark:border-zinc-800">
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-zinc-950 text-white shadow-[0_10px_22px_rgba(24,24,27,0.18)] dark:bg-white dark:text-zinc-950">
          <FileText className="h-4 w-4" />
        </div>
        <span className="hidden text-sm font-semibold text-zinc-950 sm:inline dark:text-zinc-50">LaTeX Studio</span>
        <select
          aria-label="Project"
          value={projectId ?? ''}
          onChange={(e) => void selectProject(e.target.value)}
          className="h-8 max-w-52 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-sm font-medium text-zinc-800 outline-none transition-colors hover:border-zinc-300 focus:border-blue-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-700"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void newProject()}
          className={secondaryButton}
        >
          <Plus className="h-3.5 w-3.5" /> <span>New</span>
        </button>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 overflow-x-auto">
        <SaveIndicator status={overall} />
        <label className="hidden h-8 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-zinc-700 lg:flex">
          <input
            type="checkbox"
            checked={compileOnSave}
            onChange={(e) => setCompileOnSave(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-4 w-7 rounded-full bg-zinc-300 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-blue-600 peer-checked:after:translate-x-3 dark:bg-zinc-700" />
          <span>Auto compile</span>
        </label>
        <div className="hidden h-5 w-px bg-zinc-200 dark:bg-zinc-800 md:block" />
        <button
          type="button"
          title="Compile (⌘↵)"
          onClick={() => void compileProject()}
          disabled={compiling}
          className={primaryButton}
        >
          {compiling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          <span>Compile</span>
        </button>
        <button
          type="button"
          title="Check derivation (⌘⇧↵)"
          onClick={onCheckMath}
          className={secondaryButton}
        >
          <Sigma className="h-3.5 w-3.5" /> <span className={compactLabel}>Check math</span>
        </button>
        <button
          type="button"
          title="Co-derive (LLM proposes · SymPy verifies)"
          data-testid="coderive"
          onClick={openCoderive}
          className={secondaryButton}
        >
          <Sparkles className="h-3.5 w-3.5" /> <span className={compactLabel}>Co-derive</span>
        </button>
        <button
          type="button"
          title="Document review (⌘⇧R) — composes the engines into an annotated review PDF"
          data-testid="review"
          onClick={() => {
            setBottomTab('review');
            void runReview('project');
          }}
          className={secondaryButton}
        >
          <FileSearch className="h-3.5 w-3.5" /> <span className={compactLabel}>Review</span>
        </button>
        <button
          type="button"
          title="Audit maths (⌘⇧A)"
          data-testid="audit-maths"
          onClick={() => void runAudit('file')}
          className={secondaryButton}
        >
          <ListChecks className="h-3.5 w-3.5" /> <span className={compactLabel}>Audit</span>
        </button>
        <button
          type="button"
          title="Prose check (⌘⇧L)"
          data-testid="prose-check"
          onClick={() => void runProse('file')}
          className={secondaryButton}
        >
          <SpellCheck className="h-3.5 w-3.5" /> <span className={compactLabel}>Prose</span>
        </button>
        <button
          type="button"
          title="Pre-submit check (⌘⇧S)"
          data-testid="pre-submit"
          onClick={openPreSubmit}
          className={secondaryButton}
        >
          <ClipboardCheck className="h-3.5 w-3.5" /> <span className={compactLabel}>Pre-submit</span>
        </button>
        <button
          type="button"
          onClick={onOpenSnapshots}
          className={secondaryButton}
        >
          <History className="h-3.5 w-3.5" /> <span className={compactLabel}>Snapshots</span>
        </button>
        <div className="hidden h-5 w-px bg-zinc-200 dark:bg-zinc-800 md:block" />
        <button
          type="button"
          aria-label="Toggle Claude chat"
          title="Claude chat"
          aria-pressed={chatOpen}
          data-testid="toggle-chat"
          onClick={toggleChat}
          className={`relative ${secondaryButton} ${
            chatOpen
              ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/60 dark:bg-blue-500/15 dark:text-blue-200'
              : ''
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" /> <span className={compactLabel}>Claude</span>
          <span
            className={`ml-0.5 inline-block h-1.5 w-1.5 rounded-full ${aiAvailable ? 'bg-emerald-500' : 'bg-amber-500'}`}
            aria-hidden
          />
        </button>
        <button
          type="button"
          aria-label="Project settings"
          title="Project settings (macros, assumptions)"
          onClick={onOpenSettings}
          className={iconButton}
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className={iconButton}
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
