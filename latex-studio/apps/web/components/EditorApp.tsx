'use client';

import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { useThesisStore } from '@/lib/thesisStore';
import { useCoderiveStore } from '@/lib/coderiveStore';
import { Toolbar } from './Toolbar';
import { EditorPane } from './EditorPane';
import { PdfViewer } from './PdfViewer';
import { SnapshotsDialog } from './SnapshotsDialog';
import { ProjectSettingsDialog } from './ProjectSettingsDialog';
import { MathResultsDialog } from './MathResultsDialog';
import { ChatSidebar } from './ai/ChatSidebar';
import { AiBanner } from './ai/AiBanner';
import { InlineEditPrompt } from './ai/InlineEditPrompt';
import { DiffReviewDialog } from './ai/DiffReviewDialog';
import { CompletionStatusBar } from './ai/CompletionStatusBar';
import { LeftRail } from './thesis/LeftRail';
import { BottomPanelTabs } from './thesis/BottomPanelTabs';
import { PreSubmitDialog } from './thesis/PreSubmitDialog';
import { CoderiveDialog } from './coderive/CoderiveDialog';
import { UploadConfirmDialog, TrashDialog } from './library/LibraryDialogs';
import { KeyboardReference } from './KeyboardReference';

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
    <div className="flex h-full flex-1 items-center justify-center bg-[var(--ls-bg)] p-8">
      <div className="w-full max-w-sm rounded-md border border-zinc-200 bg-[var(--ls-surface-raised)] p-6 shadow-[var(--ls-shadow-soft)] dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Create your first project</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          It will start with a minimal, compilable <code>main.tex</code>.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          aria-label="Project name"
          className="mt-4 h-10 w-full rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
          placeholder="Project name"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-3 h-10 w-full rounded-md bg-blue-600 px-3 text-sm font-medium text-white shadow-[0_8px_18px_rgba(37,99,235,0.2)] transition-colors hover:bg-blue-500 disabled:opacity-50"
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
  const runAudit = useThesisStore((s) => s.runAudit);
  const runProse = useThesisStore((s) => s.runProse);
  const openPreSubmit = useThesisStore((s) => s.openPreSubmit);
  const setLeftTab = useThesisStore((s) => s.setLeftTab);
  const openCoderive = useCoderiveStore((s) => s.openDialog);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mathOpen, setMathOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const runCheckMath = () => {
    setMathOpen(true);
    void checkDerivation();
  };

  // Global shortcuts (skipped when the editor already handled the key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          setMathOpen(true);
          void checkDerivation();
        } else void compileProject();
      } else if (key === '/') {
        e.preventDefault();
        setKeyboardOpen((v) => !v);
      } else if (e.shiftKey && key === 'a') {
        e.preventDefault();
        void runAudit('file');
      } else if (e.shiftKey && key === 'l') {
        e.preventDefault();
        void runProse('file');
      } else if (e.shiftKey && key === 's') {
        e.preventDefault();
        openPreSubmit();
      } else if (e.shiftKey && key === 'o') {
        e.preventDefault();
        setLeftTab(useThesisStore.getState().leftTab === 'outline' ? 'files' : 'outline');
      } else if (e.shiftKey && key === 'd') {
        e.preventDefault();
        openCoderive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compileProject, checkDerivation, runAudit, runProse, openPreSubmit, setLeftTab, openCoderive]);

  if (!ready) {
    return (
      <div className="ls-app items-center justify-center text-sm font-medium text-zinc-500 dark:text-zinc-400">
        Loading…
      </div>
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
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <AiBanner />

      {projects.length === 0 ? (
        <CreateFirstProject />
      ) : (
        <div className="flex min-h-0 flex-1 bg-[var(--ls-bg)] p-2">
          <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1" autoSaveId="latex-studio:panels">
            <Panel
              defaultSize={18}
              minSize={12}
              className="overflow-hidden rounded-md border border-zinc-200 bg-[var(--ls-surface)] shadow-[var(--ls-shadow-soft)] dark:border-zinc-800"
            >
              <LeftRail />
            </Panel>
            <PanelResizeHandle className="w-2 bg-transparent transition-colors hover:bg-blue-400/20" />

            <Panel
              defaultSize={48}
              minSize={25}
              className="overflow-hidden rounded-md border border-zinc-200 bg-[var(--ls-surface)] shadow-[var(--ls-shadow-soft)] dark:border-zinc-800"
            >
              <PanelGroup direction="vertical" autoSaveId="latex-studio:editor-panels">
                <Panel defaultSize={68} minSize={25}>
                  <EditorPane />
                </Panel>
                <PanelResizeHandle className="h-2 bg-[var(--ls-bg)] transition-colors hover:bg-blue-400/20" />
                <Panel defaultSize={32} minSize={12} collapsible className="border-t border-zinc-200 dark:border-zinc-800">
                  <BottomPanelTabs />
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle className="w-2 bg-transparent transition-colors hover:bg-blue-400/20" />
            <Panel
              defaultSize={34}
              minSize={18}
              className="overflow-hidden rounded-md border border-zinc-200 bg-[var(--ls-surface)] shadow-[var(--ls-shadow-soft)] dark:border-zinc-800"
            >
              <PdfViewer />
            </Panel>
          </PanelGroup>

          {chatOpen && (
            <aside className="ml-2 w-96 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-[var(--ls-surface)] shadow-[var(--ls-shadow-soft)] dark:border-zinc-800">
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
      <PreSubmitDialog />
      <CoderiveDialog />
      <UploadConfirmDialog />
      <TrashDialog />
      <KeyboardReference open={keyboardOpen} onClose={() => setKeyboardOpen(false)} />
    </div>
  );
}
