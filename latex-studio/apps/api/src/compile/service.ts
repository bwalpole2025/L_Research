import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type {
  CompileResponse,
  SyncForwardResult,
  SyncInverseResult,
  WordCountResult,
} from '@latex-studio/shared';
import type { AppConfig } from '../config.js';
import { createRunner, type CompileOptions, type ProjectFileInput, type TexliveRunner } from './runner.js';
import { parseLatexLog } from './logParser.js';
import { parseTexcount } from './texcount.js';
import { parseSynctexEdit, parseSynctexView } from './synctexParser.js';
import { CompileQueue } from './queue.js';
import type { ExecutionGate } from '../exec/gate.js';

export interface CompileInput {
  projectId: string;
  rootFile: string;
  files: ProjectFileInput[];
  /** Engine + halt-on-error + draft (from the project's compile settings). */
  options?: CompileOptions;
  /** Owning principal's key, for the shared execution gate (concurrency caps).
   *  Compiles do NOT count against the daily RUN quota. */
  userKey?: string;
}

const SUPERSEDED: CompileResponse = { status: 'superseded', diagnostics: [], durationMs: 0 };

/** Orchestrates staging → latexmk → log parsing, queued one-per-project. */
export class CompileService {
  private readonly queue: CompileQueue<CompileResponse>;
  private readonly runner: TexliveRunner;

  constructor(
    private readonly config: AppConfig,
    runner?: TexliveRunner,
    /** Shared admission gate (global + per-user concurrency). Optional so tests
     *  and internal callers can construct a service without one. */
    private readonly gate?: ExecutionGate,
  ) {
    this.runner = runner ?? createRunner(config);
    // Per-project serialization + latest-wins coalescing is intrinsic to the
    // queue's per-key design; the shared gate (if present) adds the cross-path
    // global + per-user concurrency caps.
    this.queue = new CompileQueue<CompileResponse>(config.compileMaxConcurrent);
  }

  private base(rootFile: string): string {
    return basename(rootFile, extname(rootFile));
  }

  pdfPath(projectId: string, rootFile: string): string {
    return this.runner.artifactPath(projectId, `${this.base(rootFile)}.pdf`);
  }

  /** Host path of the project's working directory (snippet cache lives under it). */
  projectDir(projectId: string): string {
    return this.runner.projectDir(projectId);
  }

  /** Stage ONE auxiliary file (e.g. a standalone snippet) into the workspace. */
  async writeSnippet(projectId: string, relPath: string, content: string): Promise<void> {
    await this.runner.writeFiles(projectId, [{ path: relPath, content }]);
  }

  /** Stage the project's files into the workspace — snippets \usepackage the
   *  project's own .sty files, which must exist on disk even if the project
   *  has never been compiled. */
  async stageFiles(projectId: string, files: ProjectFileInput[]): Promise<void> {
    await this.runner.writeFiles(projectId, files);
  }

  /** Compile a tiny standalone snippet OUTSIDE the per-project queue (snippets
   *  are independent of document compiles and finish in ~1s). */
  async compileSnippet(projectId: string, rootFile: string): Promise<{ ok: boolean; logTail: string }> {
    const result = await this.runner.latexmk(projectId, rootFile);
    return { ok: result.code === 0 && !result.timedOut, logTail: (result.stdout + result.stderr).slice(-6000) };
  }

  synctexPath(projectId: string, rootFile: string): string {
    return this.runner.artifactPath(projectId, `${this.base(rootFile)}.synctex.gz`);
  }

  /** LaTeX-aware word count via texcount (follows \input/\include with -inc).
   *  Stages the project files first so the included files exist on disk. */
  async wordCount(projectId: string, rootFile: string, files: ProjectFileInput[]): Promise<WordCountResult> {
    await this.runner.writeFiles(projectId, files);
    const result = await this.runner.texcount(projectId, ['-inc', '-brief', '-utf8', rootFile]);
    return parseTexcount(result.stdout);
  }

  compile(input: CompileInput): Promise<CompileResponse> {
    return this.queue.submit(input.projectId, () => this.runCompile(input), SUPERSEDED);
  }

