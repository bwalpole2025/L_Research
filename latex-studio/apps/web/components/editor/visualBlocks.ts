/**
 * Parse LaTeX source into renderable blocks for the VISUAL view (the Code ⇄
 * Visual toggle). Deterministic, offline, tolerant — an approximation for
 * reading/navigation, never a replacement for the compiled PDF. Every block
 * carries its 1-based source line so clicking in Visual jumps back to Code.
 */

export type VisualBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string; line: number; endLine: number; cmd: string }
  | { kind: 'para'; text: string; line: number; endLine: number }
  | { kind: 'math'; latex: string; line: number; endLine: number; env: string | null }
  | { kind: 'list'; ordered: boolean; items: { text: string; line: number }[]; line: number; endLine: number }
  | { kind: 'figure'; path: string | null; caption: string; line: number; endLine: number }
  | { kind: 'tikz'; latex: string; caption: string; line: number; endLine: number }
  | { kind: 'table'; caption: string; line: number; endLine: number };

const MATH_ENVS = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'displaymath', 'cases', 'split'];
const SKIP_ENVS = ['comment', 'filecontents', 'thebibliography', 'verbatim', 'lstlisting'];

const HEADING_RE = /^\\(chapter|section|subsection|subsubsection)\*?\s*\{(.*)\}\s*$/;

function braced(s: string, cmd: string): string | null {
  const i = s.indexOf(`\\${cmd}`);
  if (i === -1) return null;
  const open = s.indexOf('{', i);
  if (open === -1) return null;
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return s.slice(open + 1, j);
    }
  }
  return null;
}

export function latexToBlocks(content: string): VisualBlock[] {
  const lines = content.split('\n');
  // Render the body only when a document env exists; otherwise the whole file.
  const beginDoc = lines.findIndex((l) => l.includes('\\begin{document}'));
  const start = beginDoc === -1 ? 0 : beginDoc + 1;

  const blocks: VisualBlock[] = [];
  let para: { text: string[]; line: number; endLine: number } | null = null;
  const flushPara = (): void => {
    if (para && para.text.join(' ').trim()) {
      blocks.push({ kind: 'para', text: para.text.join(' ').replace(/\s+/g, ' ').trim(), line: para.line, endLine: para.endLine });
    }
    para = null;
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.replace(/(?<!\\)%.*$/, ''); // strip comments
    const trimmed = line.trim();
    const lineNo = i + 1;

    if (trimmed.includes('\\end{document}')) break;
    if (!trimmed) {
      flushPara();
      continue;
    }

    // Headings.
    const h = HEADING_RE.exec(trimmed);
    if (h) {
      flushPara();
      const level = h[1] === 'chapter' ? 1 : h[1] === 'section' ? 1 : h[1] === 'subsection' ? 2 : 3;
      blocks.push({ kind: 'heading', level, text: h[2] ?? '', line: lineNo, endLine: lineNo, cmd: h[1]! });
      continue;
    }

    // Environments that open on this line.
    const env = /^\\begin\{([a-zA-Z*]+)\}/.exec(trimmed);
    if (env) {
      const name = (env[1] ?? '').replace(/\*$/, '');
      const endIdx = findEnvEnd(lines, i, env[1] ?? '');
      if (MATH_ENVS.includes(name)) {
        flushPara();
        const inner = lines.slice(i + 1, endIdx).join('\n');
        blocks.push({ kind: 'math', latex: inner, line: lineNo, endLine: endIdx + 1, env: env[1] ?? name });
        i = endIdx;
        continue;
      }
      if (name === 'itemize' || name === 'enumerate') {
        flushPara();
        const items: { text: string; line: number }[] = [];
        for (let j = i + 1; j < endIdx; j++) {
          const it = /^\s*\\item\s*(.*)$/.exec(lines[j]!);
          if (it) items.push({ text: it[1] ?? '', line: j + 1 });
          else if (items.length > 0 && lines[j]!.trim()) items[items.length - 1]!.text += ` ${lines[j]!.trim()}`;
        }
        blocks.push({ kind: 'list', ordered: name === 'enumerate', items, line: lineNo, endLine: endIdx + 1 });
        i = endIdx;
        continue;
      }
      if (name === 'tikzpicture') {
        flushPara();
        blocks.push({ kind: 'tikz', latex: lines.slice(i, endIdx + 1).join('\n'), caption: '', line: lineNo, endLine: endIdx + 1 });
        i = endIdx;
        continue;
      }
      if (name === 'figure') {
        flushPara();
        const body = lines.slice(i, endIdx + 1).join('\n');
        const caption = braced(body, 'caption') ?? '';
        // A figure wrapping a TikZ picture renders as a DIAGRAM (semi-compiled).
        const tikzStart = body.indexOf('\\begin{tikzpicture}');
        if (tikzStart !== -1) {
          const tikzEnd = body.indexOf('\\end{tikzpicture}');
          const tikz = body.slice(tikzStart, tikzEnd === -1 ? undefined : tikzEnd + '\\end{tikzpicture}'.length);
          blocks.push({ kind: 'tikz', latex: tikz, caption, line: lineNo, endLine: endIdx + 1 });
          i = endIdx;
          continue;
        }
        const include = /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)\}/.exec(body);
        blocks.push({ kind: 'figure', path: include?.[1] ?? null, caption, line: lineNo, endLine: endIdx + 1 });
        i = endIdx;
        continue;
      }
      if (name === 'table' || name === 'tabular') {
        flushPara();
        const body = lines.slice(i, endIdx + 1).join('\n');
        blocks.push({ kind: 'table', caption: braced(body, 'caption') ?? '', line: lineNo, endLine: endIdx + 1 });
        i = endIdx;
        continue;
      }
      if (SKIP_ENVS.includes(name)) {
        flushPara();
        i = endIdx;
        continue;
      }
      // Unknown environment: render its contents as normal flow (abstract, center, …).
      continue;
    }
    if (/^\\end\{[a-zA-Z*]+\}/.test(trimmed)) continue;

    // \[ … \] display maths.
    if (trimmed.startsWith('\\[')) {
      flushPara();
      let j = i;
      const buf: string[] = [];
      for (; j < lines.length; j++) {
        buf.push(lines[j]!);
        if (lines[j]!.includes('\\]')) break;
      }
      const joined = buf.join('\n');
      blocks.push({ kind: 'math', latex: joined.slice(joined.indexOf('\\[') + 2, joined.indexOf('\\]')), line: lineNo, endLine: j + 1, env: null });
      i = j;
      continue;
    }

    // Pure structural commands rendered as nothing.
    if (/^\\(maketitle|tableofcontents|newpage|clearpage|appendix|bibliographystyle|bibliography|printbibliography|centering|noindent|label|vspace|hspace|input|include|pagebreak|bigskip|medskip|smallskip)\b/.test(trimmed)) {
      continue;
    }

    // Prose: accumulate into the current paragraph.
    if (!para) para = { text: [], line: lineNo, endLine: lineNo };
    para.text.push(trimmed);
    para.endLine = lineNo;
  }
  flushPara();
  return blocks;
}

function findEnvEnd(lines: string[], startIdx: number, env: string): number {
  let depth = 0;
  for (let i = startIdx; i < lines.length; i++) {
    if (lines[i]!.includes(`\\begin{${env}}`)) depth += 1;
    if (lines[i]!.includes(`\\end{${env}}`)) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return lines.length - 1;
}
