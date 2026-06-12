'use client';

/**
 * VISUAL EDITOR — the other half of the Code ⇄ Visual toggle. The same document,
 * edited in a rendered view:
 *
 *  · Prose, headings and list items are directly EDITABLE (type in place).
 *    Inline maths, \cite/\ref and unknown commands render as ATOMIC CHIPS that
 *    carry their original LaTeX verbatim — they survive surrounding edits
 *    untouched. Styled text (\textbf/\emph/…) is editable inside its styling.
 *  · Display maths is edited IN PLACE: click an equation → raw LaTeX editor with
 *    a live KaTeX preview; confirm writes back.
 *  · Every edit is reconstructed into LaTeX and written into the live buffer —
 *    the same autosave + auto-compile path as the Code view. Figures/tables
 *    jump to Code (their layout belongs to the source).
 *
 * The rendering is an approximation; the compiled PDF remains the ground truth.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { api } from '../../lib/api';
import { useEditorStore } from '../../lib/store';
import { mimeForPath } from '../../lib/fileKind';
import { cleanForKatex, katexMacros, KATEX_ERROR_COLOR } from './mathPreview';
import { useIndexVersion } from '../../lib/latexIndex';
import { latexToBlocks, type VisualBlock } from './visualBlocks';
import { useVisualGhost, type DocContext } from './visualGhost';
import { attachTextFieldAutocomplete, useTextFieldAutocomplete, useVisualAutocomplete } from './visualAutocomplete';

// ── LaTeX ⇄ HTML with verbatim-preserving chips ───────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function mathHtml(latex: string, display: boolean): string {
  const cleaned = cleanForKatex(latex);
  if (!cleaned) return '';
  const body = display && /\\\\|&/.test(cleaned) ? `\\begin{aligned}${cleaned}\\end{aligned}` : cleaned;
  try {
    return katex.renderToString(body, { displayMode: display, throwOnError: false, errorColor: KATEX_ERROR_COLOR, macros: katexMacros(), strict: false });
  } catch {
    return `<code>${esc(cleaned)}</code>`;
  }
}

/** KaTeX "rendered" but couldn't: with throwOnError:false an unknown command
 *  comes out as error-coloured source text, not a thrown error. */
function mathFailed(html: string): boolean {
  return html === '' || html.includes(KATEX_ERROR_COLOR) || html.includes('#cc0000') || html.includes('katex-error') || html.startsWith('<code>');
}

/** True when KaTeX could not typeset ANY of it and just echoed the raw source —
 *  showing that above the textarea would print the same commands twice. */
function isFullEcho(html: string): boolean {
  return html.startsWith('<code>') || html.includes('katex-error');
}

/** An atomic, non-editable chip that carries its source LaTeX verbatim. */
function chip(tex: string, innerHtml: string, cls = ''): string {
  return `<span contenteditable="false" data-tex="${esc(tex)}" class="vv-chip ${cls}">${innerHtml}</span>`;
}

const WRAP_TAGS: Record<string, string> = { textbf: 'strong', textit: 'em', emph: 'em', texttt: 'code', underline: 'u', textsc: 'span' };

/** Inline LaTeX → editable HTML. Editable text stays text; everything LaTeX-y
 *  becomes a chip (verbatim) or a styled wrapper (data-wrap, editable inside). */
