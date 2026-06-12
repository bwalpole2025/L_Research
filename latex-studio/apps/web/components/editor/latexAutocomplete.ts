'use client';

/**
 * IDE-grade deterministic LaTeX autocomplete (three layers, offline, no model):
 *  1. `\` command completion — curated dictionary + this project's own macros +
 *     commands implied by loaded \usepackage.
 *  2. Context-aware values — the RIGHT candidates inside \includegraphics{…},
 *     \input{…}, \cite{…}, \ref{…}, \begin{…}, \usepackage{…}, \label{…}. Each
 *     source fires ONLY in its context; empty indexes contribute nothing.
 *  3. Snippets — templates with ${…} tab stops (Tab/Shift-Tab cycle).
 *
 * COEXISTENCE with the AI ghost text (Phase 5S): when the dropdown is open it
 * owns Tab/Enter/Esc and the ghost is hidden; when closed, the ghost resumes and
 * Tab accepts it. See inlineSuggest.ts for the matching guards.
 */

import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  pickedCompletion,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorView, keymap } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';
import { EDITOR_FONT_FAMILY, EDITOR_FONT_SIZE } from './theme';
import { useAutocompleteStore } from '../../lib/autocompleteStore';
import {
  indexedBib,
  indexedCustomEnvs,
  indexedLabels,
  indexedMacros,
  indexedPackages,
  projectFiles,
  refreshIndexInBackground,
} from '../../lib/latexIndex';
import { CLASSES, COMMANDS, ENVIRONMENTS, PACKAGE_COMMANDS, PACKAGES, WORD_SNIPPETS } from './latexData';
import { hydrateUsageInBackground, recordAccept, usageBoost, type UsageCategory } from '../../lib/usage';

// ── Adaptive ranking (usage-aware, local, deterministic) ─────────────────────
//
// Every option carries a namespaced usageKey ("cmd:frac", "env:align",
// "cite:basset1888", …). usageBoost() adds 0–8 ON TOP of the option's source
// tier (0 / 10 / 50 / 90), so frequently-and-recently accepted items sort first
// WITHIN their tier but can never jump tiers — and since CodeMirror only ranks
// options its matcher already accepted, popularity can never surface a
// non-matching item. Cold start: no history → boost 0 → the static order.

interface AdaptiveCompletion extends Completion {
  usageKey?: string;
  /** True when usage raised this option — drives the subtle dot in the list. */
  boosted?: boolean;
}

/** Attach the usage ranking fields for one candidate. */
function withUsage(category: UsageCategory, name: string, tier: number): Pick<AdaptiveCompletion, 'boost' | 'usageKey' | 'boosted'> {
  const u = usageBoost(category, name);
  return { boost: tier + u, usageKey: `${category}:${name}`, ...(u > 0 ? { boosted: true } : {}) };
}

// ── Context detection (pure; unit-tested) ─────────────────────────────────────

export type AcContext =
  | { kind: 'command'; query: string; from: number }
  | { kind: 'graphics' | 'input' | 'cite' | 'ref' | 'begin' | 'end' | 'usepackage' | 'documentclass' | 'label'; query: string; from: number };

const ARG_CONTEXTS: Array<{ re: RegExp; kind: Exclude<AcContext['kind'], 'command'> }> = [
  { re: /\\includegraphics(?:\[[^\]]*\])?\{([^}]*)$/, kind: 'graphics' },
  { re: /\\(?:input|include)\{([^}]*)$/, kind: 'input' },
  { re: /\\(?:cite|citep|citet|citeauthor|citeyear|autocite|parencite|textcite)\*?(?:\[[^\]]*\])*\{([^}]*)$/, kind: 'cite' },
  { re: /\\(?:ref|eqref|pageref|cref|Cref|autoref|vref)\{([^}]*)$/, kind: 'ref' },
  { re: /\\begin\{([^}]*)$/, kind: 'begin' },
  { re: /\\end\{([^}]*)$/, kind: 'end' },
  { re: /\\usepackage(?:\[[^\]]*\])?\{([^}]*)$/, kind: 'usepackage' },
  { re: /\\documentclass(?:\[[^\]]*\])?\{([^}]*)$/, kind: 'documentclass' },
  { re: /\\label\{([^}]*)$/, kind: 'label' },
];

