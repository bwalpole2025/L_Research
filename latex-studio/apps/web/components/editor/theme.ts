import { EditorView } from '@codemirror/view';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import type { Theme } from '@/lib/types';

/** Shared with the autocomplete tooltip so completions align with the text. */
export const EDITOR_FONT_FAMILY =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const EDITOR_FONT_SIZE = '13.5px';

/** Editor font + sizing, applied last so it wins over theme presets. */
const fontTheme = EditorView.theme({
  '&': { height: '100%', fontSize: EDITOR_FONT_SIZE },
  '.cm-scroller': {
    fontFamily: EDITOR_FONT_FAMILY,
    lineHeight: '1.65',
  },
  '.cm-content': { padding: '12px 0' },
  '.cm-line': { padding: '0 18px' },
  '.cm-gutters': { borderRight: '1px solid rgba(113, 113, 122, 0.14)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px' },
});

const lightTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#fffdf8', color: '#18181b' },
    '.cm-gutters': { backgroundColor: '#fbfaf7', color: '#a1a1aa' },
    '.cm-activeLineGutter': { backgroundColor: '#f1f5f9', color: '#52525b' },
    '.cm-activeLine': { backgroundColor: 'rgba(37, 99, 235, 0.055)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(37, 99, 235, 0.18)',
    },
    '.cm-cursor': { borderLeftColor: '#2563eb' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(16, 185, 129, 0.12)', outline: '1px solid rgba(16, 185, 129, 0.35)' },
  },
  { dark: false },
);

const darkTheme = EditorView.theme(
  {
    '&': { backgroundColor: '#101012', color: '#e4e4e7' },
    '.cm-gutters': { backgroundColor: '#111113', color: '#71717a' },
    '.cm-activeLineGutter': { backgroundColor: '#1f2937', color: '#d4d4d8' },
    '.cm-activeLine': { backgroundColor: 'rgba(96, 165, 250, 0.08)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgba(96, 165, 250, 0.24)',
    },
    '.cm-cursor': { borderLeftColor: '#60a5fa' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(52, 211, 153, 0.12)', outline: '1px solid rgba(52, 211, 153, 0.32)' },
  },
  { dark: true },
);

/** Theme + syntax highlighting for the editor. */
export function editorTheme(theme: Theme): Extension {
  return theme === 'dark'
    ? [oneDark, darkTheme, fontTheme]
    : [lightTheme, syntaxHighlighting(defaultHighlightStyle), fontTheme];
}
