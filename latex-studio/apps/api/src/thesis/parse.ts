import type {
  OutlineKind,
  OutlineNode,
  XrefDiagnostic,
  XrefReport,
} from '@latex-studio/shared';

export interface FileInput {
  path: string;
  content: string;
}

const KIND_LEVEL: Record<OutlineKind, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
};

const NUMBERED_ENVS = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign', 'dmath'];

interface SectionHit {
  kind: OutlineKind;
  title: string;
  file: string;
  line: number;
}
interface LabelHit {
  name: string;
  file: string;
  line: number;
}
interface KeyHit {
  key: string;
  file: string;
  line: number;
}

/** Remove a trailing line comment (first unescaped %). */
export function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%' && (i === 0 || line[i - 1] !== '\\')) return line.slice(0, i);
  }
  return line;
}

/** Read a brace-balanced group starting at `start` (which must point at '{'). */
function readBraced(text: string, start: number): { content: string; end: number } | null {
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return { content: text.slice(start + 1, i), end: i };
    }
  }
  return { content: text.slice(start + 1), end: text.length };
}

/** Order files by \input/\include from the root, then any leftovers alphabetically. */
export function orderFiles(files: FileInput[], rootFile: string): FileInput[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const ordered: FileInput[] = [];
  const seen = new Set<string>();

  const resolve = (path: string): void => {
    const candidates = [path, `${path}.tex`];
    const file =
      byPath.get(path) ??
      byPath.get(`${path}.tex`) ??
      files.find((f) => candidates.some((c) => f.path.endsWith(`/${c}`)));
    if (!file || seen.has(file.path)) return;
    seen.add(file.path);
    ordered.push(file);
    for (const line of file.content.split('\n')) {
      const m = /\\(?:input|include)\s*\{([^}]*)\}/.exec(stripComment(line));
      if (m && m[1]) resolve(m[1].trim());
    }
  };

  resolve(rootFile);
  for (const f of files) if (!seen.has(f.path)) ordered.push(f);
  return ordered;
}

interface Scan {
  sections: SectionHit[];
  labels: LabelHit[];
  refs: KeyHit[];
  cites: KeyHit[];
  bibKeys: Set<string>;
  unlabelledEqs: { file: string; line: number }[];
}

function scanFile(file: FileInput, scan: Scan): void {
  const isBib = file.path.endsWith('.bib');
  if (isBib) {
    for (const raw of file.content.split('\n')) {
      const m = /@\w+\s*\{\s*([^,\s}]+)\s*,/.exec(raw);
      if (m && m[1] && !/^string$/i.test(m[1])) scan.bibKeys.add(m[1].trim());
    }
    return;
  }

  const lines = file.content.split('\n');
  const envStack: { env: string; line: number; hasLabel: boolean }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const text = stripComment(lines[i] ?? '');

    // Sections (with brace-balanced titles).
    const secRe = /\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{/g;
    let sm: RegExpExecArray | null;
    while ((sm = secRe.exec(text)) !== null) {
      const braced = readBraced(text, secRe.lastIndex - 1);
      if (braced) {
        scan.sections.push({ kind: sm[1] as OutlineKind, title: braced.content.trim(), file: file.path, line: lineNo });
      }
    }

    // Numbered display-env tracking (for unlabelled-equation info).
    const beginRe = /\\begin\{([a-zA-Z*]+)\}/g;
    let bm: RegExpExecArray | null;
    while ((bm = beginRe.exec(text)) !== null) {
      const env = (bm[1] ?? '').replace(/\*$/, '');
      const starred = (bm[1] ?? '').endsWith('*');
      if (NUMBERED_ENVS.includes(env) && !starred) envStack.push({ env, line: lineNo, hasLabel: false });
    }
    if (/\\label\s*\{/.test(text) && envStack.length > 0) {
      const top = envStack[envStack.length - 1];
      if (top) top.hasLabel = true;
    }
    const endRe = /\\end\{([a-zA-Z*]+)\}/g;
    let em: RegExpExecArray | null;
    while ((em = endRe.exec(text)) !== null) {
      const env = (em[1] ?? '').replace(/\*$/, '');
      if (NUMBERED_ENVS.includes(env)) {
        const open = envStack.pop();
        if (open && !open.hasLabel) scan.unlabelledEqs.push({ file: file.path, line: open.line });
      }
    }

    // Labels.
    const labelRe = /\\label\s*\{([^}]*)\}/g;
    let lm: RegExpExecArray | null;
    while ((lm = labelRe.exec(text)) !== null) {
      const name = (lm[1] ?? '').trim();
      if (name) scan.labels.push({ name, file: file.path, line: lineNo });
    }

    // References.
    const refRe = /\\(?:eqref|autoref|pageref|cref|Cref|vref|ref)\s*\{([^}]*)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = refRe.exec(text)) !== null) {
      for (const key of (rm[1] ?? '').split(',')) {
        const k = key.trim();
        if (k) scan.refs.push({ key: k, file: file.path, line: lineNo });
      }
    }

    // Citations.
    const citeRe = /\\(?:parencite|textcite|citeauthor|citeyear|citealp|citep|citet|cite)\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
    let cm: RegExpExecArray | null;
    while ((cm = citeRe.exec(text)) !== null) {
      for (const key of (cm[1] ?? '').split(',')) {
        const k = key.trim();
        if (k) scan.cites.push({ key: k, file: file.path, line: lineNo });
      }
    }
  }
}