export function inlineToHtml(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '$') {
      const close = text.indexOf('$', i + 1);
      if (close > i) {
        const tex = text.slice(i, close + 1);
        const html = mathHtml(text.slice(i + 1, close), false);
        // KaTeX can't do it (e.g. a class-file macro)? Mark the chip: it gets
        // upgraded to a real TeX-engine render asynchronously.
        out += chip(tex, html, mathFailed(html) ? 'vv-math vv-math-fail' : 'vv-math');
        i = close + 1;
        continue;
      }
    }
    if (ch === '\\') {
      const wrap = /^\\(textbf|textit|emph|texttt|underline|textsc)\{([^{}]*)\}/.exec(text.slice(i));
      if (wrap) {
        const tag = WRAP_TAGS[wrap[1]!] ?? 'span';
        out += `<${tag} data-wrap="${wrap[1]}">${inlineToHtml(wrap[2] ?? '')}</${tag}>`;
        i += wrap[0].length;
        continue;
      }
      const cite = /^\\(?:cite|citep|citet|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{[^}]*\}/.exec(text.slice(i));
      if (cite) {
        const keys = /\{([^}]*)\}$/.exec(cite[0])?.[1] ?? '';
        out += chip(cite[0], `[${esc(keys)}]`, 'vv-badge');
        i += cite[0].length;
        continue;
      }
      const ref = /^\\(?:ref|eqref|pageref|cref|Cref|autoref)\{[^}]*\}/.exec(text.slice(i));
      if (ref) {
        const key = /\{([^}]*)\}$/.exec(ref[0])?.[1] ?? '';
        out += chip(ref[0], `(${esc(key)})`, 'vv-badge');
        i += ref[0].length;
        continue;
      }
      // Any other command (with optional args): preserve verbatim as a chip.
      // A bare command in prose is almost always notation (\bnabla, \omega, a
      // custom operator) — render it as MATHS, not as code. Only commands that
      // neither KaTeX nor the project's macro table can interpret stay as a
      // monospace chip.
      const generic = /^\\[a-zA-Z]+\*?(?:\[[^\]]*\])?(?:\{[^{}]*\})*/.exec(text.slice(i));
      if (generic && generic[0].length > 1) {
        const name = /^\\([a-zA-Z]+)/.exec(generic[0])![1]!;
        const math = mathHtml(generic[0], false);
        if (!mathFailed(math)) {
          out += chip(generic[0], math, 'vv-math');
        } else if (`\\${name}` in katexMacros()) {
          // It IS a custom command — KaTeX just can't expand it. Show the chip
          // as maths-pending; the TeX engine renders it asynchronously.
          out += chip(generic[0], math || `<code>${esc(generic[0])}</code>`, 'vv-math vv-math-fail');
        } else {
          const inner = /\{([^{}]*)\}/.exec(generic[0])?.[1];
          out += chip(generic[0], esc(inner ?? generic[0]), inner ? '' : 'vv-cmd');
        }
        i += generic[0].length;
        continue;
      }
    }
    out += ch === '<' ? '&lt;' : ch === '&' ? '&amp;' : ch;
    i += 1;
  }
  return out;
}

/** Reconstruct LaTeX from an edited contentEditable DOM (chips → verbatim TeX,
 *  wrappers → their command around the edited inner, text → text). Pure-ish and
 *  unit-tested via JSDOM. */
export function domToLatex(root: Node): string {
  let out = '';
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.hasAttribute('data-ghost')) return; // AI suggestion — proposed, not accepted
    const tex = el.getAttribute('data-tex');
    if (tex !== null) {
      out += tex;
      return;
    }
    const wrap = el.getAttribute('data-wrap');
    if (wrap) {
      out += `\\${wrap}{${domToLatex(el)}}`;
      return;
    }
    if (el.tagName === 'BR') {
      out += ' ';
      return;
    }
    out += domToLatex(el); // unknown wrapper (paste artifacts): keep its text
  });
  return out;
}

// ── Inline maths chip editing ─────────────────────────────────────────────────

/**
 * Click an inline equation chip → a small in-place input with its raw LaTeX.
 * Enter or clicking away commits (the chip's data-tex is updated, so the
 * paragraph round-trip writes it back); Escape reverts. The input lives INSIDE
 * the contenteditable=false chip, so the surrounding prose editor never sees
 * the keystrokes as text.
 */
