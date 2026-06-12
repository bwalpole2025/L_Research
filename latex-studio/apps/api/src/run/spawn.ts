import { spawn } from 'node:child_process';

export interface StreamHandlers {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
}

export interface StreamOptions {
  cwd?: string;
  /** Extra env vars merged over the parent's (used by `local` mode). */
  env?: Record<string, string>;
  /**
   * Start the child in its own process group and kill the whole group on `kill()`
   * (so a script's children die too). Used for the host-python `local` mode; the
   * `docker` path kills the container by name instead.
   */
  killGroup?: boolean;
}

export interface StreamHandle {
  /** Resolves when the process exits (or errors). */
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** SIGKILL the process (group). Idempotent. */
  kill: () => void;
  pid: number | undefined;
}

const MAX_CHUNK = 256 * 1024; // never forward an absurd single chunk

/**
 * Spawn a process and STREAM its stdout/stderr to callbacks as they arrive
 * (unlike compile/spawn.ts, which buffers and returns at the end). Used to pipe a
 * Python run's output live over SSE.
 */
export function streamProcess(command: string, args: string[], handlers: StreamHandlers, options: StreamOptions = {}): StreamHandle {
  const child = spawn(command, args, {
    cwd: options.cwd,
    detached: options.killGroup === true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c: string) => handlers.onStdout(c.length > MAX_CHUNK ? c.slice(0, MAX_CHUNK) : c));
  child.stderr.on('data', (c: string) => handlers.onStderr(c.length > MAX_CHUNK ? c.slice(0, MAX_CHUNK) : c));

  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on('error', (err) => {
      handlers.onStderr(`\n${String(err)}\n`);
      resolve({ code: null, signal: null });
    });
    child.on('close', (code, signal) => resolve({ code, signal }));
  });

  const kill = (): void => {
    if (child.pid === undefined) return;
    try {
      if (options.killGroup) process.kill(-child.pid, 'SIGKILL');
      else process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };

  return { done, kill, pid: child.pid };
}

/** Fire-and-forget a short command (e.g. `docker kill`), ignoring its outcome. */
export function fireAndForget(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    /* ignore */
  }
}
