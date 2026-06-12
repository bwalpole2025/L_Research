import { spawn } from 'node:child_process';

/**
 * A minimal subprocess runner, abstracted so the CLI model providers are unit
 * testable without the real `codex`/`gemini` binaries installed. Streams stdout
 * to `onStdout` as it arrives and resolves with the captured output + exit code.
 */
export interface CliRunOptions {
  input?: string;
  signal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface CliRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the binary was not found on PATH (ENOENT). */
  notFound: boolean;
}

export type CliRunner = (command: string, args: string[], opts?: CliRunOptions) => Promise<CliRunResult>;

/** The real runner, backed by child_process.spawn. */
export const runCli: CliRunner = (command, args, opts = {}) =>
  new Promise<CliRunResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { env: opts.env ?? process.env });
    } catch {
      resolve({ code: null, stdout: '', stderr: '', notFound: true });
      return;
    }

    let stdout = '';
    let stderr = '';
    let notFound = false;

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      opts.onStdout?.(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') notFound = true;
      resolve({ code: null, stdout, stderr: stderr || String(err), notFound });
    });
    child.on('close', (code) => resolve({ code, stdout, stderr, notFound }));

    if (opts.signal) {
      if (opts.signal.aborted) child.kill('SIGTERM');
      else opts.signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
    }
    if (opts.input !== undefined) {
      child.stdin?.write(opts.input);
      child.stdin?.end();
    }
  });
