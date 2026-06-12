import { python } from '@codemirror/lang-python';
import type { LanguageSupport } from '@codemirror/language';

/** CodeMirror Python language support (syntax highlighting + indentation). */
export function pythonLanguageSupport(): LanguageSupport {
  return python();
}