/** Classify the cursor position from the line text before it. `linePos` is the
 *  document offset of the line start (so `from` is absolute). */
export function detectAcContext(before: string, lineStart: number): AcContext | null {
  for (const { re, kind } of ARG_CONTEXTS) {
    const m = re.exec(before);
    if (m) {
      let query = m[1] ?? '';
      // \cite{a,b,partial — complete the segment after the last comma.
      if (kind === 'cite' && query.includes(',')) query = query.slice(query.lastIndexOf(',') + 1).trimStart();
      return { kind, query, from: lineStart + before.length - query.length };
    }
  }
  const cmd = /\\([a-zA-Z]*)$/.exec(before);
  if (cmd && !/\\\\$/.test(before.slice(0, before.length - (cmd[1] ?? '').length))) {
    return { kind: 'command', query: cmd[1] ?? '', from: lineStart + before.length - (cmd[1] ?? '').length - 1 };
  }
  return null;
}

// ── Option builders ──────────────────────────────────────────────────────────

function commandOptions(): Completion[] {
  const opts: Completion[] = [];
  const seen = new Set<string>();

  // 1. THIS document's macros (and the Settings macro table) — ranked first.
  for (const m of indexedMacros()) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    opts.push({
      label: `\\${m.name}`,
      detail: 'macro (this project)',
      info: m.body ? `\\${m.name} → ${m.body}` : `defined in ${m.file}`,
      type: 'variable',
      apply: `\\${m.name}`,
      ...withUsage('cmd', m.name, 90),
    });
  }

  // 2. Commands implied by loaded packages.
  const loaded = new Set(indexedPackages());
  for (const [pkg, cmds] of Object.entries(PACKAGE_COMMANDS)) {
    if (!loaded.has(pkg)) continue;
    for (const c of cmds) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      opts.push(
        c.snippet
          ? snippetCompletion(`\\${c.snippet}`, { label: `\\${c.name}`, detail: c.detail, ...(c.info ? { info: c.info } : {}), type: 'function', ...withUsage('cmd', c.name, 10) })
          : { label: `\\${c.name}`, detail: c.detail, ...(c.info ? { info: c.info } : {}), type: 'function', apply: `\\${c.name}`, ...withUsage('cmd', c.name, 10) },
      );
    }
  }

  // 3. The curated static dictionary.
  for (const c of COMMANDS) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    opts.push(
      c.snippet
        ? snippetCompletion(`\\${c.snippet}`, { label: `\\${c.name}`, detail: c.detail, ...(c.info ? { info: c.info } : {}), type: 'keyword', ...withUsage('cmd', c.name, 0) })
        : { label: `\\${c.name}`, detail: c.detail, ...(c.info ? { info: c.info } : {}), type: 'keyword', apply: `\\${c.name}`, ...withUsage('cmd', c.name, 0) },
    );
  }
  return opts;
}

// ── The completion source ────────────────────────────────────────────────────

/** Exported for tests: the single override source. Always synchronous — it reads
 *  only local data (open buffers + the in-memory index), so it is offline and
 *  instant; the index's background warm-up is the only thing that ever touches
 *  the network and it never blocks a completion. */