function buildOutline(sections: SectionHit[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  let counter = 0;
  for (const s of sections) {
    const level = KIND_LEVEL[s.kind];
    const node: OutlineNode = {
      id: `sec-${(counter += 1)}`,
      level,
      kind: s.kind,
      title: s.title,
      file: s.file,
      line: s.line,
      labels: [],
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1]!.level >= level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }
  return roots;
}

/** Attach each label to the nearest preceding heading in the same file. */
function attachLabels(roots: OutlineNode[], labels: LabelHit[]): void {
  const flat: OutlineNode[] = [];
  const walk = (n: OutlineNode) => {
    flat.push(n);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  for (const label of labels) {
    let best: OutlineNode | null = null;
    for (const node of flat) {
      if (node.file === label.file && node.line <= label.line) {
        if (!best || node.line > best.line) best = node;
      }
    }
    if (best) best.labels.push({ name: label.name, line: label.line });
  }
}

export interface ParsedProject {
  outline: OutlineNode[];
  xref: XrefReport;
}

/** Parse all project files into an outline + cross-reference health report. */
export function parseProject(files: FileInput[], rootFile: string): ParsedProject {
  const ordered = orderFiles(files, rootFile);
  const scan: Scan = {
    sections: [],
    labels: [],
    refs: [],
    cites: [],
    bibKeys: new Set(),
    unlabelledEqs: [],
  };
  for (const f of ordered) scanFile(f, scan);

  const outline = buildOutline(scan.sections);
  attachLabels(outline, scan.labels);

  // Cross-reference diagnostics.
  const diagnostics: XrefDiagnostic[] = [];
  const labelDefs = new Map<string, LabelHit[]>();
  for (const l of scan.labels) {
    const list = labelDefs.get(l.name) ?? [];
    list.push(l);
    labelDefs.set(l.name, list);
  }

  // Duplicate labels.
  for (const [name, defs] of labelDefs) {
    if (defs.length > 1) {
      for (const d of defs) {
        diagnostics.push({
          file: d.file,
          line: d.line,
          severity: 'error',
          rule: 'duplicate-label',
          message: `Label "${name}" is defined ${defs.length} times`,
          key: name,
          locations: defs.map((x) => ({ file: x.file, line: x.line })),
        });
      }
    }
  }

  // Undefined references.
  const referenced = new Set<string>();
  for (const r of scan.refs) {
    referenced.add(r.key);
    if (!labelDefs.has(r.key)) {
      diagnostics.push({
        file: r.file,
        line: r.line,
        severity: 'error',
        rule: 'undefined-ref',
        message: `Reference to undefined label "${r.key}"`,
        key: r.key,
      });
    }
  }

  // Missing citations (only when at least one .bib exists in the project).
  const hasBib = files.some((f) => f.path.endsWith('.bib'));
  if (hasBib) {
    for (const c of scan.cites) {
      if (!scan.bibKeys.has(c.key)) {
        diagnostics.push({
          file: c.file,
          line: c.line,
          severity: 'error',
          rule: 'missing-cite',
          message: `Citation "${c.key}" not found in any .bib file`,
          key: c.key,
        });
      }
    }
  }

  // Unused labels (info).
  for (const [name, defs] of labelDefs) {
    if (defs.length === 1 && !referenced.has(name)) {
      const d = defs[0]!;
      diagnostics.push({
        file: d.file,
        line: d.line,
        severity: 'info',
        rule: 'unused-label',
        message: `Label "${name}" is never referenced`,
        key: name,
      });
    }
  }

  // Un-referenceable equations (info).
  for (const e of scan.unlabelledEqs) {
    diagnostics.push({
      file: e.file,
      line: e.line,
      severity: 'info',
      rule: 'unlabelled-equation',
      message: 'Numbered equation has no \\label (un-referenceable)',
    });
  }

  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  return {
    outline,
    xref: { diagnostics, totals: { error: errors, info: diagnostics.length - errors } },
  };
}
