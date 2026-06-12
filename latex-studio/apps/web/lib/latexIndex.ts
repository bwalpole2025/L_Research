'use client';

/**
 * Client-side project index for the deterministic LaTeX autocomplete.
 *
 * At COMPLETION TIME everything here is synchronous and local: sources read the
 * live open buffers (zustand) plus a background-built cache of the project's
 * other text files. The cache is (re)fetched once per project / file change —
 * at load time, never during a completion interaction. No model calls anywhere.
 */

import { create } from 'zustand';
import { api } from './api';
import { useEditorStore } from './store';

/** Bumped whenever the background index gains data — lets the Visual editor
 *  re-render maths once project macros (e.g. jfm.cls \p) become available. */
export const useIndexVersion = create<{ v: number; bump: () => void }>((set) => ({
  v: 0,
  bump: () => set((s) => ({ v: s.v + 1 })),
}));

export interface BibEntryInfo {
  key: string;
  title?: string;
  author?: string;
  year?: string;
}

export interface LabelInfo {
  name: string;
  /** The defining line (heading/equation context) for the info panel. */
  context: string;
  file: string;
}

export interface MacroInfo {
  /** Without the backslash. */
  name: string;
  body: string;
  file: string;
}

interface CachedFile {
  updatedAt: string;
  macros: MacroInfo[];
  labels: LabelInfo[];
  envs: string[];
  bib: BibEntryInfo[];
  packages: string[];
}

// ── Lightweight parsers (regex; deterministic) ────────────────────────────────

const MACRO_RE = /\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?\\([a-zA-Z]+)\}?(?:\[\d+\])?(?:\[[^\]]*\])?\s*\{|\\DeclareMathOperator\*?\s*\{\\([a-zA-Z]+)\}|\\def\s*\\([a-zA-Z]+)\s*\{/g;

function readBraced(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth += 1;
    else if (s[i] === '}') {
      depth -= 1;
      if (depth === 0) return s.slice(open + 1, i);
    }
  }
  return s.slice(open + 1, Math.min(open + 80, s.length));
}

export function extractMacros(file: string, content: string): MacroInfo[] {
  const out: MacroInfo[] = [];
  MACRO_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MACRO_RE.exec(content)) !== null) {
    const name = m[1] ?? m[2] ?? m[3];
    if (!name) continue;
    const bodyStart = content.indexOf('{', MACRO_RE.lastIndex - 1);
    const body = bodyStart === -1 ? '' : readBraced(content, bodyStart).replace(/\s+/g, ' ').slice(0, 80);
    out.push({ name, body, file });
  }
  return out;
}

const LABEL_RE = /\\label\s*\{([^}]+)\}/g;

export function extractLabels(file: string, content: string): LabelInfo[] {
  const out: LabelInfo[] = [];
  const lines = content.split('\n');
  // Track the nearest preceding heading / environment for context.
  let context = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /\\(?:chapter|section|subsection|subsubsection)\*?\s*\{([^}]*)\}/.exec(line);
    if (heading) context = heading[1] ?? '';
    const env = /\\begin\{(equation|align|figure|table|gather|multline)\*?\}/.exec(line);
    if (env) context = `${env[1]}${context ? ` in “${context}”` : ''}`;
    LABEL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LABEL_RE.exec(line)) !== null) {
      out.push({ name: m[1]!, context: context || line.trim().slice(0, 60), file });
    }
  }
  return out;
}

const NEWENV_RE = /\\(?:re)?newenvironment\*?\s*\{([^}]+)\}|\\newtheorem\*?\s*\{([^}]+)\}/g;

export function extractEnvs(content: string): string[] {
  const out: string[] = [];
  NEWENV_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NEWENV_RE.exec(content)) !== null) {
    const name = m[1] ?? m[2];
    if (name) out.push(name);
  }
  return out;
}

