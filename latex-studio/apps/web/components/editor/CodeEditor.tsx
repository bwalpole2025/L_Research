'use client';

import { useEffect, useRef } from 'react';
import { EditorState, EditorSelection, Compartment, type Extension } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view';
import { history, defaultKeymap, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput } from '@codemirror/language';
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { CursorState, MathLineMarker, PendingReveal, Theme } from '@/lib/types';
import { editorController } from '@/lib/editorController';
import { CompletionController } from '@/lib/completion/controller';
import { useDocumentModelStore } from '@/lib/documentModelStore';
import { latexLanguageSupport, beginEndCloser } from './latex';
import { latexFolding } from './latexFold';
import { pythonLanguageSupport } from './python';
import { latexAutocomplete } from './latexAutocomplete';
import { pythonAutocomplete } from './pythonAutocomplete';
import { mathPreview } from './mathPreview';
import { editorTheme } from './theme';
import { flashField, setFlash } from './flash';
import { mathGutter, setMathMarkers } from './mathGutter';
import { applyLintDiagnostics, diagnosticsLint } from './diagnosticsLint';
import type { Diagnostic as SharedDiagnostic } from '@latex-studio/shared';
import { inlineSuggestion } from './inlineSuggest';
import { predictBlockExtension } from './predictBlock';

export interface CodeEditorProps {
  fileId: string | null;
  /** Project-relative path of the active file (selects the editor language). */
  filePath: string | null;
  /** Content of the active file, or undefined while it is still loading. */
  content: string | undefined;
  theme: Theme;
  cursorFor: (id: string) => CursorState | undefined;
  onChange: (id: string, content: string) => void;
  onCursor: (id: string, cursor: CursorState) => void;
  onRequestSnapshot: () => void;
  onCompile: () => void;
  /** Cmd+R → run the active Python file in the sandbox. */
  onRunPython: () => void;
  /** Cmd+K on the current selection → open the inline-edit prompt. */
  onInlineEdit: () => void;
  /** A queued request to scroll to + flash a line in the active file. */
  pendingReveal: PendingReveal | null;
  onRevealHandled: () => void;
  /** Math-check gutter markers for the active file. */
  mathMarkers: { line: number; marker: MathLineMarker }[];
  /** Compile diagnostics for the ACTIVE file (three-tier markers). */
  lintDiagnostics: SharedDiagnostic[];
}

/** Scroll to a line, place the cursor there, and flash it briefly. */
function revealLine(view: EditorView, line: number): void {
  const total = view.state.doc.lines;
  const target = view.state.doc.line(Math.min(Math.max(1, line), total));
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    effects: [EditorView.scrollIntoView(target.from, { y: 'center' }), setFlash.of({ line })],
  });
  view.focus();
  window.setTimeout(() => {
    try {
      view.dispatch({ effects: setFlash.of(null) });
    } catch {
      /* view may be gone */
    }
  }, 1200);
}

