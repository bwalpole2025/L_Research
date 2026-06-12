import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  CompletionContext,
  closeCompletion,
  completionStatus,
  startCompletion,
  type Completion,
} from '@codemirror/autocomplete';
import { latexAutocomplete, latexSource } from '../components/editor/latexAutocomplete';
import { inlineSuggestion, applySuggestion, currentSuggestion, type InlineSuggestConfig } from '../components/editor/inlineSuggest';
import { useEditorStore } from '../lib/store';
import { useAutocompleteStore, type AcSources } from '../lib/autocompleteStore';
import { indexedBib, indexedLabels, indexedMacros, projectFiles } from '../lib/latexIndex';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ALL_ON: AcSources = {
  commands: true,
  snippets: true,
  graphics: true,
  inputFiles: true,
  citations: true,
  labels: true,
  environments: true,
  packages: true,
};

const MAIN_TEX =
  '\\newcommand{\\Bo}{\\mathrm{Bo}}\n' +
  '\\usepackage{graphicx}\n' +
  '\\section{Setup}\n' +
  '\\begin{equation}\\label{eq:euler}\\end{equation}\n';
const REFS_BIB = '@article{cornish2018,\n  author = {Cornish, A. and Brown, B.},\n  title = {Multiple scales},\n  year = {2018}\n}';

/** Populate the editor store with OPEN buffers only. projectId is intentionally
 *  null so the index's background warm-up (the one network path) is a no-op and
 *  the completion path is exercised purely against local data. */
function seedProject(): void {
  useEditorStore.setState({
    projectId: null,
    activeFileId: 'f-main',
    files: [
      { id: 'f-main', projectId: 'p', path: 'main.tex', updatedAt: 't0' },
      { id: 'f-bib', projectId: 'p', path: 'refs.bib', updatedAt: 't0' },
      { id: 'f-img', projectId: 'p', path: 'figs/plot.png', updatedAt: 't0' },
      { id: 'f-chap', projectId: 'p', path: 'chapters/intro.tex', updatedAt: 't0' },
    ],
    contents: { 'f-main': MAIN_TEX, 'f-bib': REFS_BIB },
    macros: {},
  });
}

beforeEach(() => {
  useAutocompleteStore.setState({ enabled: true, sources: { ...ALL_ON } });
  seedProject();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useEditorStore.setState({ projectId: null, activeFileId: null, files: [], contents: {}, macros: {} });
});

/** Run the override source at the end of `doc` and return its option labels. */
function labelsAt(doc: string, explicit = false): { result: ReturnType<typeof latexSource>; labels: string[]; options: Completion[] } {
  const state = EditorState.create({ doc });
  const result = latexSource(new CompletionContext(state, doc.length, explicit));
  const options = [...(result?.options ?? [])];
  return { result, labels: options.map((o) => o.label), options };
}

// ── Offline + instant: no network during a completion ─────────────────────────

