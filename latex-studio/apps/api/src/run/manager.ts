import type { AppConfig } from '../config.js';
import type { RunStatus } from '@latex-studio/shared';
import { buildRunPlan, type RunPlanInput } from './runner.js';
import { fireAndForget, streamProcess, type StreamHandlers } from './spawn.js';

/**
 * Owns the lifecycle of Python runs: ONE per project at a time. A new run
 * supersedes (kills) the project's in-flight run; `stop` cancels it; a host-side
 * timer is the authoritative wall-clock timeout (the in-container `timeout` is a
 * longer backstop). The container is killed by name; the host process is killed
 * too so the stream closes promptly.
 */

export interface RunOutcome {
  status: RunStatus;
  exitCode: number | null;
  durationMs: number;
}

interface ActiveRun {
  cancel: () => void;
}

export class RunManager {
  private readonly active = new Map<string, ActiveRun>();

  constructor(private readonly config: AppConfig) {}

  isRunning(projectId: string): boolean {
    return this.active.has(projectId);
  }

  /** Start a run, superseding any in-flight run for the same project. */
  start(input: RunPlanInput, handlers: StreamHandlers): { runId: string; done: Promise<RunOutcome> } {
    this.active.get(input.projectId)?.cancel(); // supersede the previous run

    const plan = buildRunPlan(this.config, input);
    const startedAt = Date.now();
    let cancelled = false;
    let timedOut = false;

    const proc = streamProcess(plan.command, plan.argv, handlers, {
      killGroup: plan.killGroup,
      ...(plan.cwd ? { cwd: plan.cwd } : {}),
      ...(plan.env ? { env: plan.env } : {}),
    });

    const killNow = (): void => {
      if (plan.containerName) fireAndForget('docker', ['kill', plan.containerName]);
      proc.kill();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killNow();
    }, this.config.pyrunTimeoutMs);

    this.active.set(input.projectId, {
      cancel: () => {
        cancelled = true;
        killNow();
      },
    });

    const done = proc.done.then(({ code }): RunOutcome => {
      clearTimeout(timer);
      this.active.delete(input.projectId);
      const status: RunStatus = cancelled ? 'stopped' : timedOut ? 'timed-out' : code === 0 ? 'success' : 'failed';
      return { status, exitCode: code, durationMs: Date.now() - startedAt };
    });

    return { runId: input.runId, done };
  }

  /** Cancel the project's active run, if any. Returns true if one was running. */
  stop(projectId: string): boolean {
    const run = this.active.get(projectId);
    if (!run) return false;
    run.cancel();
    return true;
  }
}
