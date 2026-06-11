'use client';

import { create } from 'zustand';
import { streamCoderive } from './api';
import { useEditorStore } from './store';
import { useAiStore } from './aiStore';
import { editorController } from './editorController';
import type { CoderiveCandidate, CoderiveIntent, CoderiveResponse, CoderiveRound, FileOverrides } from './types';

export const INTENTS: { id: CoderiveIntent; label: string; help: string; needsRange: boolean; needsTarget: boolean; wholeDocument?: boolean }[] = [
  { id: 'fill-gap', label: 'Fill gap', help: 'Select line A and a later line C — propose intermediate step(s) B with A → B → C verified.', needsRange: true, needsTarget: false },
  { id: 'next-step', label: 'Next step', help: 'At the cursor — propose the next line of the derivation.', needsRange: false, needsTarget: false },
  { id: 'reach-goal', label: 'Reach goal', help: 'Give a target expression — propose a verified chain from the current line to it.', needsRange: false, needsTarget: true },
  { id: 'justify', label: 'Justify', help: 'Select an existing transition — name the algebraic technique connecting the two lines.', needsRange: true, needsTarget: false },
  { id: 'verify-document', label: 'Verify document', help: 'No selection needed — SymPy checks every equation in the document; the AI adds context for the ones it cannot pass.', needsRange: false, needsTarget: false, wholeDocument: true },
];

function buildOverrides(): FileOverrides {
  const ed = useEditorStore.getState();
  const overrides: FileOverrides = {};
  for (const id of ed.openFileIds) {
    const path = ed.files.find((f) => f.id === id)?.path;
    const content = ed.contents[id];
    if (path && content !== undefined) overrides[path] = content;
  }
  return overrides;
}

interface CoderiveState {
  dialogOpen: boolean;
  intent: CoderiveIntent;
  target: string;
  running: boolean;
  progress: string | null;
  rounds: CoderiveRound[];
  response: CoderiveResponse | null;
  error: string | null;
  fileId: string | null;
  anchorRange: { fromLine: number; toLine?: number } | null;

  openDialog: () => void;
  closeDialog: () => void;
  setIntent: (i: CoderiveIntent) => void;
  setTarget: (t: string) => void;
  run: () => Promise<void>;
  insert: (candidate: CoderiveCandidate, force?: boolean) => Promise<void>;
}

let controller: AbortController | null = null;

export const useCoderiveStore = create<CoderiveState>((set, get) => ({
  dialogOpen: false,
  intent: 'fill-gap',
  target: '',
  running: false,
  progress: null,
  rounds: [],
  response: null,
  error: null,
  fileId: null,
  anchorRange: null,

  openDialog: () => set({ dialogOpen: true, error: null }),
  closeDialog: () => set({ dialogOpen: false }),
  setIntent: (intent) => set({ intent }),
  setTarget: (target) => set({ target }),

  async run() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    const { intent, target } = get();

    // Whole-document verification needs no anchor, no active file, no selection.
    if (intent === 'verify-document') {
      controller?.abort();
      controller = new AbortController();
      set({ dialogOpen: false, running: true, progress: 'verifying equations with SymPy', rounds: [], response: null, error: null, fileId: null, anchorRange: null });
      await streamCoderive(
        ed.projectId,
        { intent, overrides: buildOverrides() },
        {
          onRound: () => {},
          onProgress: (stage) => set({ progress: stage }),
          onResult: (response) => set({ response, running: false, progress: null }),
          onError: (_kind, message) => set({ error: message, running: false, progress: null }),
        },
        controller.signal,
      );
      return;
    }

    if (!ed.activeFileId) return;

    const sel = editorController.getSelectionLines();
    const cursor = editorController.getCursor();
    const anchorRange =
      intent === 'fill-gap' || intent === 'justify'
        ? sel
          ? { fromLine: sel.fromLine, toLine: Math.max(sel.toLine, sel.fromLine + 1) }
          : null
        : { fromLine: cursor?.line ?? 1 };

    if (!anchorRange) {
      set({ error: 'Select the two lines (A and C) for this intent first.' });
      return;
    }
    if (intent === 'reach-goal' && !target.trim()) {
      set({ error: 'Enter a target expression for "reach goal".' });
      return;
    }

    controller?.abort();
    controller = new AbortController();
    set({ dialogOpen: false, running: true, rounds: [], response: null, error: null, fileId: ed.activeFileId, anchorRange });

    await streamCoderive(
      ed.projectId,
      {
        fileId: ed.activeFileId,
        intent,
        anchorRange,
        ...(intent === 'reach-goal' && target.trim() ? { target: target.trim() } : {}),
        overrides: buildOverrides(),
      },
      {
        onRound: (r) => set((s) => ({ rounds: [...s.rounds.filter((x) => x.round !== r.round), r].sort((a, b) => a.round - b.round) })),
        onResult: (response) => set({ response, running: false }),
        onError: (_kind, message) => set({ error: message, running: false }),
      },
      controller.signal,
    );
  },

  async insert(candidate, force) {
    const verified = candidate.status === 'verified';
    if (!verified && !force) return;

    const ed = useEditorStore.getState();
    const { fileId, anchorRange, intent } = get();
    if (!fileId || !anchorRange) return;

    // Make sure the target file is active before editing it.
    if (fileId !== ed.activeFileId) {
      await ed.openFile(fileId);
      ed.setActive(fileId);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    const anchorLine = anchorRange.fromLine;
    const range = editorController.lineRange(anchorLine);
    if (!range) return;
    const original = editorController.lineText(anchorLine);
    const stepText = formatStep(candidate, original, intent);
    const replacement = `${original}\n${stepText}`;
    const file = ed.files.find((f) => f.id === fileId);

    useAiStore.getState().openDiff({
      from: range.from,
      to: range.to,
      original,
      replacement,
      source: 'coderive',
      filePath: file?.path ?? '',
      ...(verified
        ? {}
        : {
            warnText: stepText,
            unverifiedMessage:
              candidate.status === 'unverified'
                ? `Unverified by SymPy${candidate.counterexample ? ` — counterexample ${formatCx(candidate.counterexample)}` : ''}. Check this step.`
                : 'SymPy could not decide this step — not a verified correctness claim.',
          }),
    });
  },
}));

function formatStep(candidate: CoderiveCandidate, anchorLine: string, intent: CoderiveIntent): string {
  if (intent === 'justify') {
    return `% ${candidate.technique || 'technique'}${candidate.rationale ? ` — ${candidate.rationale}` : ''}`;
  }
  const expr = candidate.latex.trim();
  if (/&\s*=/.test(anchorLine)) {
    const rhs = expr.includes('=') ? expr.split('=').slice(1).join('=').trim() : expr;
    return `${rhs ? `&= ${rhs}` : expr} \\\\`;
  }
  return expr;
}

function formatCx(cx: { values: Record<string, number | string>; lhsVal: number | string; rhsVal: number | string }): string {
  const vals = Object.entries(cx.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}lhs=${cx.lhsVal}, rhs=${cx.rhsVal}`;
}
