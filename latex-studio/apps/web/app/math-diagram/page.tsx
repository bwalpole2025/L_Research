'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { RequireSession } from '@/components/RequireSession';
import { TikzDiagramEditor } from '@/components/diagram/TikzDiagramEditor';
import { Wordmark } from '@/components/Wordmark';
import { useEditorStore } from '@/lib/store';

/**
 * FULL-PAGE maths (TikZ) diagram editor — the big-canvas counterpart to the
 * freeform Excalidraw page (/diagram). Reached from the Studio's "Math
 * diagram" button or /math-diagram?project=<id>&file=<path>. Reuses the
 * editor store, so saving/exporting behaves exactly like the in-studio view —
 * the canvas just gets the whole viewport.
 */

function MathDiagramInner() {
  const params = useSearchParams();
  const bootstrap = useEditorStore((s) => s.bootstrap);
  const ready = useEditorStore((s) => s.ready);
  const projectId = useEditorStore((s) => s.projectId);
  const projects = useEditorStore((s) => s.projects);
  const files = useEditorStore((s) => s.files);
  const contents = useEditorStore((s) => s.contents);
  const [fileId, setFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Pick (or create) the diagram once the store is ready.
  useEffect(() => {
    if (!ready || fileId) return;
    void (async () => {
      const st = useEditorStore.getState();
      const wantProject = params.get('project');
      if (wantProject && st.projectId !== wantProject && st.projects.some((p) => p.id === wantProject)) {
        await st.selectProject(wantProject);
      }
      const cur = useEditorStore.getState();
      const wantFile = params.get('file');
      let target = wantFile
        ? cur.files.find((f) => f.path === wantFile)
        : cur.files.find((f) => f.path.toLowerCase().endsWith('.diagram.json'));
      if (!target) {
        const created = await cur.createFile('untitled.diagram.json');
        if (!created) {
          setError('Could not create a diagram file in this project.');
          return;
        }
        target = created;
      }
      await useEditorStore.getState().openFile(target.id);
      setFileId(target.id);
    })();
  }, [ready, fileId, params]);

  const file = files.find((f) => f.id === fileId);
  const project = projects.find((p) => p.id === projectId);

  return (
    <div className="flex h-screen flex-col bg-[var(--ls-bg)]">
      <header className="flex h-12 flex-none items-center gap-3 border-b border-[var(--ls-line)] bg-[var(--ls-editor-bg)] px-4">
        <Link
          href="/studio"
          title="Back to the Studio"
          className="flex items-center gap-1.5 rounded-[9px] px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-[#98a2bb] dark:hover:bg-[#131b30] dark:hover:text-[#eef1f8]"
        >
          <ArrowLeft className="h-4 w-4" /> Studio
        </Link>
        <div className="h-5 w-px bg-[var(--ls-line-strong)]" />
        <Wordmark size={18} />
        <span className="truncate text-sm text-[var(--ls-muted)]">
          {project?.name ?? ''} · {file?.path ?? 'loading…'}
        </span>
        <span className="ml-auto text-[11px] text-[var(--ls-muted)]">Maths diagram editor — TikZ export, labels typeset with your document</span>
      </header>
      <div className="min-h-0 flex-1">
        {error ? (
          <p className="p-6 text-sm text-red-500">{error}</p>
        ) : file && fileId ? (
          <TikzDiagramEditor fileId={fileId} path={file.path} content={contents[fileId] ?? ''} />
        ) : (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--ls-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading diagram…
          </div>
        )}
      </div>
    </div>
  );
}

export default function MathDiagramPage() {
  return (
    <RequireSession>
      <Suspense>
        <MathDiagramInner />
      </Suspense>
    </RequireSession>
  );
}
