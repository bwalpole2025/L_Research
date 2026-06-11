'use client';

import { useCallback } from 'react';
import { History, Loader2, MessageSquare, Moon, Play, Plus, Settings, Sigma, Sun } from 'lucide-react';
import { computeOverallStatus, useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { ApiError } from '@/lib/api';
import { SaveIndicator } from './SaveIndicator';

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
    <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tracking-tight">LaTeX Studio</span>
        <select
          aria-label="Project"
          value={projectId ?? ''}
          onChange={(e) => void selectProject(e.target.value)}
          className="rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
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
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </div>

      <div className="flex items-center gap-3">
        <SaveIndicator status={overall} />
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <input
            type="checkbox"
            checked={compileOnSave}
            onChange={(e) => setCompileOnSave(e.target.checked)}
            className="h-3.5 w-3.5 accent-sky-500"
          />
          Compile on save
        </label>
        <button
          type="button"
          title="Compile (⌘↵)"
          onClick={() => void compileProject()}
          disabled={compiling}
          className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {compiling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          Compile
        </button>
        <button
          type="button"
          title="Check derivation (⌘⇧↵)"
          onClick={onCheckMath}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <Sigma className="h-3.5 w-3.5" /> Check math
        </button>
        <button
          type="button"
          onClick={onOpenSnapshots}
          className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <History className="h-3.5 w-3.5" /> Snapshots
        </button>
        <button
          type="button"
          aria-label="Toggle Claude chat"
          title="Claude chat"
          aria-pressed={chatOpen}
          data-testid="toggle-chat"
          onClick={toggleChat}
          className={`relative inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
            chatOpen
              ? 'border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'
              : 'border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" /> Claude
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
          className="rounded border border-slate-300 p-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={toggleTheme}
          className="rounded border border-slate-300 p-1.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
