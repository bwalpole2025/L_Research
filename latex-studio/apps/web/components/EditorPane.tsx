'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Code2, Eye, Shapes } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { useRunStore } from '@/lib/runStore';
import { usePythonCheckStore } from '@/lib/pythonCheckStore';
import { usePreviewStore } from '@/lib/previewStore';
import { isBinaryPath } from '@/lib/fileKind';
import { dialog } from '@/lib/dialogStore';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './editor/CodeEditor';
import { VisualView } from './editor/VisualView';
import { BinaryFilePreview } from './editor/BinaryFilePreview';
import { isDiagramPath } from '../lib/diagram/model';

/** Maths diagrams are never edited as JSON in the editor pane — they open in
 *  their own full-page editor. This card stands in when a `.diagram.json` file
 *  is the active tab (e.g. after returning from that page). */
function DiagramFileCard({ path }: { path: string }) {
  const router = useRouter();
  const projectId = useEditorStore((s) => s.projectId);
  const name = path.split('/').pop() ?? path;
  const href = `/math-diagram?project=${projectId ?? ''}&file=${encodeURIComponent(path)}`;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#4e68f5]/12 text-[#4e68f5]">
        <Shapes className="h-7 w-7" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[var(--ls-text)]">{name}</h2>
        <p className="max-w-sm text-sm text-[var(--ls-muted)]">
          Maths diagrams open in their own full-page editor — not as a JSON file in this pane.
        </p>
      </div>
      <button
        type="button"
        data-testid="open-diagram-page"
        onClick={() => router.push(href)}
        className="rounded-lg bg-[#4e68f5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#5f78f8]"
      >
        Open maths diagram editor
      </button>
    </div>
  );
}

export function EditorPane() {
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const files = useEditorStore((s) => s.files);
  const contents = useEditorStore((s) => s.contents);
  const cursors = useEditorStore((s) => s.cursors);
  const theme = useEditorStore((s) => s.theme);
  const pendingReveal = useEditorStore((s) => s.pendingReveal);
  const mathByLine = useEditorStore((s) => s.mathByLine);
  const mathFileId = useEditorStore((s) => s.mathFileId);
  const setContent = useEditorStore((s) => s.setContent);
  const setCursor = useEditorStore((s) => s.setCursor);
  const createSnapshot = useEditorStore((s) => s.createSnapshot);
  const compileProject = useEditorStore((s) => s.compileProject);
  const consumeReveal = useEditorStore((s) => s.consumeReveal);
  const openInlineEdit = useAiStore((s) => s.openInlineEdit);
  const runActive = useRunStore((s) => s.runActive);

  const cursorFor = useCallback((id: string) => cursors[id], [cursors]);

  const mathMarkers = useMemo(
    () =>
      mathFileId === activeFileId
        ? Object.entries(mathByLine).map(([line, marker]) => ({ line: Number(line), marker }))
        : [],
    [mathByLine, mathFileId, activeFileId],
  );

  // Diagnostics for the ACTIVE file (gutter + squiggle markers). LaTeX files get
  // compile diagnostics; .py files get the AI/syntax error-check results.
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const projects = useEditorStore((s) => s.projects);
  const projectIdForDiag = useEditorStore((s) => s.projectId);
  const filesForDiag = useEditorStore((s) => s.files);
  const pyByFile = usePythonCheckStore((s) => s.byFile);
  const lintDiagnostics = useMemo(() => {
    const activePath = filesForDiag.find((f) => f.id === activeFileId)?.path;
    if (!activePath) return [];
    if (activePath.toLowerCase().endsWith('.py')) {
      return (pyByFile[activePath] ?? []).filter((d) => d.line !== undefined);
    }
    const rootFile = projects.find((p) => p.id === projectIdForDiag)?.rootFile ?? 'main.tex';
    return diagnostics.filter((d) => d.line !== undefined && (d.file ?? rootFile) === activePath);
  }, [diagnostics, pyByFile, projects, projectIdForDiag, filesForDiag, activeFileId]);

  const onRequestSnapshot = useCallback(() => {
    void dialog.prompt({ title: 'Create snapshot', defaultValue: `Snapshot ${new Date().toLocaleString()}`, placeholder: 'label' }).then((label) => {
      const v = label?.trim();
      if (v) void createSnapshot(v);
    });
  }, [createSnapshot]);

  const activePath = activeFileId ? files.find((f) => f.id === activeFileId)?.path : undefined;
  const isBinary = activePath !== undefined && isBinaryPath(activePath);
  const isTex = activePath !== undefined && /\.tex$/i.test(activePath);
  const editorView = usePreviewStore((s) => s.editorView);
  const setEditorView = usePreviewStore((s) => s.setEditorView);
  const revealLocation = useEditorStore((s) => s.revealLocation);
  const showVisual = isTex && editorView === 'visual';

  const jumpToCode = useCallback(
    (line: number) => {
      setEditorView('code');
      if (activePath) void revealLocation(activePath, line);
    },
    [setEditorView, revealLocation, activePath],
  );

  return (
    <div className="flex h-full flex-col bg-[var(--ls-editor-bg)]">
      <div className="flex items-center">
        <div className="min-w-0 flex-1">
          <EditorTabs />
        </div>
        {isTex && (
          <div className="mr-2 flex shrink-0 overflow-hidden rounded-md border border-zinc-200 text-xs dark:border-zinc-700" role="group" aria-label="Editor view">
            <button
              type="button"
              data-testid="view-code"
              onClick={() => setEditorView('code')}
              aria-pressed={editorView === 'code'}
              className={`inline-flex items-center gap-1 px-2 py-1 font-medium transition-colors ${
                editorView === 'code' ? 'bg-blue-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300'
              }`}
            >
              <Code2 className="h-3 w-3" /> Code
            </button>
            <button
              type="button"
              data-testid="view-visual"
              onClick={() => setEditorView('visual')}
              aria-pressed={editorView === 'visual'}
              className={`inline-flex items-center gap-1 px-2 py-1 font-medium transition-colors ${
                editorView === 'visual' ? 'bg-blue-600 text-white' : 'bg-white text-zinc-600 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300'
              }`}
            >
              <Eye className="h-3 w-3" /> Visual
            </button>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {activePath && isDiagramPath(activePath) ? (
          <DiagramFileCard path={activePath} />
        ) : isBinary && activePath ? (
          <BinaryFilePreview path={activePath} base64={activeFileId ? contents[activeFileId] : undefined} />
        ) : showVisual && activeFileId ? (
          <VisualView content={contents[activeFileId] ?? ''} onJump={jumpToCode} />
        ) : (
          <CodeEditor
            fileId={activeFileId}
            filePath={activePath ?? null}
            content={activeFileId ? contents[activeFileId] : undefined}
            theme={theme}
            cursorFor={cursorFor}
            pendingReveal={pendingReveal}
            onChange={setContent}
            onCursor={setCursor}
            onRequestSnapshot={onRequestSnapshot}
            onCompile={() => void compileProject()}
            onRunPython={runActive}
            onInlineEdit={openInlineEdit}
            onRevealHandled={consumeReveal}
            mathMarkers={mathMarkers}
            lintDiagnostics={lintDiagnostics}
          />
        )}
      </div>
    </div>
  );
}
