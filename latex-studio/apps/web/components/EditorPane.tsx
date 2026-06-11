'use client';

import { useCallback, useMemo } from 'react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { isBinaryPath } from '@/lib/fileKind';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './editor/CodeEditor';
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

  const onRequestSnapshot = useCallback(() => {
    const label = window.prompt('Snapshot label', `Snapshot ${new Date().toLocaleString()}`);
    if (label && label.trim()) {
      void createSnapshot(label.trim());
    }
  }, [createSnapshot]);

  const activePath = activeFileId ? files.find((f) => f.id === activeFileId)?.path : undefined;
  const isBinary = activePath !== undefined && isBinaryPath(activePath);

  return (
    <div className="flex h-full flex-col bg-[var(--ls-editor-bg)]">
      <EditorTabs />
      <div className="min-h-0 flex-1">
        {isBinary && activePath ? (
          <BinaryFilePreview path={activePath} base64={activeFileId ? contents[activeFileId] : undefined} />
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
          />
        )}
      </div>
    </div>
  );
}
