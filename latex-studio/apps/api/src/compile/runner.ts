import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../config.js';
import { runProcess, type SpawnResult } from './spawn.js';

export interface ProjectFileInput {
  path: string;
  content: string;
}

export interface TexliveRunner {
  /** Host filesystem path of a project's compile working dir. */
  projectDir(projectId: string): string;
  /** Host filesystem path of an artifact within a project's working dir. */
  artifactPath(projectId: string, relPath: string): string;
  /** Stage the project's files into its working dir. */
  writeFiles(projectId: string, files: ProjectFileInput[]): Promise<void>;
  /** Run latexmk against the root file. */
  latexmk(projectId: string, rootFile: string): Promise<SpawnResult>;
  /** Run the synctex CLI with the given args in the project working dir. */
  synctex(projectId: string, args: string[]): Promise<SpawnResult>;
}

const LATEXMK_FLAGS = ['-pdf', '-interaction=nonstopmode', '-synctex=1', '-file-line-error'];

/**
 * Build the runner that stages files and executes latexmk/synctex either by
 * `docker exec`-ing into the texlive container (docker mode) or by spawning the
 * binaries directly (local mode). File IO is always on the host fs, which in
 * docker mode is the same bind-mounted directory texlive sees at /workspace.
 */
export function createRunner(config: AppConfig): TexliveRunner {
  const projectDir = (projectId: string) => join(config.compileWorkspace, projectId);
  const containerDir = (projectId: string) => `${config.texliveWorkspace}/${projectId}`;

  async function writeFiles(projectId: string, files: ProjectFileInput[]): Promise<void> {
    const dir = projectDir(projectId);
    await mkdir(dir, { recursive: true });
    for (const f of files) {
      const dest = join(dir, f.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, f.content, 'utf8');
    }
  }

  function latexmk(projectId: string, rootFile: string): Promise<SpawnResult> {
    const timeoutMs = config.compileTimeoutMs;
    if (config.texliveMode === 'local') {
      return runProcess('latexmk', [...LATEXMK_FLAGS, rootFile], {
        cwd: projectDir(projectId),
        timeoutMs,
        killGroup: true,
      });
    }
    // docker: wrap in an in-container `timeout` so the TeX engine is actually
    // killed; the host-side spawn gets a slightly longer backstop timeout.
    const secs = Math.ceil(timeoutMs / 1000);
    const inner = ['timeout', '-k', '5', String(secs), 'latexmk', ...LATEXMK_FLAGS, rootFile]
      .map(shellQuote)
      .join(' ');
    return runProcess(
      'docker',
      ['exec', '-w', containerDir(projectId), config.texliveContainer, 'sh', '-lc', inner],
      { timeoutMs: timeoutMs + 10_000 },
    );
  }

  function synctex(projectId: string, args: string[]): Promise<SpawnResult> {
    if (config.texliveMode === 'local') {
      return runProcess('synctex', args, { cwd: projectDir(projectId), timeoutMs: 15_000 });
    }
    return runProcess(
      'docker',
      ['exec', '-w', containerDir(projectId), config.texliveContainer, 'synctex', ...args],
      { timeoutMs: 15_000 },
    );
  }

  return {
    projectDir,
    artifactPath: (projectId, relPath) => join(projectDir(projectId), relPath),
    writeFiles,
    latexmk,
    synctex,
  };
}

/** Quote an argument for a POSIX `sh -lc` command line. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