function beginChipEdit(chipEl: HTMLElement, onCommitted: () => void): void {
  if (chipEl.querySelector('input')) return; // already editing
  const tex = chipEl.getAttribute('data-tex') ?? '';
  const inner = tex.replace(/^\$+|\$+$/g, '');
  const prevHtml = chipEl.innerHTML;
  const prevFailed = chipEl.classList.contains('vv-math-fail');

  const input = document.createElement('input');
  input.value = inner;
  input.className = 'vv-chip-edit';
  input.spellcheck = false;
  input.setAttribute('data-testid', 'vv-chip-input');
  const size = () => {
    input.style.width = `${Math.max(4, input.value.length + 1)}ch`;
  };
  size();
  chipEl.classList.remove('vv-math-fail'); // pause the async PNG upgrade while open
  chipEl.innerHTML = '';
  chipEl.appendChild(input);
  input.focus();

  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (commit && next && next !== inner.trim()) {
      chipEl.setAttribute('data-tex', `$${next}$`);
      const html = mathHtml(next, false);
      chipEl.innerHTML = html;
      chipEl.classList.toggle('vv-math-fail', mathFailed(html));
      onCommitted(); // paragraph reconstructs from the DOM and writes back
    } else {
      chipEl.innerHTML = prevHtml;
      chipEl.classList.toggle('vv-math-fail', prevFailed);
    }
  };
  input.addEventListener('input', size);
  const detachAc = attachTextFieldAutocomplete(input);
  void detachAc; // disposed implicitly when the input leaves the DOM (blur closes the dropdown)
  input.addEventListener('mousedown', (e) => e.stopPropagation());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
}

// ── Write-back ────────────────────────────────────────────────────────────────

function useWriteBack() {
  const activeFileId = useEditorStore((s) => s.activeFileId);
  const setContent = useEditorStore((s) => s.setContent);
  const contents = useEditorStore((s) => s.contents);
  return (fromLine: number, toLine: number, replacement: string[]) => {
    if (!activeFileId) return;
    const current = contents[activeFileId] ?? '';
    const lines = current.split('\n');
    lines.splice(fromLine - 1, toLine - fromLine + 1, ...replacement);
    setContent(activeFileId, lines.join('\n'));
  };
}

// ── Blocks ────────────────────────────────────────────────────────────────────

/** Editable prose-ish block (paragraph, heading, list item). */
function EditableInline({
  latex,
  className,
  testid,
  epoch,
  onCommit,
  ghostContext,
}: {
  latex: string;
  className: string;
  testid: string;
  epoch: number;
  onCommit: (newLatex: string) => void;
  ghostContext?: () => DocContext;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const projectId = useEditorStore((s) => s.projectId);
  // Predictive ghost text — same engine and Tab-to-accept rule as the Code view.
  useVisualGhost(ref, ghostContext ?? (() => ({ before: '', after: '' })));
  // Predictive coding — the deterministic LaTeX dropdown (commands, \cite, \ref, \begin).
  useVisualAutocomplete(ref);
  // epoch: when the project's macro index arrives, inline maths re-renders from
  // code-style fallback into real notation (a deliberate extra dependency).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => inlineToHtml(latex), [latex, epoch]);

  // Whatever KaTeX could not typeset goes through the real TeX engine.
  useEffect(() => {
    if (!ref.current || !projectId) return;
    return upgradeFailedChips(ref.current, projectId);
  }, [html, projectId]);

  const commitFromDom = () => {
    const el = ref.current;
    if (!el) return;
    const next = domToLatex(el).replace(/ /g, ' ').trim();
    if (next !== latex.trim()) onCommit(next);
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      data-testid={testid}
      className={`${className} vv-editable`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        // Inline equations edit in place — click the chip, type, Enter/click away.
        const chip = (e.target as HTMLElement).closest?.('.vv-math');
        if (chip && ref.current?.contains(chip)) beginChipEdit(chip as HTMLElement, commitFromDom);
      }}
      onBlur={(e) => {
        // Focus moving INTO a chip's inline input is not a commit point.
        if (ref.current?.contains(e.relatedTarget as Node | null)) return;
        commitFromDom();
      }}
    />
  );
}

/** Read-only inline LaTeX (captions): same chip rendering + TeX-engine upgrade
 *  as EditableInline, without the contentEditable write-back. */