const USEPKG_RE = /\\usepackage(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

export function extractPackages(content: string): string[] {
  const out: string[] = [];
  USEPKG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = USEPKG_RE.exec(content)) !== null) {
    for (const p of (m[1] ?? '').split(',')) {
      const name = p.trim();
      if (name) out.push(name);
    }
  }
  return out;
}

const BIB_ENTRY_RE = /@([a-zA-Z]+)\s*\{\s*([^,\s}]+)\s*,/g;

export function extractBibEntries(content: string): BibEntryInfo[] {
  const out: BibEntryInfo[] = [];
  BIB_ENTRY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BIB_ENTRY_RE.exec(content)) !== null) {
    if (/^(string|comment|preamble)$/i.test(m[1] ?? '')) continue;
    const key = m[2]!;
    // Read the entry body (brace-balanced from the `{` after `@type`).
    const open = content.indexOf('{', m.index);
    const body = open === -1 ? '' : readBraced(content, open);
    const field = (name: string): string | undefined => {
      const fm = new RegExp(`${name}\\s*=\\s*[{"]`, 'i').exec(body);
      if (!fm) return undefined;
      const start = fm.index + fm[0].length - 1;
      const value = body[start] === '{' ? readBraced(body, start) : (body.slice(start + 1).split('"')[0] ?? '');
      return value.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90) || undefined;
    };
    const entry: BibEntryInfo = { key };
    const title = field('title');
    const author = field('author');
    const year = field('year');
    if (title) entry.title = title;
    if (author) entry.author = author;
    if (year) entry.year = year;
    out.push(entry);
  }
  return out;
}

// ── Cache of non-open project text files ─────────────────────────────────────

const cache = new Map<string, CachedFile>(); // fileId → parsed
let fetching = new Set<string>();
let cachedProject: string | null = null;

/** Kick a background refresh of stale/unseen text files. Never blocks. */
export function refreshIndexInBackground(): void {
  const ed = useEditorStore.getState();
  if (!ed.projectId) return;
  if (cachedProject !== ed.projectId) {
    cache.clear();
    fetching = new Set();
    cachedProject = ed.projectId;
  }
  for (const f of ed.files) {
    if (!/\.(tex|sty|cls|bib)$/i.test(f.path)) continue;
    const hit = cache.get(f.id);
    if (hit && hit.updatedAt === f.updatedAt) continue;
    if (fetching.has(f.id)) continue;
    fetching.add(f.id);
    void api
      .getFile(f.id)
      .then((full) => {
        const content = full.content ?? '';
        cache.set(f.id, {
          updatedAt: f.updatedAt,
          macros: /\.bib$/i.test(f.path) ? [] : extractMacros(f.path, content),
          labels: /\.bib$/i.test(f.path) ? [] : extractLabels(f.path, content),
          envs: /\.bib$/i.test(f.path) ? [] : extractEnvs(content),
          bib: /\.bib$/i.test(f.path) ? extractBibEntries(content) : [],
          packages: /\.(tex|sty|cls)$/i.test(f.path) ? extractPackages(content) : [],
        });
        useIndexVersion.getState().bump();
      })
      .catch(() => undefined)
      .finally(() => fetching.delete(f.id));
  }
}

// Prefetch as soon as the project's file list (or its contents) change, so the
// first `\cite{` / `\ref{` dropdown already has bib keys and labels — instead of
// the first dropdown kicking the fetch and coming up empty.
if (typeof window !== 'undefined') {
  let lastFiles: unknown = null;
  useEditorStore.subscribe((state) => {
    if (state.files !== lastFiles) {
      lastFiles = state.files;
      if (state.projectId) refreshIndexInBackground();
    }
  });
}

// ── Synchronous getters (what the completion sources call) ───────────────────

