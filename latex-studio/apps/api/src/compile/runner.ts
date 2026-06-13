import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AppConfig } from '../config.js';
import { runProcess, type SpawnResult } from './spawn.js';

export interface ProjectFileInput {
  path: string;
  content: string;
  /** "utf8" (default) or "base64" for binary files (figures, fonts, PDFs). */
  encoding?: string;
}

/** TeX engine choice → the matching latexmk engine flag. */
export type TexEngine = 'pdflatex' | 'xelatex' | 'lualatex';

/** Per-compile options (from the project's compile settings). */
export interface CompileOptions {
  engine?: TexEngine;
  /** Stop at the first error (latexmk -halt-on-error) instead of recovering. */
  haltOnError?: boolean;
  /** Skip image rendering for a faster preview (graphicx draft option). */
  draftMode?: boolean;
}

export interface TexliveRunner {
  /** Host filesystem path of a project's compile working dir. */
  projectDir(projectId: string): string;
  /** Host filesystem path of an artifact within a project's working dir. */
  artifactPath(projectId: string, relPath: string): string;
  /** Stage the project's files into its working dir. */
  writeFiles(projectId: string, files: ProjectFileInput[]): Promise<void>;
  /** Run latexmk against the root file (pdfLaTeX, recovering, full render by default). */
  latexmk(projectId: string, rootFile: string, options?: CompileOptions): Promise<SpawnResult>;
  /** Run the synctex CLI with the given args in the project working dir. */
  synctex(projectId: string, args: string[]): Promise<SpawnResult>;
  /** Run texcount with the given args in the project working dir. */
  texcount(projectId: string, args: string[]): Promise<SpawnResult>;
}

const ENGINE_FLAG: Record<TexEngine, string> = { pdflatex: '-pdf', xelatex: '-pdfxe', lualatex: '-pdflua' };

/** Build the latexmk flag list for the given engine + options. The base flags
 *  (nonstop interaction, SyncTeX, file-line errors) are always present so the
 *  PDF viewer's SyncTeX and the diagnostics parser keep working. */
export function latexmkFlags(options: CompileOptions = {}): string[] {
  const engine: TexEngine = options.engine && options.engine in ENGINE_FLAG ? options.engine : 'pdflatex';
  const flags = [ENGINE_FLAG[engine], '-interaction=nonstopmode', '-synctex=1', '-file-line-error'];
  // -halt-on-error stops at the first error even under nonstopmode (which only
  // means "don't pause for keyboard input") — Overleaf's stop-on-first-error.
  if (options.haltOnError) flags.push('-halt-on-error');
  // Draft: queue the graphicx draft option before \input so images are boxed,
  // not rendered — a faster preview. -usepretex sets + enables the pre-TeX code.
  if (options.draftMode) flags.push('-usepretex=\\PassOptionsToPackage{draft}{graphicx}');
  return flags;
}

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
      await writeFile(dest, Buffer.from(f.content, f.encoding === 'base64' ? 'base64' : 'utf8'));
    }
  }

  function latexmk(projectId: string, rootFile: string, options?: CompileOptions): Promise<SpawnResult> {
    const timeoutMs = config.compileTimeoutMs;
    const flags = latexmkFlags(options);
    if (config.texliveMode === 'local') {
      return runProcess('latexmk', [...flags, rootFile], {
        cwd: projectDir(projectId),
        timeoutMs,
        killGroup: true,
      });
    }
    // docker: wrap in an in-container `timeout` so the TeX engine is actually
    // killed; the host-side spawn gets a slightly longer backstop timeout.
    const secs = Math.ceil(timeoutMs / 1000);
    const inner = ['timeout', '-k', '5', String(secs), 'latexmk', ...flags, rootFile]
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

  function texcount(projectId: string, args: string[]): Promise<SpawnResult> {
    if (config.texliveMode === 'local') {
      return runProcess('texcount', args, { cwd: projectDir(projectId), timeoutMs: 20_000 });
    }
    return runProcess(
      'docker',
      ['exec', '-w', containerDir(projectId), config.texliveContainer, 'texcount', ...args],
      { timeoutMs: 20_000 },
    );
  }

  return {
    projectDir,
    artifactPath: (projectId, relPath) => join(projectDir(projectId), relPath),
    writeFiles,
    latexmk,
    synctex,
    texcount,
  };
}

/** Quote an argument for a POSIX `sh -lc` command line. */
function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}
