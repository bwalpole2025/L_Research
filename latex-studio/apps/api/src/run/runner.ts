import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../config.js';
import type { ProjectFileInput } from '../compile/runner.js';

/**
 * Builds the command that executes a project's Python and the host paths the run
 * reads/writes. In `docker` mode (default) each run is a fresh `docker run --rm`
 * from the pyrun image — non-root, resource/time-limited, network off by default,
 * with the project source mounted READ-ONLY and only `figures/` + the run's
 * `.pyout/<runId>/` scratch writable. In `local` mode it spawns host `python3`
 * directly (DEV/TEST ONLY, not sandboxed — see ADR-013).
 */

export interface RunPlanInput {
  projectId: string;
  runId: string;
  /** Project-relative path of the .py to run. */
  scriptPath: string;
  args: string[];
  networkEnabled: boolean;
}

export interface RunPlan {
  command: string;
  argv: string[];
  cwd?: string;
  killGroup: boolean;
  /** docker container name to `docker kill` on stop (null in local mode). */
  containerName: string | null;
}

/** Host dir holding the project's staged files (shared with compile). */
export function projectDir(config: AppConfig, projectId: string): string {
  return join(config.compileWorkspace, projectId);
}

export function figuresDir(config: AppConfig, projectId: string): string {
  return join(projectDir(config, projectId), 'figures');
}

export function pyoutDir(config: AppConfig, projectId: string, runId: string): string {
  return join(projectDir(config, projectId), '.pyout', runId);
}

/** Stage the project's DB files onto the workspace (same layout compile uses). */
export async function stageFiles(config: AppConfig, projectId: string, files: ProjectFileInput[]): Promise<void> {
  const dir = projectDir(config, projectId);
  await mkdir(dir, { recursive: true });
  for (const f of files) {
    const dest = join(dir, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'));
  }
}

export function buildRunPlan(config: AppConfig, input: RunPlanInput): RunPlan {
  const { projectId, runId, scriptPath, args, networkEnabled } = input;

  if (config.pyrunMode === 'local') {
    // Not sandboxed. Timeout + group-kill are enforced host-side by the manager.
    return { command: 'python3', argv: [scriptPath, ...args], cwd: projectDir(config, projectId), killGroup: true, containerName: null };
  }

  // docker: in-container `timeout` is a backstop (longer than the host timer, the
  // authoritative one). The whole container is killed by name on stop/supersede.
  const backstopSecs = Math.ceil(config.pyrunTimeoutMs / 1000) + 10;
  const inner = ['timeout', '-s', 'KILL', String(backstopSecs), 'python', scriptPath, ...args].map(shellQuote).join(' ');
  const projHost = join(config.pyrunWorkspaceHost, projectId);
  const containerName = `pyrun-${projectId}-${runId}`;
  const argv = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    networkEnabled ? 'bridge' : 'none',
    `--cpus=${config.pyrunCpus}`,
    `--memory=${config.pyrunMemory}`,
    `--pids-limit=${config.pyrunPids}`,
    '--user',
    config.pyrunUser,
    '-e',
    'MPLBACKEND=Agg',
    '-e',
    'PYTHONUNBUFFERED=1',
    // Project source READ-ONLY; only figures/ and this run's scratch are writable.
    '-v',
    `${projHost}:/workspace:ro`,
    '-v',
    `${join(projHost, 'figures')}:/workspace/figures:rw`,
    '-v',
    `${join(projHost, '.pyout', runId)}:/workspace/.pyout/${runId}:rw`,
    '-w',
    '/workspace',
    config.pyrunImage,
    'sh',
    '-lc',
    inner,
  ];
  return { command: 'docker', argv, killGroup: false, containerName };
}

/** Quote an argument for a POSIX `sh -lc` command line. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
