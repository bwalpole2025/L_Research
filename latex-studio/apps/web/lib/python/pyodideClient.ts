'use client';

import type { RunArtifact, RunStatus } from '@latex-studio/shared';

/** A project file staged into the in-browser FS for a client-side run. */
export interface BrowserRunFile {
  path: string;
  content: string;
  encoding: 'utf8' | 'base64';
}

/** Handlers mirror streamRun's, so runStore can drive either path identically. */
export interface BrowserRunHandlers {
  onStart: (s: { runId: string; script: string }) => void;
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  onDone: (d: { status: RunStatus; exitCode: number | null; durationMs: number; artifacts: RunArtifact[] }) => void;
  onError: (message: string) => void;
}

export interface BrowserRunOptions {
  runId: string;
  script: string;
  args: string[];
  files: BrowserRunFile[];
  /** Wall-clock cap; the worker is terminated and the run reported timed-out. */
  timeoutMs: number;
}

type WorkerMessage =
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  | { type: 'figure'; name: string; dataUrl: string }
  | { type: 'done'; status: RunStatus; exitCode: number | null }
  | { type: 'error'; message: string };

/**
 * Run Python in the browser via the Pyodide worker. Resolves when the run ends
 * (done / error / timeout / abort). Aborting `signal` terminates the worker
 * (the equivalent of "stop"). Never throws — failures arrive via handlers.onError.
 */
export function runInBrowser(opts: BrowserRunOptions, handlers: BrowserRunHandlers, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    const figures: RunArtifact[] = [];
    let settled = false;

    let worker: Worker;
    try {
      worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url));
    } catch {
      handlers.onError('Could not start the in-browser Python runtime. Switch to server-side Run in the Python panel.');
      handlers.onDone({ status: 'failed', exitCode: null, durationMs: 0, artifacts: [] });
      resolve();
      return;
    }

    const finish = (status: RunStatus, exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      handlers.onDone({ status, exitCode, durationMs: Date.now() - start, artifacts: figures });
      resolve();
    };

    const timer = setTimeout(() => finish('timed-out', null), opts.timeoutMs);
    const onAbort = (): void => finish('stopped', null);
    signal?.addEventListener('abort', onAbort);

    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const m = ev.data;
      switch (m.type) {
        case 'stdout':
          handlers.onStdout(m.chunk);
          break;
        case 'stderr':
          handlers.onStderr(m.chunk);
          break;
        case 'figure':
          // Self-contained data URL — displayable directly (api.runArtifactUrl
          // passes data: URLs through). kind 'scratch' ⇒ not auto-added to files.
          figures.push({ name: m.name, path: `browser/${m.name}`, url: m.dataUrl, previewUrl: m.dataUrl, kind: 'scratch' });
          break;
        case 'error':
          handlers.onError(m.message);
          break;
        case 'done':
          finish(m.status, m.exitCode);
          break;
      }
    };
    worker.onerror = (e) => {
      handlers.onError(e.message || 'In-browser Python failed.');
      finish('failed', null);
    };

    handlers.onStart({ runId: opts.runId, script: opts.script });
    worker.postMessage({ type: 'run', script: opts.script, args: opts.args, files: opts.files });
  });
}
