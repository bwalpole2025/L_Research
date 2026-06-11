'use client';

import { useCallback, useMemo } from 'react';
import { useEditorStore } from '@/lib/store';
import { useAiStore } from '@/lib/aiStore';
import { EditorTabs } from './EditorTabs';
import { CodeEditor } from './editor/CodeEditor';

export function EditorPane() {
  const activeFileId = useEditorStore((s) => s.activeFileId);
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

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      <EditorTabs />
      <div className="min-h-0 flex-1">
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
      </div>
    </div>
  );
}
