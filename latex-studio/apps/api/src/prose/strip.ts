export interface ProseMap {
  /** Plain prose with LaTeX commands, math, comments, etc. removed. */
  prose: string;
  /** map[i] = original offset of prose character i. */
  map: number[];
  /** The original source (for line/column computation). */
  source: string;
}

const MATH_ENVS = new Set([
  'math', 'displaymath', 'equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign', 'alignat',
  'aligned', 'gathered', 'split', 'dmath', 'array', 'cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix',
  'smallmatrix', 'IEEEeqnarray',
]);
const VERBATIM_ENVS = new Set(['verbatim', 'lstlisting', 'minted', 'Verbatim', 'alltt', 'comment']);
const SKIP_ARG = new Set([
  'label', 'ref', 'eqref', 'pageref', 'cref', 'Cref', 'autoref', 'vref', 'nameref',
  'cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'citealp', 'parencite', 'textcite', 'Citep', 'Citet',
  'input', 'include', 'usepackage', 'documentclass', 'bibliography', 'bibliographystyle', 'addbibresource',
  'includegraphics', 'url', 'RequirePackage', 'newcommand', 'renewcommand', 'newenvironment',
  'DeclareMathOperator', 'setlength', 'hypersetup', 'pagestyle', 'thispagestyle', 'def', 'ref*',
]);

function matchGroup(s: string, open: number, openCh: string, closeCh: string, limit: number): number {
  let depth = 0;
  for (let i = open; i < limit; i++) {
    if (s[i] === openCh) depth += 1;
    else if (s[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return limit;
}

/**
 * Reduce LaTeX to plain prose with a source map. Skips the preamble, comments,
 * inline/display math, math & verbatim environments, command names, and the
 * arguments of reference/citation/structural commands — while keeping the text
 * arguments of formatting commands (\textbf{...}, \section{...}, captions).
 */
export function stripLatex(source: string): ProseMap {
  const prose: string[] = [];
  const map: number[] = [];

  const emit = (ch: string, idx: number): void => {
    prose.push(ch);
    map.push(idx);
  };
  const gap = (idx: number): void => {
    const last = prose[prose.length - 1];
    if (prose.length > 0 && last !== undefined && !/\s/.test(last)) {
      prose.push(' ');
      map.push(idx);
    }
  };

  const n = source.length;
  let i = 0;
  const docStart = source.indexOf('\\begin{document}');
  if (docStart !== -1) i = docStart + '\\begin{document}'.length;
  const docEnd = source.indexOf('\\end{document}');
  const limit = docEnd !== -1 ? docEnd : n;

  while (i < limit) {
    const c = source[i]!;

    // Line comment.
    if (c === '%' && source[i - 1] !== '\\') {
      gap(i);
      while (i < limit && source[i] !== '\n') i += 1;
      continue;
    }

    // Inline / display math via $ … $ or $$ … $$.
    if (c === '$') {
      const dbl = source[i + 1] === '$';
      gap(i);
      i += dbl ? 2 : 1;
      while (i < limit) {
        if (source[i] === '$' && source[i - 1] !== '\\') {
          i += dbl ? 2 : 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (c === '\\') {
      const next = source[i + 1];
      if (next === '[') {
        gap(i);
        const end = source.indexOf('\\]', i + 2);
        i = end === -1 ? limit : end + 2;
        continue;
      }
      if (next === '(') {
        gap(i);
        const end = source.indexOf('\\)', i + 2);
        i = end === -1 ? limit : end + 2;
        continue;
      }

      const word = /^[a-zA-Z]+/.exec(source.slice(i + 1, i + 40));
      if (word) {
        const cmd = word[0];
        const j = i + 1 + cmd.length;

        if (cmd === 'begin' || cmd === 'end') {
          const env = /^\s*\{([a-zA-Z*]+)\}/.exec(source.slice(j));
          if (env) {
            const name = (env[1] ?? '').replace(/\*$/, '');
            if (cmd === 'begin' && (MATH_ENVS.has(name) || VERBATIM_ENVS.has(name))) {
              gap(i);
              const endTok = `\\end{${env[1]}}`;
              const endIdx = source.indexOf(endTok, j);
              i = endIdx === -1 ? limit : endIdx + endTok.length;
              continue;
            }
            gap(i);
            i = j + env[0].length; // skip the \begin{env} / \end{env} token; process body as prose
            continue;
          }
        }

        if (cmd === 'verb' || cmd === 'lstinline') {
          let k = j;
          if (source[k] === '*') k += 1;
          const delim = source[k];
          gap(i);
          k += 1;
          while (k < limit && source[k] !== delim) k += 1;
          i = k + 1;
          continue;
        }

        gap(i);
        i = j;
        if (SKIP_ARG.has(cmd)) {
          while (source[i] === '*' || source[i] === ' ') i += 1;
          while (source[i] === '[') i = matchGroup(source, i, '[', ']', limit);
          while (source[i] === ' ') i += 1;
          if (source[i] === '{') i = matchGroup(source, i, '{', '}', limit);
        }
        continue;
      }

      // Control symbol (\%, \&, \\, \, …): skip both chars.
      gap(i);
      i += 2;
      continue;
    }

    // Braces are transparent — their content is prose.
    if (c === '{' || c === '}') {
      i += 1;
      continue;
    }

    emit(c, i);
    i += 1;
  }

  return { prose: prose.join(''), map, source };
}

/** Map a prose offset back to a 1-based {line, column} in the source. */
export function proseOffsetToPosition(pm: ProseMap, proseOffset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(pm.map.length - 1, proseOffset));
  const orig = pm.map[clamped] ?? 0;
  let line = 1;
  let col = 1;
  for (let i = 0; i < orig && i < pm.source.length; i++) {
    if (pm.source[i] === '\n') {
      line += 1;
      col = 1;
    } else col += 1;
  }
  return { line, column: col };
}
