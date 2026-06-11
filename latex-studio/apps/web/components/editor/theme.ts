import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import type { Theme } from '@/lib/types';

/** Editor font + sizing, applied last so it wins over theme presets. */
const fontTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-scroller': {
    fontFamily:
      '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-gutters': { borderRight: 'none' },
});

const lightTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#ffffff', color: '#0f172a' },
    '.cm-gutters': { backgroundColor: '#f8fafc', color: '#94a3b8' },
    '.cm-activeLineGutter': { backgroundColor: '#eef2f7' },
    '.cm-activeLine': { backgroundColor: 'rgba(241, 245, 249, 0.5)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(203, 213, 225, 0.6)',
    },
    '.cm-cursor': { borderLeftColor: '#0f172a' },
  },
  { dark: false },
);

/** Theme + syntax highlighting for the editor. */
export function editorTheme(theme: Theme): Extension {
  return theme === 'dark'
    ? [oneDark, fontTheme]
    : [lightTheme, syntaxHighlighting(defaultHighlightStyle), fontTheme];
}
