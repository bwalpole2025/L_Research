/**
 * THE APPROVAL PRINCIPLE, asserted: AI output reaches a document ONLY through an
 * explicit accept — Tab for ghost text, Accept on a diff for edits/fixes. No other
 * code path may write AI text into a file. Plus: no Anthropic API key can reach
 * the browser bundle.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/editorController', () => ({
  editorController: {
    applyEdit: vi.fn(),
    markUnverified: vi.fn(),
    insertAtCursor: vi.fn(),
    captureRegionAroundLine: vi.fn(),
    getSelectionLines: vi.fn(),
    getCursor: vi.fn(),
    lineRange: vi.fn(),
    lineText: vi.fn(),
  },
}));

import { editorController } from '../lib/editorController';
import { useAiStore } from '../lib/aiStore';

const WEB_ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.next-e2e', 'test', 'e2e'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('approval guard — no AI output reaches a file without an explicit accept', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAiStore.setState({ pendingDiff: null, fixQueue: [], offerRecompile: false });
  });

  const diff = {
    from: 10,
    to: 20,
    original: 'broken line',
    replacement: 'fixed line',
    source: 'fix' as const,
    filePath: 'main.tex',
    anchorLine: 5,
  };

  it('openDiff (the proposal) NEVER touches the document', () => {
    useAiStore.getState().openDiff(diff);
    expect(editorController.applyEdit).not.toHaveBeenCalled();
  });

  it('rejectDiff leaves the document untouched', () => {
    useAiStore.getState().openDiff(diff);
    useAiStore.getState().rejectDiff();
    expect(editorController.applyEdit).not.toHaveBeenCalled();
    expect(useAiStore.getState().pendingDiff).toBeNull();
  });

  it('acceptDiff applies EXACTLY the proposed replacement, once', () => {
    useAiStore.getState().openDiff(diff);
    useAiStore.getState().acceptDiff();
    expect(editorController.applyEdit).toHaveBeenCalledTimes(1);
    expect(editorController.applyEdit).toHaveBeenCalledWith(10, 20, 'broken line', 'fixed line');
  });

  it('accepting a fix re-validates queued fixes (lines below shift by the delta)', () => {
    useAiStore.setState({
      fixQueue: [
        { severity: 'error', message: 'later error', line: 30 },
        { severity: 'error', message: 'earlier error', line: 3 },
      ],
      // freeze the auto-advance so the re-validated queue can be inspected
      errorFixesEnabled: false,
    });
    useAiStore.getState().openDiff({ ...diff, replacement: 'fixed line\nextra line\nextra line' }); // +2 lines
    useAiStore.getState().acceptDiff();
    const queue = useAiStore.getState().fixQueue;
    expect(queue.find((d) => d.message === 'later error')?.line).toBe(32); // below the fix → shifted
    expect(queue.find((d) => d.message === 'earlier error')?.line).toBe(3); // above the fix → unchanged
  });

  it('accepting a fix offers a recompile (compile-on-save off)', () => {
    useAiStore.getState().openDiff(diff);
    useAiStore.getState().acceptDiff();
    expect(useAiStore.getState().offerRecompile).toBe(true);
  });

  // ── Structural guard: the ONLY applyEdit call sites are the accept paths ─────

  it('editorController.applyEdit is called from acceptDiff (and nowhere else in app code)', () => {
    const files = walk(join(WEB_ROOT, 'lib')).concat(walk(join(WEB_ROOT, 'components')), walk(join(WEB_ROOT, 'app')));
    const callers: string[] = [];
    for (const f of files) {
      if (f.endsWith('editorController.ts')) continue; // the definition itself
      const src = readFileSync(f, 'utf8');
      if (src.includes('.applyEdit(')) callers.push(f);
    }
    expect(callers.map((f) => f.split('/').pop())).toEqual(['aiStore.ts']);
    // …and within aiStore, only inside acceptDiff.
    const aiStore = readFileSync(callers[0]!, 'utf8');
    const callSites = [...aiStore.matchAll(/\.applyEdit\(/g)];
    expect(callSites.length).toBe(1);
    const acceptBody = aiStore.slice(aiStore.indexOf('acceptDiff()'), aiStore.indexOf('rejectDiff()'));
    expect(acceptBody).toContain('.applyEdit(');
  });

  it('ghost text inserts only via its accept command (Tab) — no other dispatch-with-insert path', () => {
    const src = readFileSync(join(WEB_ROOT, 'components', 'editor', 'inlineSuggest.ts'), 'utf8');
    // The suggestion is rendered as a decoration; the sole insertion happens in acceptCmd.
    const acceptStart = src.indexOf('function acceptCmd');
    expect(acceptStart).toBeGreaterThan(-1);
    const inserts = [...src.matchAll(/changes:\s*\{[^}]*insert/g)];
    expect(inserts.length).toBe(1);
    expect(src.indexOf(inserts[0]![0])).toBeGreaterThan(acceptStart);
  });

  // ── No API key in the browser ─────────────────────────────────────────────────

  it('ANTHROPIC_API_KEY is never referenced in browser code', () => {
    const files = walk(join(WEB_ROOT, 'lib')).concat(walk(join(WEB_ROOT, 'components')), walk(join(WEB_ROOT, 'app')));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src.includes('ANTHROPIC_API_KEY'), `${f} must not reference ANTHROPIC_API_KEY`).toBe(false);
      expect(/sk-ant-[a-zA-Z0-9]/.test(src), `${f} must not contain a key literal`).toBe(false);
    }
  });
});
