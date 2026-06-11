import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { MathCounterexample, PreSubmitSummary, ProseRuleToggles } from '@latex-studio/shared';
import { classifyAiError } from '../providers/index.js';
import { errorText } from '../providers/errors.js';
import { markAiError, markAiOk } from '../ai/status.js';
import { auditMaths } from '../audit/service.js';
import { parseProject } from '../thesis/parse.js';
import { DEFAULT_PROSE_RULES, checkProse } from '../prose/check.js';
import { windowAroundLine } from '../ai/context.js';

interface FileRow {
  path: string;
  content: string;
  encoding: string;
}

async function loadProjectFiles(
  app: FastifyInstance,
  projectId: string,
  overrides?: Record<string, string>,
): Promise<FileRow[]> {
  const files = await app.prisma.texFile.findMany({
    where: { projectId },
    select: { path: true, content: true, encoding: true },
  });
  const map = new Map<string, FileRow>(
    files.map((f) => [f.path, { path: f.path, content: f.content, encoding: f.encoding }]),
  );
  // Overrides are live text buffers from the editor (never binary).
  if (overrides) for (const [path, content] of Object.entries(overrides)) map.set(path, { path, content, encoding: 'utf8' });
  return [...map.values()];
}

/** Text files only — drop uploaded binaries (figures/fonts) from text analysis. */
function textFiles(files: FileRow[]): FileRow[] {
  return files.filter((f) => f.encoding !== 'base64');
}

function formatCounterexample(c: MathCounterexample): string {
  const vals = Object.entries(c.values)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  return `${vals ? `${vals}: ` : ''}lhs=${c.lhsVal}, rhs=${c.rhsVal}`;
}

const overridesSchema = z.record(z.string(), z.string()).optional();

const auditBody = z.object({
  scope: z.enum(['file', 'project']),
  fileId: z.string().optional(),
  overrides: overridesSchema,
});

const thesisBody = z.object({ overrides: overridesSchema });

const proseBody = z.object({
  scope: z.enum(['file', 'project']),
  fileId: z.string().optional(),
  rules: z
    .object({
      spelling: z.boolean(),
      enGbConsistency: z.boolean(),
      hyphenation: z.boolean(),
      doubleSpace: z.boolean(),
      quotes: z.boolean(),
      languageTool: z.boolean(),
    })
    .partial()
    .optional(),
  overrides: overridesSchema,
});

const dictionaryBody = z.object({
  word: z.string().trim().min(1).max(80),
  remove: z.boolean().optional(),
});

const explainBody = z.object({
  latex: z.string().min(1).max(4000),
  previousLatex: z.string().max(4000).optional(),
  method: z.string().max(200).optional(),
  counterexample: z
    .object({
      values: z.record(z.string(), z.union([z.number(), z.string()])),
      lhsVal: z.union([z.number(), z.string()]),
      rhsVal: z.union([z.number(), z.string()]),
    })
    .optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  overrides: overridesSchema,
});

/** Pull macro/notation definitions out of the project's text files (capped). */
function collectMacroDefs(files: FileRow[], cap = 4000): string {
  const re = /^\s*\\(?:re|provide)?newcommand\*?|^\s*\\def\b|^\s*\\DeclareMathOperator\*?|^\s*\\let\b/;
  const out: string[] = [];
  let size = 0;
  for (const f of files) {
    if (f.encoding === 'base64' || !/\.(tex|sty)$/.test(f.path)) continue;
    for (const raw of f.content.split('\n')) {
      const line = raw.trim();
      if (line && re.test(line)) {
        if (size + line.length > cap) return out.join('\n');
        out.push(line);
        size += line.length + 1;
      }
    }
  }
  return out.join('\n');
}

