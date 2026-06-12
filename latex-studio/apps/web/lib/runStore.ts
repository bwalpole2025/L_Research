'use client';

import { create } from 'zustand';
import type { RunArtifact, RunStatus } from '@latex-studio/shared';
import { api, streamRun } from './api';
import { useEditorStore } from './store';
import { useThesisStore } from './thesisStore';

/**
 * Python "Run" state: streams a sandboxed execution's stdout/stderr into the
 * output window, tracks status/duration, and collects figure artefacts. One run
 * at a time per the UI; starting another aborts the previous client stream (the
 * server supersedes the sandbox). Kept separate from compilation.
 */

export interface RunSegment {
  stream: 'stdout' | 'stderr';
  text: string;
}

type UiStatus = 'idle' | RunStatus;

interface RunState {
  running: boolean;
  status: UiStatus;
  runId: string | null;
  script: string | null;
  segments: RunSegment[];
  exitCode: number | null;
  durationMs: number | null;
  figures: RunArtifact[];
  /** "Run Python file…" picker (the palette command). */
  pickerOpen: boolean;

  openPicker: () => void;
  closePicker: () => void;
  /** Run the active .py (or the project's run target). */
  runActive: () => void;
  /** Run a specific project-relative .py path. */
  runPath: (path: string) => void;
  /** Stop the running script (kills the sandbox). */
  stop: () => Promise<void>;
  /** Add a run figure to the project files (figures/) so it shows in the Files tab. */
  importFigure: (path: string) => Promise<boolean>;
  /** Clear the console + figures. */
  clear: () => void;
  /** Regenerate `% !py` figures, then compile (Run & Compile). */
  runAndCompile: () => Promise<void>;
}

const MAX_SEGMENTS = 5000;
let controller: AbortController | null = null;

function append(stream: 'stdout' | 'stderr', text: string): void {
  useRunStore.setState((s) => {
    const segments = s.segments.length >= MAX_SEGMENTS ? s.segments.slice(-MAX_SEGMENTS + 1) : s.segments.slice();
    segments.push({ stream, text });
    return { segments };
  });
}

/** Stream one run to completion; resolves when the run ends (done or error). */
function runOnce(body: { path?: string; fileId?: string }): Promise<void> {
  const projectId = useEditorStore.getState().projectId;
  if (!projectId) return Promise.resolve();

  controller?.abort();
  controller = new AbortController();

  useRunStore.setState({ running: true, status: 'running', runId: null, script: body.path ?? null, segments: [], exitCode: null, durationMs: null, figures: [] });
  useThesisStore.getState().setBottomTab('python'); // surface the output window

  return streamRun(
    projectId,
    body,
    {
      onStart: (s) => useRunStore.setState({ runId: s.runId, script: s.script }),
      onStdout: (chunk) => append('stdout', chunk),
      onStderr: (chunk) => append('stderr', chunk),
      onDone: (d) => {
        useRunStore.setState({ running: false, status: d.status, exitCode: d.exitCode, durationMs: d.durationMs, figures: d.artifacts });
        // Auto-imported figures/ images are now project files — refresh the Files tab.
        if (d.artifacts.some((a) => a.kind === 'figure')) void useEditorStore.getState().refreshFiles();
      },
      onError: (message) => {
        append('stderr', `\n${message}\n`);
        useRunStore.setState({ running: false, status: 'failed' });
      },
    },
    controller.signal,
  );
}

export const useRunStore = create<RunState>((set, get) => ({
  running: false,
  status: 'idle',
  runId: null,
  script: null,
  segments: [],
  exitCode: null,
  durationMs: null,
  figures: [],
  pickerOpen: false,

  openPicker: () => set({ pickerOpen: true }),
  closePicker: () => set({ pickerOpen: false }),

  runActive() {
    const ed = useEditorStore.getState();
    const activePath = ed.files.find((f) => f.id === ed.activeFileId)?.path;
    const target = ed.projects.find((p) => p.id === ed.projectId)?.pythonRunTarget;
    const path = activePath && activePath.toLowerCase().endsWith('.py') ? activePath : target || undefined;
    if (!path) {
      set({ status: 'failed', segments: [{ stream: 'stderr', text: 'Open a .py file or set a run target in Project settings.\n' }] });
      useThesisStore.getState().setBottomTab('python');
      return;
    }
    void runOnce({ path });
  },

  runPath(path) {
    void runOnce({ path });
  },

  async stop() {
    const projectId = useEditorStore.getState().projectId;
    if (projectId) await api.stopRun(projectId).catch(() => undefined); // server emits the terminal `done`
  },

  async importFigure(path) {
    const projectId = useEditorStore.getState().projectId;
    if (!projectId) return false;
    try {
      await api.importRunArtifact(projectId, path);
      await useEditorStore.getState().refreshFiles(); // surface it in the Files tab
      return true;
    } catch {
      return false;
    }
  },

  clear() {
    set({ segments: [], figures: [], status: get().running ? get().status : 'idle', exitCode: null, durationMs: null });
  },

  async runAndCompile() {
    const ed = useEditorStore.getState();
    if (!ed.projectId) return;
    let scripts: string[] = [];
    try {
      const { links } = await api.getPyFigures(ed.projectId);
      scripts = [...new Set(links.map((l) => l.script))];
    } catch {
      /* fall back below */
    }
    if (scripts.length === 0) {
      const activePath = ed.files.find((f) => f.id === ed.activeFileId)?.path;
      const target = ed.projects.find((p) => p.id === ed.projectId)?.pythonRunTarget;
      const path = activePath && activePath.toLowerCase().endsWith('.py') ? activePath : target || '';
      if (path) scripts = [path];
    }
    // Regenerate each linked figure in turn, then compile (always).
    for (const path of scripts) await runOnce({ path });
    await useEditorStore.getState().compileProject();
  },
}));
