import type { Diagnostic } from '@latex-studio/shared';
import { classifyBox, classifyError, classifyWarning } from './severityTable.js';

/**
 * Parse a pdflatex/latexmk `.log` (compiled with `-file-line-error`) into
 * structured diagnostics, classified into the Overleaf-style tiers defined in
 * severityTable.ts (the documented mapping — ALL classification goes through
 * that table; nothing here hard-codes a severity except the `!`-is-red rule).
 *
 * Handles:
 *  - errors in `file:line: message` form (the reliable, clickable case),
 *  - bare `! message` TeX errors (line recovered from a following `l.N`,
 *    multi-line context captured as rawExcerpt),
 *  - LaTeX / Package / Class warnings, including multi-line ones; reference,
 *    citation, label and rerun warnings land in the ORANGE tier with
 *    `rerunHint` where a recompile would resolve them,
 *  - over/underfull \hbox/\vbox messages, GROUPED per (kind, tier, file) with
 *    a count and the worst measured overflow; overfull beyond the documented
 *    threshold is orange, the rest yellow,
 *  - de-duplication of repeated identical entries.
 *
 * Warning file attribution is best-effort via the log's `(file … )` nesting;
 * errors carry their own file:line and don't depend on it.
 */

const TEX_EXT = /\.(?:tex|sty|cls|ltx|def|dtx|bib|aux|bbl|toc|lof|lot|clo|cfg|fd|enc)$/i;

const FILE_LINE_ERROR =
  /^((?:\.\/)?[^:\r\n]+?\.(?:tex|sty|cls|ltx|def|dtx|bib|aux|bbl)):(\d+):\s?(.*)$/;

const WARNING_START = /^(?:(LaTeX(?: Font)?)|Package (\S+)|Class (\S+)) Warning: (.*)$/;

const CONTINUATION = /^\([^)\s]*\)\s/;

const BOX_WARNING = /^(Overfull|Underfull) \\([hv])box \(([^)]*)\)/;

interface BoxGroup {
  kind: 'overfull' | 'underfull';
  severity: Diagnostic['severity'];
  category: string;
  file: string | undefined;
  count: number;
  worstPt: number | null;
  firstLine: number | undefined;
  firstRaw: string;
}

export function parseLatexLog(log: string): Diagnostic[] {
  const lines = log.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileStack: string[] = [];
  const boxGroups = new Map<string, BoxGroup>();

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

  /** Error context: capture up to the `l.NNN …` line for the excerpt. */
  const errorBlock = (start: number): { excerpt: string; line?: number } => {
    const block: string[] = [lines[start] ?? ''];
    let ln: number | undefined;
    for (let k = start + 1; k < Math.min(start + 8, lines.length); k++) {
      const raw = lines[k] ?? '';
      block.push(raw);
      const lm = /^l\.(\d+)/.exec(raw);
      if (lm) {
        ln = Number(lm[1]);
        break;
      }
    }
    const out: { excerpt: string; line?: number } = { excerpt: block.join('\n').trim() };
    if (ln !== undefined) out.line = ln;
    return out;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // 1. file:line: message (from -file-line-error) — the clickable error path.
    const fle = FILE_LINE_ERROR.exec(line);
    if (fle) {
      const message = cleanMessage(fle[3] ?? '');
      const rule = classifyError(message);
      const block = errorBlock(i);
      push({
        severity: 'error',
        category: rule.category,
        file: normalizeFile(fle[1] ?? ''),
        line: Number(fle[2]),
        message,
        rawExcerpt: block.excerpt,
      });
      applyParens(line, fileStack);
      continue;
    }

    // 2. Over/underfull boxes → grouped per (kind, tier, file) with counts.
    const box = BOX_WARNING.exec(line);
    if (box) {
      const kind = (box[1] ?? '').toLowerCase() as 'overfull' | 'underfull';
      const detail = box[3] ?? '';
      const ptMatch = /([\d.]+)pt too (?:wide|high)/.exec(detail);
      const pt = ptMatch ? Number(ptMatch[1]) : null;
      const lineMatch = /at lines? (\d+)/.exec(line);
      const cls = classifyBox(kind, pt);
      const file = currentFile();
      const key = `${cls.category}|${file ?? ''}`;
      const g = boxGroups.get(key);
      if (g) {
        g.count += 1;
        if (pt !== null && (g.worstPt === null || pt > g.worstPt)) g.worstPt = pt;
      } else {
        boxGroups.set(key, {
          kind,
          severity: cls.severity,
          category: cls.category,
          file,
          count: 1,
          worstPt: pt,
          firstLine: lineMatch ? Number(lineMatch[1]) : undefined,
          firstRaw: line,
        });
      }
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
      const rule = classifyWarning(body);
      const d: Diagnostic = {
        severity: rule.severity,
        category: rule.category,
        message: pkg ? `[${pkg}] ${body}` : body,
        rawExcerpt: lines.slice(i, j).join('\n').trim(),
      };
      if (rule.rerunHint) d.rerunHint = true;
      const cf = currentFile();
      if (cf) d.file = cf;
      if (lineMatch) d.line = Number(lineMatch[1]);
      push(d);
      for (let k = i; k < j; k++) applyParens(lines[k] ?? '', fileStack);
      i = j - 1;
      continue;
    }

    // 4. Bare `! message` TeX errors without file:line. A `!` is ALWAYS red.
    const bang = /^! (.+)$/.exec(line);
    if (bang && !/^! (?:==> Fatal error|Emergency stop)/.test(line)) {
      const message = cleanMessage(bang[1] ?? '');
      const rule = classifyError(message);
      const block = errorBlock(i);
      const d: Diagnostic = { severity: 'error', category: rule.category, message, rawExcerpt: block.excerpt };
      const cf = currentFile();
      if (cf) d.file = cf;
      if (block.line !== undefined) d.line = block.line;
      push(d);
      applyParens(line, fileStack);
      continue;
    }

    applyParens(line, fileStack);
  }

  // Grouped box entries, after everything else of their tier.
  for (const g of boxGroups.values()) {
    const what = g.kind === 'overfull' ? 'Overfull' : 'Underfull';
    const worst = g.kind === 'overfull' && g.worstPt !== null ? ` (worst ${g.worstPt}pt too wide)` : '';
    const d: Diagnostic = {
      severity: g.severity,
      category: g.category,
      message: `${what} box${g.count > 1 ? 'es' : ''}${worst} — ${g.count} occurrence${g.count === 1 ? '' : 's'}`,
      rawExcerpt: g.firstRaw,
      count: g.count,
    };
    if (g.file) d.file = g.file;
    if (g.firstLine !== undefined) d.line = g.firstLine;
    push(d);
  }

  // Errors first, then orange, yellow, grey — stable within each tier.
  const order: Record<Diagnostic['severity'], number> = { error: 0, 'warning-important': 1, 'warning-minor': 2, info: 3 };
  return diagnostics
    .map((d, idx) => ({ d, idx }))
    .sort((a, b) => order[a.d.severity] - order[b.d.severity] || a.idx - b.idx)
    .map((x) => x.d);
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