export async function thesisRoutes(app: FastifyInstance): Promise<void> {
  // ── Feature 1: chapter/project maths audit ──────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/audit-maths', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = auditBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    let files = (await loadProjectFiles(app, project.id, parsed.data.overrides)).filter((f) =>
      f.path.endsWith('.tex'),
    );
    if (parsed.data.scope === 'file' && parsed.data.fileId) {
      const target = await app.prisma.texFile.findFirst({
        where: { id: parsed.data.fileId, projectId: project.id },
      });
      if (target) files = files.filter((f) => f.path === target.path);
    }

    const macros = (project.macros as Record<string, string> | null) ?? {};
    return auditMaths(files, {
      mathcheckUrl: app.config.mathcheckUrl,
      macros,
      assumptions: project.assumptions,
    });
  });

  app.post<{ Params: { id: string } }>('/projects/:id/explain-step', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = explainBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    // Gather document context so the explanation respects the author's notation.
    const files = await loadProjectFiles(app, project.id, parsed.data.overrides);
    const macroDefs = collectMacroDefs(textFiles(files));
    const macroTable = Object.entries((project.macros as Record<string, string> | null) ?? {})
      .map(([k, v]) => `${k} = ${v}`)
      .join('\n');
    const targetFile = parsed.data.file ? files.find((f) => f.path === parsed.data.file) : undefined;
    const surrounding =
      targetFile && targetFile.encoding !== 'base64' ? windowAroundLine(targetFile.content, parsed.data.line, 3000) : '';

    const system = [
      'You explain why a step in a mathematical derivation may not follow from the previous step.',
      'Be concise (2–4 sentences), plain prose with inline $...$ math (KaTeX).',
      "Interpret all symbols using THIS document's macros, notation, and conventions — do not assume standard meanings where the document redefines them.",
      'You are read-only: do NOT output a corrected version, a rewrite, or any edit — only explain the discrepancy.',
    ];
    if (project.aiInstructions.trim()) {
      system.push(`\nProject-specific instructions / notation from the author:\n${project.aiInstructions.trim()}`);
    }

    const parts: string[] = [];
    if (macroTable) parts.push(`Project macro table (used to parse the maths):\n${macroTable}`);
    if (macroDefs) parts.push(`Macro / notation definitions from the document source:\n${macroDefs}`);
    if (project.assumptions.trim()) parts.push(`Assumptions in force: ${project.assumptions.trim()}`);
    if (surrounding.trim()) parts.push(`Surrounding LaTeX from ${parsed.data.file ?? 'the document'} (read-only context):\n${surrounding.trim()}`);
    parts.push(`Previous step: $${parsed.data.previousLatex ?? '(none given)'}$`);
    parts.push(`This step: $${parsed.data.latex}$`);
    if (parsed.data.counterexample) parts.push(`A counterexample was found: ${formatCounterexample(parsed.data.counterexample)}`);
    parts.push("Explain, briefly, why this step may not follow from the previous one, using the document's own notation.");

    // Stream via SSE so the explanation appears as it is generated (a one-shot
    // Agent SDK chat call takes ~10–20s; the user should see tokens, not a hang).
    // Uses the fast completion-class model — this is a short, low-stakes helper.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const ac = new AbortController();
    request.raw.on('close', () => ac.abort());
    try {
      for await (const delta of app.modelProvider.chatStream(
        { system: system.join('\n'), messages: [{ role: 'user', content: parts.join('\n\n') }], model: app.config.completionModel },
        ac.signal,
      )) {
        if (delta.text) send('token', { text: delta.text });
      }
      markAiOk();
      send('done', {});
    } catch (err) {
      const kind = classifyAiError(err);
      markAiError(kind);
      send('error', { kind, message: errorText(err) });
    } finally {
      raw.end();
    }
    return reply;
  });

  // ── Feature 3: outline + cross-reference health ─────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/outline', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = thesisBody.safeParse(request.body ?? {});
    const files = await loadProjectFiles(app, project.id, parsed.success ? parsed.data.overrides : undefined);
    return { roots: parseProject(textFiles(files), project.rootFile).outline };
  });

  app.post<{ Params: { id: string } }>('/projects/:id/xref', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = thesisBody.safeParse(request.body ?? {});
    const files = await loadProjectFiles(app, project.id, parsed.success ? parsed.data.overrides : undefined);
    return parseProject(textFiles(files), project.rootFile).xref;
  });

  // ── Feature 2: LaTeX-aware prose check + per-project dictionary ──────────────

  app.post<{ Params: { id: string } }>('/projects/:id/prose-check', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = proseBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    let files = (await loadProjectFiles(app, project.id, parsed.data.overrides)).filter((f) => f.path.endsWith('.tex'));
    if (parsed.data.scope === 'file' && parsed.data.fileId) {
      const target = await app.prisma.texFile.findFirst({ where: { id: parsed.data.fileId, projectId: project.id } });
      if (target) files = files.filter((f) => f.path === target.path);
    }
    const rules: ProseRuleToggles = { ...DEFAULT_PROSE_RULES };
    const ruleSink = rules as unknown as Record<string, boolean>;
    for (const [k, v] of Object.entries(parsed.data.rules ?? {})) {
      if (typeof v === 'boolean') ruleSink[k] = v;
    }
    const languageToolUrl = app.config.languageToolUrl || undefined;
    return checkProse(files, { rules, customWords: project.customWords, ...(languageToolUrl ? { languageToolUrl } : {}) });
  });

  app.get<{ Params: { id: string } }>('/projects/:id/dictionary', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    return { customWords: project.customWords };
  });

  app.post<{ Params: { id: string } }>('/projects/:id/dictionary', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = dictionaryBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const word = parsed.data.word.trim();
    const set = new Set(project.customWords);
    if (parsed.data.remove) set.delete(word);
    else set.add(word);
    const customWords = [...set].sort((a, b) => a.localeCompare(b));
    await app.prisma.project.update({ where: { id: project.id }, data: { customWords } });
    return { customWords };
  });

  // ── Combined pre-submit dashboard ───────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/pre-submit', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = thesisBody.safeParse(request.body ?? {});
    const overrides = parsed.success ? parsed.data.overrides : undefined;

    const allFiles = await loadProjectFiles(app, project.id, overrides);
    const texFiles = allFiles.filter((f) => f.path.endsWith('.tex'));
    const dbFiles = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    const macros = (project.macros as Record<string, string> | null) ?? {};
    const languageToolUrl = app.config.languageToolUrl || undefined;

    const [compile, maths, prose] = await Promise.all([
      app.compileService.compile({ projectId: project.id, rootFile: project.rootFile, files: dbFiles }),
      auditMaths(texFiles, { mathcheckUrl: app.config.mathcheckUrl, macros, assumptions: project.assumptions }),
      checkProse(texFiles, {
        rules: DEFAULT_PROSE_RULES,
        customWords: project.customWords,
        ...(languageToolUrl ? { languageToolUrl } : {}),
      }),
    ]);
    const xref = parseProject(textFiles(allFiles), project.rootFile).xref;

    if (compile.status !== 'superseded') {
      await app.prisma.compileLog
        .create({
          data: { projectId: project.id, status: compile.status, log: compile.log ?? '', durationMs: compile.durationMs },
        })
        .catch(() => undefined);
    }

    const compileErrors = compile.diagnostics.filter((d) => d.severity === 'error').length;
    const compileWarnings = compile.diagnostics.filter((d) => d.severity === 'warning').length;
    const summary: PreSubmitSummary = {
      projectName: project.name,
      generatedAt: new Date().toISOString(),
      compile: { status: compile.status, errors: compileErrors, warnings: compileWarnings, durationMs: compile.durationMs ?? null },
      maths: { failing: maths.totals.failing, unknown: maths.totals.unknown, passed: maths.totals.passed },
      prose: prose.totals,
      xref: xref.totals,
      ready: compile.status === 'success' && maths.totals.failing === 0 && xref.totals.error === 0 && prose.totals.error === 0,
    };
    return summary;
  });
}