/** Live text of open buffers (always fresh) keyed by path; falls back to cache. */
function openBuffers(): Array<{ path: string; content: string }> {
  const ed = useEditorStore.getState();
  const out: Array<{ path: string; content: string }> = [];
  for (const [id, content] of Object.entries(ed.contents)) {
    const path = ed.files.find((f) => f.id === id)?.path;
    if (path && /\.(tex|sty|cls|bib)$/i.test(path)) out.push({ path, content });
  }
  return out;
}

function openPaths(): Set<string> {
  return new Set(openBuffers().map((b) => b.path));
}

export function indexedMacros(): MacroInfo[] {
  const out: MacroInfo[] = [];
  for (const b of openBuffers()) if (!/\.bib$/i.test(b.path)) out.push(...extractMacros(b.path, b.content));
  const open = openPaths();
  const ed = useEditorStore.getState();
  for (const f of ed.files) {
    if (open.has(f.path)) continue;
    const hit = cache.get(f.id);
    if (hit) out.push(...hit.macros);
  }
  // Project macro table (Settings) too.
  for (const [k, v] of Object.entries(ed.macros)) {
    out.push({ name: k.replace(/^\\/, ''), body: v.slice(0, 80), file: 'project settings' });
  }
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.name) ? false : (seen.add(m.name), true)));
}

export function indexedLabels(): LabelInfo[] {
  const out: LabelInfo[] = [];
  for (const b of openBuffers()) if (!/\.bib$/i.test(b.path)) out.push(...extractLabels(b.path, b.content));
  const open = openPaths();
  const ed = useEditorStore.getState();
  for (const f of ed.files) {
    if (open.has(f.path)) continue;
    const hit = cache.get(f.id);
    if (hit) out.push(...hit.labels);
  }
  const seen = new Set<string>();
  return out.filter((l) => (seen.has(l.name) ? false : (seen.add(l.name), true)));
}

export function indexedBib(): BibEntryInfo[] {
  const out: BibEntryInfo[] = [];
  for (const b of openBuffers()) if (/\.bib$/i.test(b.path)) out.push(...extractBibEntries(b.content));
  const open = openPaths();
  const ed = useEditorStore.getState();
  for (const f of ed.files) {
    if (open.has(f.path)) continue;
    const hit = cache.get(f.id);
    if (hit) out.push(...hit.bib);
  }
  const seen = new Set<string>();
  return out.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
}

export function indexedCustomEnvs(): string[] {
  const out: string[] = [];
  for (const b of openBuffers()) if (!/\.bib$/i.test(b.path)) out.push(...extractEnvs(b.content));
  const open = openPaths();
  const ed = useEditorStore.getState();
  for (const f of ed.files) {
    if (open.has(f.path)) continue;
    const hit = cache.get(f.id);
    if (hit) out.push(...hit.envs);
  }
  return [...new Set(out)];
}

export function indexedPackages(): string[] {
  const out: string[] = [];
  for (const b of openBuffers()) if (!/\.bib$/i.test(b.path)) out.push(...extractPackages(b.content));
  const open = openPaths();
  const ed = useEditorStore.getState();
  for (const f of ed.files) {
    if (open.has(f.path)) continue;
    const hit = cache.get(f.id);
    if (hit) out.push(...hit.packages);
  }
  return [...new Set(out)];
}

/** Project file paths by kind, relative to the active file's directory. */
export function projectFiles(kind: 'image' | 'tex'): Array<{ path: string; relative: string }> {
  const ed = useEditorStore.getState();
  const activePath = ed.files.find((f) => f.id === ed.activeFileId)?.path ?? '';
  const baseDir = activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/') + 1) : '';
  const re = kind === 'image' ? /\.(png|jpe?g|pdf|eps)$/i : /\.tex$/i;
  return ed.files
    .filter((f) => re.test(f.path) && f.path !== activePath)
    .map((f) => {
      let relative = f.path;
      if (baseDir && f.path.startsWith(baseDir)) relative = f.path.slice(baseDir.length);
      return { path: f.path, relative };
    });
}
