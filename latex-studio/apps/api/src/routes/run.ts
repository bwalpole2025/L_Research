import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { validateFilePath } from '../lib/paths.js';
import { RunManager } from '../run/manager.js';
import { figuresDir, projectDir, pyoutDir, stageFiles, writeBootstrap } from '../run/runner.js';
import {
  collectNewFigures,
  collectScratchArtifacts,
  importFigures,
  snapshotFigures,
  toArtifact,
} from '../run/artifacts.js';
import { parsePyFigureLinks } from '../run/pyfigures.js';
import { QuotaExceededError } from '../exec/gate.js';
import { principalKey } from '../auth/principal.js';

const runBody = z.object({
  fileId: z.string().optional(),
  path: z.string().max(512).optional(),
  args: z.array(z.string().max(512)).max(64).optional(),
});

const importBody = z.object({ path: z.string().min(1).max(512) });

/** A run artefact path is only servable/importable from the run's own output areas. */
function isArtifactPath(rel: string): boolean {
  return (rel.startsWith('figures/') || rel.startsWith('.pyout/')) && !rel.includes('..') && !rel.includes('\\');
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot === -1 ? '' : CONTENT_TYPES[name.slice(dot).toLowerCase()]) || 'application/octet-stream';
}

async function sendFile(reply: FastifyReply, path: string, contentType: string): Promise<FastifyReply> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return reply.code(404).send({ error: 'Artifact not found' });
  }
  if (!info.isFile()) return reply.code(404).send({ error: 'Artifact not found' });
  reply.header('content-type', contentType);
  reply.header('content-length', info.size);
  reply.header('cache-control', 'no-store');
  return reply.send(createReadStream(path));
}

