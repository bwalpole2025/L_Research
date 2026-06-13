import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { validateFilePath } from '../lib/paths.js';
import { resolveModelProvider } from '../providers/registry.js';
import { checkPython } from '../pythoncheck/service.js';
import type { ProjectFileInput } from '../compile/runner.js';

const body = z.object({
  fileId: z.string().optional(),
  path: z.string().max(512).optional(),
  /** Live editor buffers (unsaved) keyed by project-relative path. */
  overrides: z.record(z.string()).optional(),
});

export async function pythonCheckRoutes(app: FastifyInstance): Promise<void> {
  // AI + deterministic error check for a single Python file (see pythoncheck/service.ts).
  app.post<{ Params: { id: string } }>('/projects/:id/python-check', async (request, reply) => {
    const project = request.project!;

    const parsed = body.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    // Resolve which .py to check: explicit path/fileId → project run target.
    let scriptPath: string | undefined = parsed.data.path;
    if (!scriptPath && parsed.data.fileId) {
      const f = await app.prisma.texFile.findUnique({ where: { id: parsed.data.fileId }, select: { path: true, projectId: true } });
      if (!f || f.projectId !== project.id) return reply.code(404).send({ error: 'File not found in this project' });
      scriptPath = f.path;
    }
    if (!scriptPath) scriptPath = project.pythonRunTarget || undefined;
    if (!scriptPath) return reply.code(400).send({ error: 'No Python file to check — open a .py file or set a run target.' });
    if (!scriptPath.toLowerCase().endsWith('.py')) return reply.code(400).send({ error: 'Check target must be a .py file.' });
    const valid = validateFilePath(scriptPath);
    if (!valid.ok) return reply.code(400).send({ error: valid.error });

    // Load DB files, then overlay live editor buffers (so unsaved edits are checked).
    const dbFiles = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    const overrides = parsed.data.overrides ?? {};
    const files: ProjectFileInput[] = dbFiles.map((f) =>
      overrides[f.path] !== undefined ? { path: f.path, content: overrides[f.path]!, encoding: 'utf8' } : f,
    );
    for (const [p, content] of Object.entries(overrides)) {
      if (!files.some((f) => f.path === p)) files.push({ path: p, content, encoding: 'utf8' });
    }
    const target = files.find((f) => f.path === scriptPath);
    if (!target) return reply.code(404).send({ error: `No such file: ${scriptPath}` });
    const source = target.encoding === 'base64' ? Buffer.from(target.content, 'base64').toString('utf8') : target.content;

    const ac = new AbortController();
    request.raw.on('close', () => ac.abort());

    const { provider, model } = await resolveModelProvider(app, project);
    try {
      return await checkPython(
        { config: app.config, modelProvider: provider, model },
        project.id,
        scriptPath,
        files,
        source,
        ac.signal,
      );
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Python check failed' });
    }
  });
}
