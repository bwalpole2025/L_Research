import type { OutlineNode } from '@latex-studio/shared';
import { extractMathBlocks } from '../audit/extract.js';
import { parseProject, type FileInput } from '../thesis/parse.js';

export interface GlossaryEntry {
  symbol: string;
  meaning: string;
  confidence: 'low';
}

export interface DocumentModel {
  outline: { title: string; level: number }[];
  /** Macro name (with backslash) → body. */
  macros: Record<string, string>;
  glossary: GlossaryEntry[];
  /** Numbered \label names. */
  labels: string[];
  abstract: string;
  /** The most recent heading before the cursor. */
  recentHeading: string;
  /** The last few display equations before the cursor. */
  recentSteps: string[];
  /** Macro names + glossary symbols — for the client notation post-filter. */
  notationSymbols: string[];
  /** Optional LLM "where this is heading" note (a hint, never asserted). */
  headingNote?: string;
}

// Matches a macro definition up to the opening `{` of its body; the body is then read brace-balanced.
const MACRO_START =
  /\\(?:re|provide)?newcommand\*?\s*\{?\s*(\\[a-zA-Z]+)\s*\}?(?:\[\d+\])?(?:\[[^\]]*\])?\s*\{|\\DeclareMathOperator\*?\s*\{(\\[a-zA-Z]+)\}\s*\{|\\def\s*(\\[a-zA-Z]+)\s*\{/g;

function readBraced(s: string, openIndex: number): { body: string; end: number } {
  let depth = 0;
  for (let i = openIndex; i < s.length; i++) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: s.slice(openIndex + 1, i), end: i + 1 };
    }
  }
  return { body: s.slice(openIndex + 1), end: s.length };
}

/** Collect \newcommand/\def/\DeclareMathOperator macros across the project's text. */
export function collectMacros(files: FileInput[], projectMacros: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(projectMacros)) out[k.startsWith('\\') ? k : `\\${k}`] = v;
  for (const f of files) {
    if (!/\.(tex|sty|cls)$/.test(f.path)) continue;
    MACRO_START.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = MACRO_START.exec(f.content)) !== null) {
      const name = m[1] ?? m[2] ?? m[3];
      const { body, end } = readBraced(f.content, MACRO_START.lastIndex - 1);
      MACRO_START.lastIndex = end;
      if (name && !(name in out)) out[name] = body.replace(/\s+/g, ' ').trim();
    }
  }
  return out;
}

const GLOSSARY_PATTERNS: RegExp[] = [
  /\blet\s+\$([^$]{1,40})\$\s+(?:denote|be|denotes|represent|stand for)\s+([^.;,]{3,80})/gi,
  /\bwhere\s+\$([^$]{1,40})\$\s+(?:is|are|denotes|denote|represents)\s+([^.;,]{3,80})/gi,
  /\bdefine\s+\$([^$=]{1,40})(?:=|\\equiv)[^$]*\$\s*(?:to be|as|by)?\s*([^.;,]{0,80})/gi,
];

/** Heuristic symbol glossary from defining phrases. Always low-confidence. */
export function symbolGlossary(files: FileInput[]): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const f of files) {
    if (!f.path.endsWith('.tex')) continue;
    for (const re of GLOSSARY_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null && out.length < 40) {
        const symbol = (m[1] ?? '').trim();
        const meaning = (m[2] ?? '').replace(/\s+/g, ' ').trim();
        if (symbol && !seen.has(symbol)) {
          seen.add(symbol);
          out.push({ symbol, meaning: meaning || '(defined)', confidence: 'low' });
        }
      }
    }
  }
  return out;
}

function extractBetween(content: string, env: string): string {
  const m = new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`).exec(content);
  return m ? (m[1] ?? '').replace(/\s+/g, ' ').trim() : '';
}

const SYMBOL_RE = /\\[a-zA-Z]+/g;

export interface BuildInput {
  files: FileInput[];
  rootFile: string;
  projectMacros: Record<string, string>;
  cursorFile?: string;
  cursorLine?: number;
}

export function buildDocumentModel(input: BuildInput): DocumentModel {
  const parsed = parseProject(input.files, input.rootFile);
  const flatOutline: { title: string; level: number }[] = [];
  const labelSet = new Set<string>();
  const walk = (n: OutlineNode): void => {
    flatOutline.push({ title: n.title, level: n.level });
    n.labels.forEach((l) => labelSet.add(l.name));
    n.children.forEach(walk);
  };
  parsed.outline.forEach(walk);

  const macros = collectMacros(input.files, input.projectMacros);
  const glossary = symbolGlossary(input.files);

  const rootContent = input.files.find((f) => f.path === input.rootFile)?.content ?? input.files[0]?.content ?? '';
  const abstract = extractBetween(rootContent, 'abstract');

  // Recent heading + steps relative to the cursor.
  const cursorContent = input.files.find((f) => f.path === input.cursorFile)?.content ?? rootContent;
  const cursorLine = input.cursorLine ?? cursorContent.split('\n').length;
  const lines = cursorContent.split('\n');
  let recentHeading = '';
  for (let i = Math.min(cursorLine, lines.length) - 1; i >= 0; i--) {
    const h = /\\(?:sub)*section\*?\s*\{([^}]*)\}/.exec(lines[i] ?? '');
    if (h) {
      recentHeading = h[1] ?? '';
      break;
    }
  }
  const blocks = extractMathBlocks(input.cursorFile ?? input.rootFile, cursorContent);
  const recentSteps = blocks
    .flatMap((b) => b.steps)
    .filter((s) => s.line <= cursorLine)
    .slice(-4)
    .map((s) => s.latex);

  const notationSymbols = [
    ...Object.keys(macros),
    ...glossary.map((g) => (g.symbol.match(SYMBOL_RE) ?? [g.symbol])[0] ?? g.symbol),
  ];

  return {
    outline: flatOutline,
    macros,
    glossary,
    labels: [...labelSet],
    abstract,
    recentHeading,
    recentSteps,
    notationSymbols: [...new Set(notationSymbols)],
  };
}

/** Distil the model into a compact "context card" under a character budget (~800 tokens ≈ 3200 chars). */
export function buildContextCard(model: DocumentModel, budgetChars = 3200): string {
  const parts: string[] = [];
  if (model.abstract) parts.push(`About: ${model.abstract.slice(0, 600)}`);
  if (model.headingNote) parts.push(`Heading toward: ${model.headingNote}`);
  if (model.recentHeading) parts.push(`Current section: ${model.recentHeading}`);
  if (model.outline.length) {
    parts.push(`Outline: ${model.outline.slice(0, 20).map((o) => `${'  '.repeat(Math.max(0, o.level))}${o.title}`).join(' · ')}`);
  }
  const macroEntries = Object.entries(model.macros).slice(0, 40);
  if (macroEntries.length) parts.push(`Macros (REUSE these, do not re-expand): ${macroEntries.map(([k, v]) => `${k}=${v}`).join('; ')}`);
  if (model.glossary.length) {
    parts.push(`Symbols (heuristic, low-confidence): ${model.glossary.slice(0, 20).map((g) => `${g.symbol}: ${g.meaning}`).join('; ')}`);
  }
  if (model.labels.length) parts.push(`Numbered labels: ${model.labels.slice(0, 30).join(', ')}`);
  if (model.recentSteps.length) parts.push(`Recent derivation steps:\n${model.recentSteps.join('\n')}`);

  let card = parts.join('\n');
  if (card.length > budgetChars) card = `${card.slice(0, budgetChars)}…`;
  return card;
}