function InlineTex({ latex }: { latex: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const projectId = useEditorStore((s) => s.projectId);
  const epoch = useIndexVersion((s) => s.v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => inlineToHtml(latex), [latex, epoch]);
  useEffect(() => {
    if (!ref.current || !projectId) return;
    return upgradeFailedChips(ref.current, projectId);
  }, [html, projectId]);
  return <span ref={ref} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Display maths: rendered KaTeX; click → in-place raw editor with live preview. */
function MathBlock({ latex, onCommit }: { latex: string; onCommit: (newLatex: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latex);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Predictive coding in the equation editor too (\commands, \begin, \ref …).
  useTextFieldAutocomplete(taRef, editing);
  const rendered = useMemo(() => mathHtml(editing ? draft : latex, true), [editing, draft, latex]);

  // The source box grows to fit its content exactly (wrapped lines included) —
  // the whole equation is always visible, never scrolled.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight + 2}px`;
  }, [draft, editing]);
  // SEMI-COMPILED by default: every display equation is compiled through the
  // REAL TeX engine (project macros included, result cached) — what you see is
  // what LaTeX produces. KaTeX serves only as the instant placeholder while the
  // image compiles, and as the fallback if the snippet cannot compile.
  const png = useSnippetPng(latex, 'math', !editing);

  if (!editing) {
    if (typeof png === 'object' && png !== null) {
      return (
        <div
          data-testid="vv-math"
          data-semicompiled="true"
          className="my-2 cursor-pointer overflow-x-auto rounded px-2 py-1 transition-colors hover:bg-blue-50/60 dark:hover:bg-blue-500/10"
          title="Click to edit this equation (rendered by the TeX engine)"
          onClick={() => {
            setDraft(latex);
            setEditing(true);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the local snippet compiler */}
          <img src={png.src} alt="equation" className="vv-snippet mx-auto max-w-none" style={{ width: snippetCssWidth(png.width) }} />
        </div>
      );
    }
    return (
      <div
        data-testid="vv-math"
        className="my-2 cursor-pointer overflow-x-auto rounded px-2 py-1 text-zinc-900 transition-colors hover:bg-blue-50/60 dark:text-zinc-100 dark:hover:bg-blue-500/10"
        title="Click to edit this equation"
        onClick={() => {
          setDraft(latex);
          setEditing(true);
        }}
        dangerouslySetInnerHTML={{ __html: rendered }}
      />
    );
  }
  // Editing feels like prose: the equation stays rendered (live), the LaTeX
  // sits underneath, and clicking away commits — no Apply/Cancel. Esc reverts.
  return (
    <div
      data-testid="vv-math-editor"
      className="my-2 rounded px-2 py-1 ring-1 ring-blue-300/60 dark:ring-blue-500/25"
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return; // focus moved within
        setEditing(false);
        if (draft !== latex) onCommit(draft);
      }}
    >
      {!isFullEcho(rendered) && (
        <div className="overflow-x-auto py-1 text-zinc-900 dark:text-zinc-100" dangerouslySetInnerHTML={{ __html: rendered }} />
      )}
      <textarea
        ref={taRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(latex);
            setEditing(false);
          }
        }}
        rows={1}
        spellCheck={false}
        className="mt-1 w-full resize-none overflow-hidden rounded bg-transparent px-1 py-0.5 font-mono text-xs text-zinc-500 outline-none dark:text-zinc-400"
        data-testid="vv-math-input"
      />
    </div>
  );
}

// ── Semi-compiled snippets (real TeX → PNG, cached by content) ───────────────

const snippetCache = new Map<string, Promise<{ pngBase64: string; width?: number; height?: number } | null>>();

// At most 3 snippet compiles in flight — a long paper renders progressively
// instead of stampeding the TeX engine.
let active = 0;
const waiters: Array<() => void> = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiters.shift()?.();
  }
}

function renderSnippetCached(projectId: string, latex: string, kind: 'tikz' | 'math', inline = false) {
  const key = `${kind}:${inline ? 'i' : 'd'}:${latex}`;
  let hit = snippetCache.get(key);
  if (!hit) {
    hit = withSlot(() => api.renderSnippet(projectId, { latex, kind, inline })).catch(() => null);
    snippetCache.set(key, hit);
    // A failure is NEVER cached — a transient hiccup (API restart, compile
    // queue pressure) must not leave chips stuck as code for the session.
    void hit.then((res) => {
      if (res === null) snippetCache.delete(key);
    });
  }
  return hit;
}

