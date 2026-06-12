'use client';

import { useCallback, useMemo } from 'react';
import { Code2, Eye } from 'lucide-react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { usePreviewStore } from '@/lib/previewStore';
import { isBinaryPath } from '@/lib/fileKind';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './editor/CodeEditor';
import { VisualView } from './editor/VisualView';
import { BinaryFilePreview } from './editor/BinaryFilePreview';

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

  const cursorFor = useCallback((id: string) => cursors[id], [cursors]);

  const mathMarkers = useMemo(
    () =>
      mathFileId === activeFileId
        ? Object.entries(mathByLine).map(([line, marker]) => ({ line: Number(line), marker }))
        : [],
    [mathByLine, mathFileId, activeFileId],
  );

  // Compile diagnostics for the ACTIVE file (gutter + squiggle markers).
  const diagnostics = useEditorStore((s) => s.diagnostics);
  const projects = useEditorStore((s) => s.projects);
  const projectIdForDiag = useEditorStore((s) => s.projectId);
  const filesForDiag = useEditorStore((s) => s.files);
  const lintDiagnostics = useMemo(() => {
    const rootFile = projects.find((p) => p.id === projectIdForDiag)?.rootFile ?? 'main.tex';
    const activePath = filesForDiag.find((f) => f.id === activeFileId)?.path;
    if (!activePath) return [];
    return diagnostics.filter((d) => d.line !== undefined && (d.file ?? rootFile) === activePath);
  }, [diagnostics, projects, projectIdForDiag, filesForDiag, activeFileId]);

  const onRequestSnapshot = useCallback(() => {
    const label = window.prompt('Snapshot label', `Snapshot ${new Date().toLocaleString()}`);
    if (label && label.trim()) {
      void createSnapshot(label.trim());
    }
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
        {isBinary && activePath ? (
          <BinaryFilePreview path={activePath} base64={activeFileId ? contents[activeFileId] : undefined} />
        ) : showVisual && activeFileId ? (
          <VisualView content={contents[activeFileId] ?? ''} onJump={jumpToCode} />
        ) : (
          <CodeEditor
            fileId={activeFileId}
            content={activeFileId ? contents[activeFileId] : undefined}
            theme={theme}
            cursorFor={cursorFor}
            pendingReveal={pendingReveal}
            onChange={setContent}
            onCursor={setCursor}
            onRequestSnapshot={onRequestSnapshot}
            onCompile={() => void compileProject()}
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
