import { spawn } from 'node:child_process';

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SpawnOptions {
  cwd?: string;
  timeoutMs?: number;
  /**
   * When true, start the child in its own process group and kill the whole
   * group on timeout (so latexmk's pdflatex children die too). Use for local
   * spawns; docker mode relies on an in-container `timeout` instead.
   */
  killGroup?: boolean;
}

const MAX_OUTPUT = 4 * 1024 * 1024; // cap captured output at 4MB

/** Spawn a process, capture stdout/stderr, and enforce a hard timeout. */
export function runProcess(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: options.killGroup === true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const append = (buf: Buffer, target: 'out' | 'err') => {
      const text = buf.toString('utf8');
      if (target === 'out') {
        if (stdout.length < MAX_OUTPUT) stdout += text;
      } else if (stderr.length < MAX_OUTPUT) {
        stderr += text;
      }
    };

    child.stdout.on('data', (b: Buffer) => append(b, 'out'));
    child.stderr.on('data', (b: Buffer) => append(b, 'err'));

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        kill(child.pid, options.killGroup === true);
      }, options.timeoutMs);
    }

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on('error', (err) => {
      stderr += `\n${String(err)}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

function kill(pid: number | undefined, group: boolean): void {
  if (pid === undefined) return;
  try {
    if (group) {
      // Negative pid → signal the whole process group.
      process.kill(-pid, 'SIGKILL');
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
}