describe('autocomplete is offline and instant (no network calls)', () => {
  it('the source + index getters never call fetch, and the source is synchronous', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('autocomplete must not hit the network');
    });
    vi.stubGlobal('fetch', fetchSpy);

    // Drive every context kind through the real source.
    const cite = labelsAt('\\cite{');
    const ref = labelsAt('\\ref{');
    const gfx = labelsAt('\\includegraphics{');
    const begin = labelsAt('\\begin{');
    const cmd = labelsAt('\\inc');

    // …and the raw index getters the sources read from.
    indexedBib();
    indexedLabels();
    indexedMacros();
    projectFiles('image');
    projectFiles('tex');

    // Instant: a plain object/null is returned, never a Promise.
    for (const r of [cite.result, ref.result, gfx.result, begin.result, cmd.result]) {
      expect(r === null || typeof (r as { then?: unknown }).then !== 'function').toBe(true);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── Each context fires ONLY in its context, with real project data ────────────

describe('context-aware sources list the right values and never cross-leak', () => {
  it('\\inc → \\includegraphics (graphicx is loaded in the project), with a detail', () => {
    const { options } = labelsAt('\\inc');
    const ig = options.find((o) => o.label === '\\includegraphics');
    expect(ig).toBeTruthy();
    expect((ig?.detail ?? '').length).toBeGreaterThan(0);
  });

  it("a document \\newcommand{\\Bo}{…} appears in the `\\` command dropdown, ranked as the project's own macro", () => {
    const { options } = labelsAt('\\B');
    const bo = options.find((o) => o.label === '\\Bo');
    expect(bo).toBeTruthy();
    expect(bo?.detail).toContain('this project');
  });

  it('inside \\cite{ → bib keys with author/year, and NO image files', () => {
    const { labels, options } = labelsAt('\\cite{');
    expect(labels).toContain('cornish2018');
    const entry = options.find((o) => o.label === 'cornish2018');
    expect(entry?.detail).toMatch(/Cornish/);
    expect(entry?.detail).toMatch(/2018/);
    expect(labels.some((l) => /\.(png|jpe?g|pdf|eps)$/i.test(l))).toBe(false); // no graphics leak
  });

  it('inside \\includegraphics{ → project image files, and NO bib keys', () => {
    const { labels } = labelsAt('\\includegraphics{');
    expect(labels).toContain('figs/plot.png');
    expect(labels).not.toContain('cornish2018'); // no cite leak
  });

  it('inside \\input{ → project .tex files (relative, extension stripped)', () => {
    const { labels } = labelsAt('\\input{');
    expect(labels).toContain('chapters/intro');
  });

  it('inside \\ref{ → real labels with context, and NO environments', () => {
    const { labels, options } = labelsAt('\\ref{');
    expect(labels).toContain('eq:euler');
    expect(options.find((o) => o.label === 'eq:euler')?.info).toMatch(/equation|Setup/);
    expect(labels).not.toContain('align'); // no \begin leak
  });

  it('inside \\begin{ → environment names (static + custom), and NO labels', () => {
    const { labels } = labelsAt('\\begin{');
    expect(labels).toEqual(expect.arrayContaining(['align', 'figure', 'equation']));
    expect(labels).not.toContain('eq:euler'); // no \ref leak
  });

  it('a disabled context source contributes nothing', () => {
    useAutocompleteStore.setState({ enabled: true, sources: { ...ALL_ON, citations: false } });
    expect(labelsAt('\\cite{').result).toBeNull();
  });

  it('disabling autocomplete entirely silences every source', () => {
    useAutocompleteStore.setState({ enabled: false, sources: { ...ALL_ON } });
    expect(labelsAt('\\cite{').result).toBeNull();
    expect(labelsAt('\\inc').result).toBeNull();
  });
});

// ── Coexistence with the Phase 5S ghost text (Tab is never ambiguous) ──────────

const NOOP_INLINE: InlineSuggestConfig = {
  onDocChange: () => {},
  onAccept: () => {},
  onReject: () => {},
  onAlternative: () => {},
};

/** Mount a real editor with BOTH features, in the same order as CodeEditor.tsx. */
function mount(doc: string, pos: number): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, selection: { anchor: pos }, extensions: [latexAutocomplete(), inlineSuggestion(NOOP_INLINE)] }),
    parent: document.body,
  });
  view.focus();
  return view;
}

function pressTab(view: EditorView): void {
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
}

function hasGhost(view: EditorView): boolean {
  return view.dom.querySelector('.cm-ghost') !== null;
}

async function waitForActive(view: EditorView, ms = 600): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (completionStatus(view.state) === 'active') return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return completionStatus(view.state) === 'active';
}

describe('coexistence: dropdown vs ghost text — Tab is unambiguous in both states', () => {
  it('NO dropdown → ghost is shown and Tab accepts the ghost', () => {
    const view = mount('hello ', 6);
    applySuggestion(view, { from: 6, text: 'world', mode: 'prose' });
    try {
      expect(completionStatus(view.state)).toBe(null);
      expect(hasGhost(view)).toBe(true);
      pressTab(view);
      expect(view.state.doc.toString()).toBe('hello world');
      expect(currentSuggestion(view)).toBe(null);
    } finally {
      view.destroy();
    }
  });

  it('opening the dropdown SUPPRESSES the ghost; closing it RESTORES the ghost', async () => {
    const view = mount('\\qu', 3);
    applySuggestion(view, { from: 3, text: 'GHOST', mode: 'prose' });
    try {
      expect(hasGhost(view)).toBe(true); // ghost visible while the dropdown is closed

      startCompletion(view);
      expect(await waitForActive(view)).toBe(true);
      expect(completionStatus(view.state)).not.toBe(null);
      expect(hasGhost(view)).toBe(false); // suppressed while the dropdown owns the screen

      closeCompletion(view); // Esc-equivalent; the cursor never moved
      expect(completionStatus(view.state)).toBe(null);
      expect(currentSuggestion(view)?.text).toBe('GHOST');
      expect(hasGhost(view)).toBe(true); // ghost resumes
    } finally {
      view.destroy();
    }
  });

  it('dropdown OPEN → Tab takes the dropdown item, never the ghost', async () => {
    const view = mount('\\qu', 3);
    applySuggestion(view, { from: 3, text: 'GHOST', mode: 'prose' });
    try {
      startCompletion(view);
      expect(await waitForActive(view)).toBe(true);
      await new Promise((r) => setTimeout(r, 120)); // let the dropdown settle (interactionDelay is 0, Overleaf-style)
      pressTab(view);
      await new Promise((r) => setTimeout(r, 10));
      expect(view.state.doc.toString()).toBe('\\quad'); // the completion, not the ghost
      expect(view.state.doc.toString()).not.toContain('GHOST');
    } finally {
      view.destroy();
    }
  });
});
