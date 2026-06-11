'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { Toolbar } from './Toolbar';
import { FileTree } from './FileTree';
import { EditorPane } from './EditorPane';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { PdfViewer } from './PdfViewer';
import { SnapshotsDialog } from './SnapshotsDialog';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { MathResultsDialog } from './MathResultsDialog';
import { ChatSidebar } from './ai/ChatSidebar';
import { AiBanner } from './ai/AiBanner';
import { InlineEditPrompt } from './ai/InlineEditPrompt';
import { DiffReviewDialog } from './ai/DiffReviewDialog';
import { CompletionStatusBar } from './ai/CompletionStatusBar';

function CreateFirstProject() {
  const createProject = useEditorStore((s) => s.createProject);
  const [name, setName] = useState('My Paper');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createProject(name.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 p-6 dark:border-slate-800">
        <h1 className="text-lg font-semibold">Create your first project</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          It will start with a minimal, compilable <code>main.tex</code>.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          aria-label="Project name"
          className="mt-4 w-full rounded border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
          placeholder="Project name"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-3 w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          Create project
        </button>
      </div>
    </div>
  );
}

export function EditorApp() {
  const ready = useEditorStore((s) => s.ready);
  const error = useEditorStore((s) => s.error);
  const projects = useEditorStore((s) => s.projects);
  const bootstrap = useEditorStore((s) => s.bootstrap);
  const compileProject = useEditorStore((s) => s.compileProject);
  const checkDerivation = useEditorStore((s) => s.checkDerivation);
  const chatOpen = useAiStore((s) => s.chatOpen);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const runCheckMath = () => {
    setMathOpen(true);
    void checkDerivation();
  };

  // Global shortcuts (skipped when the editor already handled the key):
  //   ⌘/Ctrl+Enter        → compile
  //   ⌘/Ctrl+Shift+Enter  → check derivation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'Enter' || e.defaultPrevented) return;
      e.preventDefault();
      if (e.shiftKey) {
        setMathOpen(true);
        void checkDerivation();
      } else {
        void compileProject();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compileProject, checkDerivation]);

  if (!ready) {
    return (
      <div className="ls-app items-center justify-center text-sm text-slate-400">Loading…</div>
    );
  }

  return (
    <div className="ls-app">
      <Toolbar
        onOpenSnapshots={() => setSnapshotsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onCheckMath={runCheckMath}
      />

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <AiBanner />

      {projects.length === 0 ? (
        <CreateFirstProject />
      ) : (
        <div className="flex min-h-0 flex-1">
          <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1" autoSaveId="latex-studio:panels">
            <Panel defaultSize={18} minSize={12} className="border-r border-slate-200 dark:border-slate-800">
              <FileTree />
            </Panel>
            <PanelResizeHandle className="w-1 bg-slate-200 transition-colors hover:bg-sky-400 dark:bg-slate-800" />

            <Panel defaultSize={48} minSize={25}>
              <PanelGroup direction="vertical" autoSaveId="latex-studio:editor-panels">
                <Panel defaultSize={72} minSize={30}>
                  <EditorPane />
                </Panel>
                <PanelResizeHandle className="h-1 bg-slate-200 transition-colors hover:bg-sky-400 dark:bg-slate-800" />
                <Panel defaultSize={28} minSize={10} collapsible className="border-t border-slate-200 dark:border-slate-800">
                  <DiagnosticsPanel />
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle className="w-1 bg-slate-200 transition-colors hover:bg-sky-400 dark:bg-slate-800" />
            <Panel defaultSize={34} minSize={18} className="border-l border-slate-200 dark:border-slate-800">
              <PdfViewer />
            </Panel>
          </PanelGroup>

          {chatOpen && (
            <aside className="w-96 shrink-0 border-l border-slate-200 dark:border-slate-800">
              <ChatSidebar />
            </aside>
          )}
        </div>
      )}

      {projects.length > 0 && <CompletionStatusBar />}

      <SnapshotsDialog open={snapshotsOpen} onClose={() => setSnapshotsOpen(false)} />
      <ProjectSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <MathResultsDialog open={mathOpen} onClose={() => setMathOpen(false)} />
      <InlineEditPrompt />
      <DiffReviewDialog />
    </div>
  );
}