// Inline snippet PNGs come back at 180dpi with a near-zero border, at the TeX
// 10pt body size: 10pt ≈ 25px per em. Dividing the pixel height by this gives
// the TRUE TeX size — but the chips sit next to KaTeX-rendered maths, and
// KaTeX displays inline maths at 1.21× the surrounding font (its standard
// `.katex { font-size: 1.21em }`). Engine-rendered chips must use the same
// convention or they read visibly smaller than their KaTeX neighbours.
const SNIPPET_PX_PER_EM = 25;
const KATEX_INLINE_SCALE = 1.21;

/** Upgrade every maths chip KaTeX could not render (marked vv-math-fail at
 *  build time) to a real TeX-engine PNG, sized to the running text. The chip
 *  keeps its data-tex, so the editable round-trip is untouched. */
function upgradeFailedChips(root: HTMLElement, projectId: string): () => void {
  let cancelled = false;
  const upgrade = (chipEl: HTMLElement, inner: string, attempt: number): void => {
    void renderSnippetCached(projectId, inner, 'math', true).then((res) => {
      if (cancelled || !chipEl.isConnected) return;
      if (!res) {
        // Transient failure — retry while the chip is visible (capped backoff).
        if (attempt < 4) setTimeout(() => !cancelled && chipEl.isConnected && upgrade(chipEl, inner, attempt + 1), 3000 * (attempt + 1));
        return;
      }
      // A missing height must never shrink the chip — fall back to one em.
      const px = res.height || SNIPPET_PX_PER_EM;
      const em = Math.max(0.5, (px / SNIPPET_PX_PER_EM) * KATEX_INLINE_SCALE);
      chipEl.innerHTML = `<img src="data:image/png;base64,${res.pngBase64}" alt="${esc(inner)}" class="vv-snippet" style="height:${em.toFixed(2)}em;vertical-align:middle;display:inline-block" />`;
      chipEl.classList.remove('vv-math-fail');
    });
  };
  root.querySelectorAll<HTMLElement>('.vv-math-fail').forEach((chipEl) => {
    const inner = (chipEl.getAttribute('data-tex') ?? '').replace(/^\$+|\$+$/g, '').trim();
    if (inner) upgrade(chipEl, inner, 0);
  });
  return () => {
    cancelled = true;
  };
}

type SnippetPng = 'pending' | null | { src: string; width: number; height: number };