export async function runRoutes(app: FastifyInstance): Promise<void> {
  const manager = new RunManager(app.config);

  // Execute a project's Python and STREAM stdout/stderr back over SSE. Separate
  // from compilation; runs in the sandbox (see run/runner.ts + ADR-013).
  app.post<{ Params: { id: string } }>('/projects/:id/run', async (request, reply) => {
    const project = request.project!;

    const parsed = runBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    // Resolve which .py to run: explicit path/fileId → project run target → error.
    let scriptPath: string | undefined = parsed.data.path;
    if (!scriptPath && parsed.data.fileId) {
      const f = await app.prisma.texFile.findUnique({ where: { id: parsed.data.fileId }, select: { path: true, projectId: true } });
      if (!f || f.projectId !== project.id) return reply.code(404).send({ error: 'File not found in this project' });
      scriptPath = f.path;
    }
    if (!scriptPath) scriptPath = project.pythonRunTarget || undefined;
    if (!scriptPath) return reply.code(400).send({ error: 'No Python file to run — open a .py file or set a run target.' });
    if (!scriptPath.toLowerCase().endsWith('.py')) return reply.code(400).send({ error: 'Run target must be a .py file.' });
    const valid = validateFilePath(scriptPath);
    if (!valid.ok) return reply.code(400).send({ error: valid.error });

    const files = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    if (!files.some((f) => f.path === scriptPath)) return reply.code(404).send({ error: `No such file: ${scriptPath}` });

    // Admission gate: per-user concurrency + the per-user DAILY RUN quota (the
    // arbitrary-code / "miner" vector). A quota-exhausted user is rejected with
    // 429 before any sandbox work starts; over the concurrency cap they wait.
    let release: (() => void) | null = null;
    try {
      release = await app.execGate.acquire(principalKey(request.principal), { countsAsRun: true });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return reply.code(429).header('retry-after', String(err.retryAfterSeconds)).send({ error: err.message });
      }
      throw err;
    }

    const runId = randomUUID();
    await stageFiles(app.config, project.id, files);
    await mkdir(figuresDir(app.config, project.id), { recursive: true });
    await mkdir(pyoutDir(app.config, project.id, runId), { recursive: true });
    await writeBootstrap(app.config, project.id, runId); // launcher that captures plt.show() output
    const before = await snapshotFigures(app.config, project.id);

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const sse = (event: string, data: unknown): void => {
      try {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* socket closed */
      }
    };

    sse('start', { runId, script: scriptPath });

    const { done } = manager.start(
      { projectId: project.id, runId, scriptPath, args: parsed.data.args ?? [], networkEnabled: project.networkEnabled },
      { onStdout: (chunk) => sse('stdout', { chunk }), onStderr: (chunk) => sse('stderr', { chunk }) },
    );
    // Client disconnect (closed tab / aborted fetch) cancels the run.
    request.raw.on('close', () => manager.stop(project.id));

    try {
      const outcome = await done;
      // Capture figures: import new ones into the project (so Compile sees them),
      // and list scratch images for the output window.
      const rev = Date.now();
      const newFigs = await collectNewFigures(app.config, project.id, before);
      await importFigures(app.prisma, project.id, newFigs);
      const scratch = await collectScratchArtifacts(app.config, project.id, runId);
      const artifacts = [
        ...newFigs.map((f) => toArtifact(project.id, f.relPath, 'figure', rev)),
        ...scratch.map((s) => toArtifact(project.id, s.path, 'scratch', rev, s.previewPath)),
      ];
      sse('done', { ...outcome, artifacts });
    } catch (err) {
      sse('done', { status: 'failed', exitCode: null, durationMs: 0, artifacts: [], error: String(err) });
    } finally {
      release?.(); // free the admission slot for the next queued run
      raw.end();
    }
  });

  // Stop the project's running script (kills the process group / container).
  app.post<{ Params: { id: string } }>('/projects/:id/run/stop', async (request) => {
    const project = request.project!;
    return { stopped: manager.stop(project.id) };
  });

  // Serve a run artefact (figure or scratch image) from the workspace.
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/projects/:id/run-artifact', async (request, reply) => {
    const project = request.project!;
    const rel = request.query.path ?? '';
    // Only the run's own output areas are servable; reject traversal.
    if (!isArtifactPath(rel)) {
      return reply.code(400).send({ error: 'Invalid artifact path' });
    }
    const full = join(projectDir(app.config, project.id), rel);
    return sendFile(reply, full, contentTypeFor(rel));
  });

  // Add a run artefact (a figure or a scratch image from the output window) to the
  // project's files, under figures/, so it shows in the Files tab and is usable
  // from LaTeX via \includegraphics. Figures already live in figures/ (idempotent);
  // scratch images (e.g. captured plt.show() output) are copied there.
  app.post<{ Params: { id: string }; Body: { path?: string } }>('/projects/:id/run-artifact/import', async (request, reply) => {
    const project = request.project!;
    const parsed = importBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    const rel = parsed.data.path;
    if (!isArtifactPath(rel)) return reply.code(400).send({ error: 'Invalid artifact path' });

    // Destination in the project: figures keep their path; scratch images land in figures/.
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    const dest = rel.startsWith('figures/') ? rel : `figures/${base}`;
    const destCheck = validateFilePath(dest);
    if (!destCheck.ok) return reply.code(400).send({ error: destCheck.error });

    let content: string;
    try {
      content = (await readFile(join(projectDir(app.config, project.id), rel))).toString('base64');
    } catch {
      return reply.code(404).send({ error: 'Artifact not found' });
    }
    const file = await app.prisma.texFile.upsert({
      where: { projectId_path: { projectId: project.id, path: dest } },
      update: { content, encoding: 'base64' },
      create: { projectId: project.id, path: dest, content, encoding: 'base64' },
    });
    return { id: file.id, projectId: file.projectId, path: file.path, encoding: file.encoding, updatedAt: file.updatedAt.toISOString() };
  });

  // The `% !py <script> -> <output>` figure links across the project's .tex files.
  app.get<{ Params: { id: string } }>('/projects/:id/pyfigures', async (request) => {
    const project = request.project!;
    const texFiles = await app.prisma.texFile.findMany({
      where: { projectId: project.id, path: { endsWith: '.tex' } },
      select: { content: true },
    });
    return { links: parsePyFigureLinks(texFiles.map((f) => f.content)) };
  });
}
