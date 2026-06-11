import type { Diagnostic } from '@latex-studio/shared';

/**
 * Parse a pdflatex/latexmk `.log` (compiled with `-file-line-error`) into
 * structured diagnostics.
 *
 * Handles:
 *  - errors in `file:line: message` form (the reliable, clickable case),
 *  - bare `! message` TeX errors (line recovered from a following `l.N`),
 *  - LaTeX / Package / Class warnings, including multi-line ones and
 *    undefined reference/citation warnings,
 *  - over/underfull \hbox/\vbox messages, collapsed into ONE info diagnostic.
 *
 * Warning file attribution is best-effort via the log's `(file … )` nesting;
 * errors carry their own file:line and don't depend on it.
 */

const TEX_EXT = /\.(?:tex|sty|cls|ltx|def|dtx|bib|aux|bbl|toc|lof|lot|clo|cfg|fd|enc)$/i;

const FILE_LINE_ERROR =
  /^((?:\.\/)?[^:\r\n]+?\.(?:tex|sty|cls|ltx|def|dtx|bib|aux|bbl)):(\d+):\s?(.*)$/;

const WARNING_START = /^(?:(LaTeX(?: Font)?)|Package (\S+)|Class (\S+)) Warning: (.*)$/;

const CONTINUATION = /^\([^)\s]*\)\s/;

const BOX_WARNING = /^(?:Overfull|Underfull) \\[hv]box/;

export function parseLatexLog(log: string): Diagnostic[] {
  const lines = log.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileStack: string[] = [];
  let boxCount = 0;

  const currentFile = (): string | undefined => {
    for (let i = fileStack.length - 1; i >= 0; i--) {
      const f = fileStack[i];
      if (f) return normalizeFile(f);
    }
    return undefined;
  };

  const push = (d: Diagnostic): void => {
    const key = `${d.severity}|${d.file ?? ''}|${d.line ?? ''}|${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    diagnostics.push(d);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // 1. file:line: message (from -file-line-error) — the clickable error path.
    const fle = FILE_LINE_ERROR.exec(line);
    if (fle) {
      push({
        severity: 'error',
        file: normalizeFile(fle[1] ?? ''),
        line: Number(fle[2]),
        message: cleanMessage(fle[3] ?? ''),
      });
      applyParens(line, fileStack);
      continue;
    }

    // 2. Over/underfull boxes → collapsed into one info diagnostic at the end.
    if (BOX_WARNING.test(line)) {
      boxCount++;
      applyParens(line, fileStack);
      continue;
    }

    // 3. LaTeX / Package / Class warnings (possibly spanning a few lines).
    const warn = WARNING_START.exec(line);
    if (warn) {
      const pkg = warn[2] ?? warn[3];
      let text = warn[4] ?? '';
      let j = i + 1;
      while (j < lines.length && j - i < 6 && CONTINUATION.test(lines[j] ?? '')) {
        text += ' ' + (lines[j] ?? '').replace(/^\([^)]*\)\s*/, '').trim();
        j++;
      }
      const lineMatch = /on input line (\d+)/.exec(text);
      const body = stripInputLine(text);
      const d: Diagnostic = {
        severity: 'warning',
        message: pkg ? `[${pkg}] ${body}` : body,
      };
      const cf = currentFile();
      if (cf) d.file = cf;
      if (lineMatch) d.line = Number(lineMatch[1]);
      push(d);
      for (let k = i; k < j; k++) applyParens(lines[k] ?? '', fileStack);
      i = j - 1;
      continue;
    }

    // 4. Bare `! message` TeX errors without file:line (rare with file-line-error).
    const bang = /^! (.+)$/.exec(line);
    if (bang && !/^! (?:==> Fatal error|Emergency stop)/.test(line)) {
      let ln: number | undefined;
      for (let k = i + 1; k < Math.min(i + 8, lines.length); k++) {
        const lm = /^l\.(\d+)/.exec(lines[k] ?? '');
        if (lm) {
          ln = Number(lm[1]);
          break;
        }
      }
      const d: Diagnostic = { severity: 'error', message: cleanMessage(bang[1] ?? '') };
      const cf = currentFile();
      if (cf) d.file = cf;
      if (ln !== undefined) d.line = ln;
      push(d);
      applyParens(line, fileStack);
      continue;
    }

    applyParens(line, fileStack);
  }

  if (boxCount > 0) {
    diagnostics.push({
      severity: 'info',
      message: `${boxCount} over/underfull box warning${boxCount === 1 ? '' : 's'}`,
    });
  }

  return diagnostics;
}

/** Update the `(file … )` nesting stack from one log line. */
function applyParens(line: string, stack: string[]): void {
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') {
      const rest = line.slice(i + 1);
      const m = /^([^\s()]*)/.exec(rest);
      const tok = m?.[1] ?? '';
      stack.push(TEX_EXT.test(tok) || tok.startsWith('./') || tok.startsWith('/') ? tok : '');
    } else if (c === ')') {
      if (stack.length > 0) stack.pop();
    }
  }
  if (stack.length > 256) stack.length = 256;
}

function normalizeFile(file: string): string {
  return file.replace(/^\.\//, '').trim();
}

function cleanMessage(msg: string): string {
  return msg.replace(/\s+/g, ' ').trim();
}

function stripInputLine(text: string): string {
  return text
    .replace(/\s*on input line \d+\.?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