function useSnippetPng(latex: string, kind: 'tikz' | 'math', enabled: boolean): SnippetPng {
  const projectId = useEditorStore((s) => s.projectId);
  const [state, setState] = useState<SnippetPng>('pending');
  useEffect(() => {
    if (!enabled || !projectId) return;
    let cancelled = false;
    setState('pending');
    void renderSnippetCached(projectId, latex, kind).then((res) => {
      if (!cancelled)
        setState(res ? { src: `data:image/png;base64,${res.pngBase64}`, width: res.width ?? 0, height: res.height ?? 0 } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [latex, kind, enabled, projectId]);
  return enabled ? state : null;
}

/** CSS width that puts the image's TeX glyphs at the SAME size as the running
 *  text's maths (1 TeX em → 1.21 screen em, KaTeX's convention) — display
 *  equations look exactly as compiled, in proportion to the prose. */
function snippetCssWidth(width: number): string | undefined {
  return width > 0 ? `${((width / SNIPPET_PX_PER_EM) * KATEX_INLINE_SCALE).toFixed(2)}em` : undefined;
}

/** A TikZ diagram, compiled through the REAL TeX engine and shown as an image. */
function TikzBlock({ latex, caption, onJump, line }: { latex: string; caption: string; onJump: (line: number) => void; line: number }) {
  const png = useSnippetPng(latex, 'tikz', true);
  return (
    <div
      data-testid="vv-tikz"
      className="my-4 cursor-pointer rounded px-2 hover:bg-blue-50/40 dark:hover:bg-blue-500/5"
      onClick={() => onJump(line)}
      title={`TikZ diagram — click to edit in Code (line ${line})`}
    >
      <figure>
        {png === 'pending' && (
          <div className="mx-auto flex h-32 w-2/3 animate-pulse items-center justify-center rounded border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
            compiling diagram…
          </div>
        )}
        {typeof png === 'object' && png !== null && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL from the local snippet compiler
          <img src={png.src} alt="TikZ diagram" className="vv-snippet mx-auto max-w-full" style={{ width: snippetCssWidth(png.width) }} />
        )}
        {png === null && (
          <div className="mx-auto flex h-24 w-2/3 items-center justify-center rounded border border-dashed border-amber-300 text-xs text-amber-600 dark:border-amber-500/40">
            diagram failed to compile — click to edit in Code
          </div>
        )}
        {caption && (
          <figcaption className="mt-1 text-center text-xs text-zinc-500">
            <InlineTex latex={caption} />
          </figcaption>
        )}
      </figure>
    </div>
  );
}

function FigureImage({ path }: { path: string | null }) {
  const files = useEditorStore((s) => s.files);
  const [src, setSrc] = useState<string | null>(null);
  const file = path ? files.find((f) => f.path === path || f.path.endsWith(`/${path}`) || f.path.replace(/\.[^.]+$/, '').endsWith(path)) : undefined;

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    if (!file) return;
    void api.getFile(file.id).then((full) => {
      if (!cancelled && full.content) setSrc(`data:${mimeForPath(file.path)};base64,${full.content}`);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // eslint-disable-next-line @next/next/no-img-element -- data-URL from local project state; next/image adds nothing here
  if (src) return <img src={src} alt={path ?? 'figure'} className="mx-auto max-h-80 max-w-full" />;
  return (
    <div className="mx-auto flex h-28 w-2/3 items-center justify-center rounded border border-dashed border-zinc-300 text-xs text-zinc-400 dark:border-zinc-700">
      {path ? `figure: ${path}` : 'figure'}
    </div>
  );
}

// ── The view ─────────────────────────────────────────────────────────────────

export function VisualView({ content, onJump }: { content: string; onJump: (line: number) => void }) {
  const blocks = useMemo(() => latexToBlocks(content), [content]);
  const writeBack = useWriteBack();
  const epoch = useIndexVersion((s) => s.v);
  // Ghost completions see the WHOLE document: everything before/after a block.
  const lines = useMemo(() => content.split('\n'), [content]);
  const ghostCtx = (line: number, endLine: number) => () => ({
    before: `${lines.slice(0, line - 1).join('\n')}\n`,
    after: `\n${lines.slice(endLine).join('\n')}`,
  });

  const renderBlock = (b: VisualBlock, idx: number) => {
    switch (b.kind) {
      case 'heading': {
        const sizes = { 1: 'mt-6 text-2xl', 2: 'mt-5 text-xl', 3: 'mt-4 text-lg' } as const;
        return (
          <EditableInline
            key={`${b.line}:${idx}`}
            latex={b.text}
            epoch={epoch}
            ghostContext={ghostCtx(b.line, b.endLine)}
            testid="vv-heading"
            className={`${sizes[b.level]} rounded px-2 font-semibold text-zinc-900 outline-none focus:bg-blue-50/60 dark:text-zinc-100 dark:focus:bg-blue-500/10`}
            onCommit={(next) => writeBack(b.line, b.endLine, [`\\${b.cmd}{${next}}`])}
          />
        );
      }
      case 'para':
        return (
          <EditableInline
            key={`${b.line}:${idx}`}
            latex={b.text}
            epoch={epoch}
            ghostContext={ghostCtx(b.line, b.endLine)}
            testid="vv-para"
            className="mt-2 rounded px-2 leading-relaxed text-zinc-700 outline-none focus:bg-blue-50/60 dark:text-zinc-300 dark:focus:bg-blue-500/10"
            onCommit={(next) => writeBack(b.line, b.endLine, [next])}
          />
        );
      case 'math': {
        const open = b.env ? `\\begin{${b.env}}` : '\\[';
        const close = b.env ? `\\end{${b.env}}` : '\\]';
        return (
          <MathBlock
            key={`${b.line}:${idx}`}
            latex={b.latex}
            onCommit={(next) => writeBack(b.line, b.endLine, [open, ...next.split('\n'), close])}
          />
        );
      }
      case 'list':
        return (
          <div key={`${b.line}:${idx}`} className="mt-2">
            <div className="pl-6 text-zinc-700 dark:text-zinc-300">
              {b.items.map((it, j) => (
                <div key={j} className="flex items-baseline gap-2">
                  <span className="select-none text-zinc-400">{b.ordered ? `${j + 1}.` : '•'}</span>
                  <EditableInline
                    latex={it.text}
                    epoch={epoch}
                    ghostContext={ghostCtx(it.line, it.line)}
                    testid="vv-item"
                    className="flex-1 rounded px-1 outline-none focus:bg-blue-50/60 dark:focus:bg-blue-500/10"
                    onCommit={(next) => writeBack(it.line, it.line, [`\t\\item ${next}`])}
                  />
                </div>
              ))}
            </div>
          </div>
        );
      case 'tikz':
        return <TikzBlock key={`${b.line}:${idx}`} latex={b.latex} caption={b.caption} onJump={onJump} line={b.line} />;
      case 'figure':
        return (
          <div key={`${b.line}:${idx}`} className="my-4 cursor-pointer rounded px-2 hover:bg-blue-50/40 dark:hover:bg-blue-500/5" onClick={() => onJump(b.line)} title={`Edit figure in Code (line ${b.line})`}>
            <figure>
              <FigureImage path={b.path} />
              {b.caption && (
                <figcaption className="mt-1 text-center text-xs text-zinc-500">
                  <InlineTex latex={b.caption} />
                </figcaption>
              )}
            </figure>
          </div>
        );
      case 'table':
        return (
          <div
            key={`${b.line}:${idx}`}
            className="my-4 cursor-pointer rounded border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-400 hover:bg-blue-50/40 dark:border-zinc-700"
            onClick={() => onJump(b.line)}
            title={`Edit table in Code (line ${b.line})`}
          >
            table{b.caption ? ` — ${b.caption}` : ''} (edit in Code; see compiled PDF for layout)
          </div>
        );
    }
  };

  return (
    <div data-testid="visual-view" className="h-full overflow-auto bg-[var(--ls-surface)] px-6 py-4">
      <div className="mx-auto max-w-3xl pb-16 text-[15px]">
        <p className="mb-3 rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          Visual editor — type directly in prose and headings; click an equation to edit it with a live preview. Maths,
          citations and commands are preserved exactly. Compile remains the ground truth for layout.
        </p>
        {blocks.map(renderBlock)}
      </div>
      <style jsx global>{`
        .vv-chip {
          display: inline;
          white-space: nowrap;
        }
        .vv-badge {
          display: inline-block;
          border-radius: 4px;
          background: rgba(59, 130, 246, 0.12);
          color: #2563eb;
          font-size: 0.78em;
          padding: 0 4px;
          margin: 0 1px;
        }
        .vv-cmd {
          border-radius: 4px;
          background: rgba(113, 113, 122, 0.12);
          font-family: var(--font-mono, monospace);
          font-size: 0.78em;
          padding: 0 3px;
        }
        .vv-editable:focus {
          outline: none;
        }
        .vv-chip {
          cursor: pointer;
        }
        /* Maths chips are a single solid hit target (click-to-edit). */
        .vv-chip.vv-math {
          display: inline-block;
          border-radius: 4px;
        }
        .vv-chip.vv-math:hover {
          background: rgba(59, 130, 246, 0.08);
        }
        .vv-ghost {
          opacity: 0.45;
          user-select: none;
          white-space: pre-wrap;
        }
        .vv-chip-edit {
          font-family: var(--font-mono, monospace);
          font-size: 0.85em;
          padding: 0 3px;
          border: 1px solid rgba(59, 130, 246, 0.5);
          border-radius: 4px;
          background: transparent;
          color: inherit;
          outline: none;
        }
        /* TeX-engine snippets are black glyphs on transparency — invert for dark. */
        :global(.dark) .vv-snippet {
          filter: invert(1) hue-rotate(180deg);
        }
      `}</style>
    </div>
  );
}