export function latexSource(context: CompletionContext): CompletionResult | null {
  const { enabled, sources } = useAutocompleteStore.getState();
  if (!enabled) return null;
  refreshIndexInBackground(); // async top-up; this call stays synchronous
  hydrateUsageInBackground(); // usage cache likewise — ranking reads are in-memory only

  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const ctx = detectAcContext(before, line.from);
  if (!ctx) return wordSnippetSource(context);

  const result = (options: Completion[], from: number, validFor = /^[\w./:*-]*$/): CompletionResult | null =>
    options.length === 0 ? null : { from, options, validFor };

  switch (ctx.kind) {
    case 'command': {
      if (!sources.commands) return null;
      if (ctx.query === '' && !context.explicit) {
        // Bare `\` — open immediately (the trigger char for layer 1).
        return result(commandOptions(), ctx.from, /^\\?[a-zA-Z]*$/);
      }
      return result(commandOptions(), ctx.from, /^\\?[a-zA-Z]*$/);
    }
    case 'graphics': {
      if (!sources.graphics) return null;
      return result(
        projectFiles('image').map((f) => ({ label: f.relative, detail: 'image', info: f.path, type: 'constant', ...withUsage('gfx', f.relative, 0) })),
        ctx.from,
      );
    }
    case 'input': {
      if (!sources.inputFiles) return null;
      return result(
        projectFiles('tex').map((f) => {
          const label = f.relative.replace(/\.tex$/i, '');
          return { label, detail: '.tex file', info: f.path, type: 'constant', ...withUsage('input', label, 0) };
        }),
        ctx.from,
      );
    }
    case 'cite': {
      if (!sources.citations) return null;
      return result(
        indexedBib().map((e) => ({
          label: e.key,
          detail: [e.author?.split(/\s+and\s+/i)[0], e.year].filter(Boolean).join(', '),
          ...(e.title ? { info: e.title } : {}),
          type: 'constant',
          ...withUsage('cite', e.key, 0),
        })),
        ctx.from,
        /^[\w:.-]*$/,
      );
    }
    case 'ref': {
      if (!sources.labels) return null;
      return result(
        indexedLabels().map((l) => ({ label: l.name, detail: l.context.slice(0, 40), info: `${l.context} (${l.file})`, type: 'constant', ...withUsage('label', l.name, 0) })),
        ctx.from,
        /^[\w:.-]*$/,
      );
    }
    case 'begin': {
      if (!sources.environments) return null;
      const custom = indexedCustomEnvs().map((name) => ({ name, detail: 'environment (this project)' }));
      const indent = /^\s*/.exec(line.text)?.[0] ?? '';
      const options = [...custom, ...ENVIRONMENTS].map(
        (e): Completion => ({
          label: e.name,
          detail: e.detail,
          type: 'class',
          // Accepting auto-inserts the matching \end and puts the cursor between
          // (the single Layer-3 pairing path — the `}` input handler only fires
          // on a TYPED brace, so the two never duplicate).
          apply: (view, completion, from, to) => {
            const insert = `${e.name}}\n${indent}\t\n${indent}\\end{${e.name}}`;
            const cursor = from + `${e.name}}\n${indent}\t`.length;
            view.dispatch({
              changes: { from, to, insert },
              selection: { anchor: cursor },
              userEvent: 'input.complete',
              annotations: pickedCompletion.of(completion), // custom apply → annotate for usage recording
            });
          },
          ...withUsage('env', e.name, e.detail.includes('this project') ? 50 : 0),
        }),
      );
      return result(options, ctx.from, /^[\w*]*$/);
    }
    case 'end': {
      if (!sources.environments) return null;
      // Prefer environments opened above the cursor that are still unclosed.
      const above = context.state.sliceDoc(0, context.pos);
      const opened: string[] = [];
      const re = /\\(begin|end)\{([^}]+)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(above)) !== null) {
        if (m[1] === 'begin') opened.push(m[2]!);
        else {
          const i = opened.lastIndexOf(m[2]!);
          if (i >= 0) opened.splice(i, 1);
        }
      }
      const unclosed = [...new Set(opened.reverse())];
      const rest = [...indexedCustomEnvs().map((n) => ({ name: n, detail: 'environment (this project)' })), ...ENVIRONMENTS].filter(
        (e) => !unclosed.includes(e.name),
      );
      return result(
        [
          ...unclosed.map((name, i) => ({ label: name, detail: 'open above', type: 'class', boost: 90 - i, apply: `${name}}` })),
          ...rest.map((e) => ({ label: e.name, detail: e.detail, type: 'class', apply: `${e.name}}`, ...withUsage('env', e.name, 0) })),
        ],
        ctx.from,
        /^[\w*]*$/,
      );
    }
    case 'usepackage': {
      if (!sources.packages) return null;
      return result(PACKAGES.map((p) => ({ label: p.name, detail: p.detail, type: 'namespace', ...withUsage('pkg', p.name, 0) })), ctx.from);
    }
    case 'documentclass': {
      if (!sources.packages) return null;
      return result(CLASSES.map((c) => ({ label: c.name, detail: c.detail, type: 'namespace', ...withUsage('class', c.name, 0) })), ctx.from);
    }
    case 'label': {
      if (!sources.labels) return null;
      // Low-priority prefix hints based on context (eq:, fig:, sec:, tab:).
      const above = context.state.sliceDoc(Math.max(0, context.pos - 600), context.pos);
      const prefix = /\\begin\{(equation|align|gather|multline)/.test(above)
        ? 'eq:'
        : /\\begin\{figure/.test(above)
          ? 'fig:'
          : /\\begin\{table/.test(above)
            ? 'tab:'
            : /\\(section|subsection|chapter)/.test(above)
              ? 'sec:'
              : null;
      if (!prefix || ctx.query.length > 0) return null;
      return result([{ label: prefix, detail: 'label prefix', type: 'text', boost: -10 }], ctx.from);
    }
  }
}

/** Word-triggered templates (figure, table, align, …) — explicit trigger only,
 *  so prose typing never fights the ghost text. */
function wordSnippetSource(context: CompletionContext): CompletionResult | null {
  const { enabled, sources } = useAutocompleteStore.getState();
  if (!enabled || !sources.snippets) return null;
  if (!context.explicit) return null;
  const word = context.matchBefore(/[a-zA-Z]*/);
  if (!word) return null;
  return {
    from: word.from,
    options: WORD_SNIPPETS.map((s) => snippetCompletion(s.template, { label: s.label, detail: s.detail, type: 'keyword', ...withUsage('snippet', s.label, 50) })),
    validFor: /^[a-zA-Z]*$/,
  };
}

// ── Extension ────────────────────────────────────────────────────────────────

/**
 * Tab/Enter accept the highlighted dropdown item (Enter via the default keymap;
 * Tab added here, gated on the dropdown being open so the ghost text's Tab is
 * never shadowed when the dropdown is closed).
 */
const tabAcceptsDropdown = Prec.highest(
  keymap.of([{ key: 'Tab', run: (view) => (completionStatus(view.state) !== null ? acceptCompletion(view) : false) }]),
);

/**
 * Usage recording: every dropdown accept (plain apply, snippet apply, and our
 * annotated custom applies) carries the pickedCompletion annotation; the
 * option's usageKey tells us what was accepted and in which category. This is
 * the ONLY write path into the usage store — typing never records anything.
 */
const recordAccepts = EditorView.updateListener.of((update) => {
  for (const tr of update.transactions) {
    const completion = tr.annotation(pickedCompletion) as AdaptiveCompletion | undefined;
    const usageKey = completion?.usageKey;
    if (!usageKey) continue;
    const sep = usageKey.indexOf(':');
    recordAccept(usageKey.slice(0, sep) as UsageCategory, usageKey.slice(sep + 1));
  }
});

/**
 * Overleaf-style dropdown (palette and layout lifted from Overleaf's
 * source-editor `auto-complete.ts`, which is open source): flat square tooltip
 * with an offset shadow, rows laid out label-left / muted-detail-right, matched
 * text recoloured instead of underlined (blue in light, lime in dark), and
 * Overleaf's signature green selection in dark mode. `&light`/`&dark` follow
 * the active editor theme automatically.
 */
const autocompleteTheme = EditorView.baseTheme({
  '.cm-tooltip.cm-tooltip-autocomplete': {
    // Shift the tooltip so the completion text aligns with the typed text.
    marginLeft: '-4px',
  },
  '&light .cm-tooltip.cm-tooltip-autocomplete, &light .cm-tooltip.cm-completionInfo': {
    border: '1px lightgray solid',
    background: '#fefefe',
    color: '#111',
    boxShadow: '2px 3px 5px rgb(0 0 0 / 20%)',
  },
  '&dark .cm-tooltip.cm-tooltip-autocomplete, &dark .cm-tooltip.cm-completionInfo': {
    border: '1px #484747 solid',
    boxShadow: '2px 3px 5px rgba(0, 0, 0, 0.51)',
    background: '#25282c',
    color: '#c1c1c1',
  },
  // Match the editor font so the completion aligns with the document text.
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: EDITOR_FONT_FAMILY,
    fontSize: EDITOR_FONT_SIZE,
  },
  '.cm-tooltip.cm-tooltip-autocomplete li[role="option"]': {
    display: 'flex',
    justifyContent: 'space-between',
    lineHeight: '1.4', // larger target area than the 1.2 default
    outline: '1px solid transparent',
    padding: '1px 8px 1px 4px',
  },
  // Our `detail` (description / author-year / "macro (this project)") sits where
  // Overleaf puts its type tag: right-aligned, smaller, faded.
  '.cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail': {
    paddingLeft: '1.5em',
    fontSize: '90%',
    fontStyle: 'normal',
    opacity: '0.5',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    maxWidth: '24em',
  },
  '&light .cm-tooltip.cm-tooltip-autocomplete li[role="option"]:hover': {
    outlineColor: '#abbffe',
    backgroundColor: 'rgba(233, 233, 253, 0.4)',
  },
  '&dark .cm-tooltip.cm-tooltip-autocomplete li[role="option"]:hover': {
    outlineColor: 'rgba(109, 150, 13, 0.8)',
    backgroundColor: 'rgba(58, 103, 78, 0.62)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': {
    color: 'inherit',
  },
  '&light .cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: '#cad6fa',
  },
  '&dark .cm-tooltip.cm-tooltip-autocomplete ul li[aria-selected]': {
    background: '#3a674e',
  },
  // Scoped under the tooltip to out-rank CodeMirror's same-specificity default
  // (`.cm-completionMatchedText { text-decoration: underline }`).
  '.cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText': {
    textDecoration: 'none', // recoloured instead of underlined
  },
  '&light .cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText': {
    color: '#2d69c7',
  },
  '&dark .cm-tooltip.cm-tooltip-autocomplete .cm-completionMatchedText': {
    color: '#93ca12',
  },
  // Adaptive ranking affordance: a small dot marks items boosted by usage.
  '.cm-tooltip.cm-tooltip-autocomplete li.ls-ac-used .cm-completionLabel::after': {
    content: '" ·"',
    fontWeight: 'bold',
    opacity: '0.55',
  },
  // The side info panel (doc strings, bib titles): readable prose, not mono.
  '.cm-tooltip.cm-completionInfo': {
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '12px',
    lineHeight: '1.45',
    padding: '6px 10px',
    maxWidth: '26em',
  },
});

export function latexAutocomplete(): Extension {
  return [
    autocompletion({
      override: [latexSource],
      activateOnTyping: true,
      icons: false,
      defaultKeymap: true, // Enter accepts, Esc closes, arrows navigate
      maxRenderedOptions: 80,
      // Overleaf parity: keypresses are honoured as soon as the dropdown opens
      // (CodeMirror's default imposes a 75 ms guard).
      interactionDelay: 0,
      optionClass: (c) => ((c as AdaptiveCompletion).boosted ? 'ls-ac-used' : ''),
    }),
    tabAcceptsDropdown,
    recordAccepts,
    autocompleteTheme,
  ];
}