  private async runCompile(input: CompileInput): Promise<CompileResponse> {
    const start = Date.now();
    const base = this.base(input.rootFile);

    // Admission gate: global + per-user concurrency (NOT the daily run quota —
    // compile-on-save must never be rejected). Acquired here, after the queue has
    // coalesced/superseded, so only compiles that actually run take a slot.
    const release = this.gate ? await this.gate.acquire(input.userKey ?? 'anon') : null;
    try {
      await this.runner.writeFiles(input.projectId, input.files);
      const result = await this.runner.latexmk(input.projectId, input.rootFile, input.options);

      const logText = await this.readLog(
        input.projectId,
        base,
        `${result.stdout}\n${result.stderr}`,
      );
      const diagnostics = parseLatexLog(logText);
      if (result.timedOut) {
        diagnostics.unshift({
          severity: 'error',
          message: `Compilation timed out after ${Math.round(this.config.compileTimeoutMs / 1000)}s`,
        });
      }

      const durationMs = Date.now() - start;
      const rev = Date.now();
      // RED IS RESERVED FOR "NO PDF CAME OUT". latexmk in nonstop mode often
      // exits non-zero yet still emits a usable PDF (e.g. an undefined control
      // sequence, or a labels-changed rerun) — that run COMPILED, so its `!`
      // entries are demoted to ORANGE (wrong-looking output, not a failure).
      // Freshness (mtime >= run start) guards against a stale PDF from an
      // earlier run masking a genuinely failed one.
      const pdfFresh = await this.artifactFresh(input.projectId, `${base}.pdf`, start);
      const status: CompileResponse['status'] = result.timedOut
        ? 'timeout'
        : result.code === 0 || pdfFresh
          ? 'success'
          : 'error';
      if (status === 'success') {
        for (const d of diagnostics) {
          if (d.severity === 'error') d.severity = 'warning-important';
        }
      }

      const res: CompileResponse = { status, diagnostics, durationMs, log: tail(logText, 20_000) };
      if (await this.artifactExists(input.projectId, `${base}.pdf`)) {
        res.pdfUrl = `/projects/${input.projectId}/pdf?rev=${rev}`;
      }
      if (await this.artifactExists(input.projectId, `${base}.synctex.gz`)) {
        res.synctexUrl = `/projects/${input.projectId}/synctex?rev=${rev}`;
      }
      return res;
    } catch (err) {
      return {
        status: 'error',
        durationMs: Date.now() - start,
        diagnostics: [
          { severity: 'error', message: `Compilation backend error: ${errorMessage(err)}` },
        ],
      };
    } finally {
      release?.();
    }
  }

  async forward(
    projectId: string,
    rootFile: string,
    file: string,
    line: number,
    column = 0,
  ): Promise<SyncForwardResult> {
    const pdf = `${this.base(rootFile)}.pdf`;
    const result = await this.runner.synctex(projectId, [
      'view',
      '-i',
      `${line}:${column}:${file}`,
      '-o',
      pdf,
    ]);
    // synctex `view` reports v as the box BASELINE; the glyph line spans roughly
    // [v - H, v], so the highlight's top-left is (h, v - H).
    const boxes = parseSynctexView(result.stdout).map((r) => ({
      page: r.page,
      x: r.h || r.x,
      y: Math.max(0, (r.v || r.y) - r.H),
      width: r.W,
      height: r.H,
    }));
    return { boxes };
  }

  async inverse(
    projectId: string,
    rootFile: string,
    page: number,
    x: number,
    y: number,
  ): Promise<SyncInverseResult | null> {
    const pdf = `${this.base(rootFile)}.pdf`;
    const result = await this.runner.synctex(projectId, ['edit', '-o', `${page}:${x}:${y}:${pdf}`]);
    const rec = parseSynctexEdit(result.stdout);
    if (!rec) return null;
    return { file: this.toProjectRelative(projectId, rec.file), line: rec.line, column: rec.column };
  }

  /** Strip the host/container workspace prefix from a synctex Input path. */
  private toProjectRelative(projectId: string, p: string): string {
    const hostDir = this.runner.projectDir(projectId);
    const containerDir = `${this.config.texliveWorkspace}/${projectId}`;
    let rel = p;
    if (rel.startsWith(hostDir)) rel = rel.slice(hostDir.length);
    else if (rel.startsWith(containerDir)) rel = rel.slice(containerDir.length);
    return rel.replace(/^\/+/, '').replace(/^\.\//, '');
  }

  private async readLog(projectId: string, base: string, fallback: string): Promise<string> {
    try {
      return await readFile(this.runner.artifactPath(projectId, `${base}.log`), 'utf8');
    } catch {
      return fallback;
    }
  }

  private async artifactExists(projectId: string, rel: string): Promise<boolean> {
    try {
      return (await stat(this.runner.artifactPath(projectId, rel))).isFile();
    } catch {
      return false;
    }
  }

  /** The artifact exists AND was (re)written by the current run. */
  private async artifactFresh(projectId: string, rel: string, sinceMs: number): Promise<boolean> {
    try {
      const st = await stat(this.runner.artifactPath(projectId, rel));
      return st.isFile() && st.mtimeMs >= sinceMs;
    } catch {
      return false;
    }
  }
}

function tail(text: string, max: number): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