export function CodeEditor(props: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef<Map<string, EditorState>>(new Map());
  const themeCompartment = useRef(new Compartment());
  const activeId = useRef<string | null>(null);
  const completion = useRef<CompletionController | null>(null);
  if (!completion.current) completion.current = new CompletionController();

  // Keep callbacks/values in refs so the EditorView is created only once.
  const cb = useRef(props);
  cb.current = props;

  const loaded = props.fileId !== null && props.content !== undefined;

  function buildState(content: string, cursor: CursorState | undefined): EditorState {
    const max = content.length;
    // Python files get plain syntax highlighting; LaTeX gets the full toolset
    // (autocomplete, math preview, AI ghost-text, \begin closer).
    const isPython = (cb.current.filePath ?? '').toLowerCase().endsWith('.py');

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      isPython ? pythonLanguageSupport() : latexLanguageSupport(),
      // AI ghost-text, the autocomplete dropdown AND the multi-line "predict
      // next" block work for both languages; each language gets its own
      // dropdown source (Python: numpy/scipy/plt/math + locals; LaTeX also gets
      // math preview and the \begin-closer).
      inlineSuggestion(completion.current!.config),
      predictBlockExtension(completion.current!.predictConfig),
      ...(isPython
        ? [pythonAutocomplete()]
        : [
            latexAutocomplete(),
            mathPreview(),
            beginEndCloser,
            latexFolding(),
          ]),
      flashField,
      mathGutter(),
      diagnosticsLint(),
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Mod-Shift- ',
          preventDefault: true,
          run: () => {
            void completion.current?.triggerPredict();
            return true;
          },
        },
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            cb.current.onRequestSnapshot();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: () => {
            cb.current.onCompile();
            return true;
          },
        },
        {
          key: 'Mod-r',
          preventDefault: true,
          run: () => {
            cb.current.onRunPython();
            return true;
          },
        },
        {
          key: 'Mod-k',
          preventDefault: true,
          run: () => {
            cb.current.onInlineEdit();
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      themeCompartment.current.of(editorTheme(cb.current.theme)),
      EditorView.updateListener.of((update) => {
        const id = activeId.current;
        if (!id) return;
        if (update.docChanged) {
          cb.current.onChange(id, update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const sel = update.state.selection.main;
          cb.current.onCursor(id, { anchor: sel.anchor, head: sel.head });
        }
      }),
    ];

    const config: { doc: string; extensions: Extension[]; selection?: EditorSelection } = {
      doc: content,
      extensions,
    };
    if (cursor) {
      config.selection = EditorSelection.single(
        Math.min(cursor.anchor, max),
        Math.min(cursor.head, max),
      );
    }
    return EditorState.create(config);
  }

  // Create the view once.
  useEffect(() => {
    if (!hostRef.current) return;
    const stateCache = states.current;
    const view = new EditorView({
      state: EditorState.create({ doc: '' }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    editorController.setView(view);
    completion.current?.setView(view);
    const controller = completion.current;
    useDocumentModelStore.getState().setPredictTrigger(() => void controller?.triggerPredict());
    void useDocumentModelStore.getState().refresh();
    return () => {
      editorController.setView(null);
      controller?.setView(null);
      controller?.scheduler.abort();
      useDocumentModelStore.getState().setPredictTrigger(null);
      view.destroy();
      viewRef.current = null;
      stateCache.clear();
    };
  }, []);

  // Swap the active document when the file changes (or its content first loads).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !props.fileId || props.content === undefined) return;

    activeId.current = props.fileId;
    let state = states.current.get(props.fileId);
    if (!state) {
      state = buildState(props.content, cb.current.cursorFor(props.fileId));
      states.current.set(props.fileId, state);
    }
    view.setState(state);
    // setState resets the theme compartment to the value captured at creation;
    // re-apply the current theme so cached states stay in sync.
    view.dispatch({
      effects: [
        themeCompartment.current.reconfigure(editorTheme(cb.current.theme)),
        setMathMarkers.of(cb.current.mathMarkers),
      ],
    });
    view.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fileId, loaded]);

  // Apply math-check gutter markers as they change.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setMathMarkers.of(props.mathMarkers) });
  }, [props.mathMarkers]);

  // Apply compile diagnostics (gutter + squiggles) on each fresh compile and
  // on file swap; an empty list clears every marker.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || props.content === undefined) return;
    applyLintDiagnostics(view, props.lintDiagnostics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lintDiagnostics, props.fileId, loaded]);

  // Live theme toggle for the visible document.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme(props.theme)),
    });
  }, [props.theme]);

  // Consume a queued reveal once its file is active and loaded (the swap effect
  // above runs first when the file changes).
  useEffect(() => {
    const view = viewRef.current;
    const reveal = props.pendingReveal;
    if (!view || !reveal || reveal.fileId !== props.fileId || props.content === undefined) return;
    revealLine(view, reveal.line);
    props.onRevealHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.pendingReveal?.nonce, props.fileId, loaded]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full overflow-hidden" data-testid="code-editor" />
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
          {props.fileId ? 'Loading…' : 'Open a file to start editing'}
        </div>
      )}
    </div>
  );
}
