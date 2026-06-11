import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type {
  AiErrorKind,
  CompletionInlineRequest,
  ModelHealth,
  ModelProvider,
  ReplacementResponse,
} from '@latex-studio/shared';
import { classifyAiError } from '../providers/index.js';
import { errorText } from '../providers/errors.js';
import { buildFixInstruction } from '../providers/prompts.js';
import { getAiStatus, markAiError, markAiOk } from '../ai/status.js';
import { assembleContext } from '../ai/context.js';
import { getModels } from '../ai/models.js';
import type { CompletionRunner } from '../ai/completion/service.js';
import { buildStats } from '../ai/completion/stats.js';

declare module 'fastify' {
  interface FastifyInstance {
    modelProvider: ModelProvider;
    completionService: CompletionRunner;
  }
}

interface LogInput {
  projectId?: string | null;
  route: string;
  provider?: string | null;
  model: string;
  variant?: string | null;
  latencyMs: number;
  ok: boolean;
  errorKind?: AiErrorKind | null;
}

async function logAiCall(app: FastifyInstance, data: LogInput): Promise<void> {
  await app.prisma.aiCallLog
    .create({
      data: {
        projectId: data.projectId ?? null,
        route: data.route,
        provider: data.provider ?? null,
        model: data.model,
        variant: data.variant ?? null,
        latencyMs: data.latencyMs,
        ok: data.ok,
        errorKind: data.errorKind ?? null,
      },
    })
    .catch(() => undefined);
}

/** HTTP status per error kind. The body always carries `kind` for the UI. */
function statusForKind(kind: AiErrorKind): number {
  switch (kind) {
    case 'credit_exhausted':
      return 402;
    case 'invalid':
      return 501;
    case 'auth':
    case 'unavailable':
      return 503;
    default:
      return 502;
  }
}

const chatBody = z.object({
  threadId: z.string().optional(),
  message: z.string().min(1).max(20_000),
  context: z
    .object({
      activeFile: z.string().optional(),
      selection: z.string().optional(),
      cursorLine: z.number().int().optional(),
      pinnedPaths: z.array(z.string()).optional(),
    })
    .optional(),
});

const editBody = z.object({
  filePath: z.string().min(1),
  selection: z.string().min(1),
  context: z.string().default(''),
  instruction: z.string().min(1).max(2_000),
});

const fixBody = z.object({
  filePath: z.string().min(1),
  region: z.string().min(1),
  diagnostic: z.object({ message: z.string(), line: z.number().int().optional() }),
  logExcerpt: z.string().default(''),
});

const createThreadBody = z.object({ title: z.string().trim().min(1).max(200).optional() });

const completeBody = z.object({
  prefix: z.string().max(40_000),
  suffix: z.string().max(20_000).optional(),
  mode: z.enum(['prose', 'inline-math', 'display-align', 'preamble']),
  model: z.string().trim().min(1).max(100).optional(),
  provider: z.enum(['agent-sdk', 'api']).optional(),
  baseline: z.boolean().optional(),
});

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  // ── Health / status / models ───────────────────────────────────────────────

  app.get('/healthz/model', async (): Promise<ModelHealth> => {
    const start = Date.now();
    const { modelProvider, model } = app.config;
    const ac = new AbortController();
    try {
      const text = await app.modelProvider.complete(
        { projectId: '', filePath: '', prefix: 'Reply with exactly: ok', instruction: 'Output only the word ok.' },
        ac.signal,
      );
      markAiOk();
      await logAiCall(app, { route: 'health', model, latencyMs: Date.now() - start, ok: true });
      return { provider: modelProvider, model, ok: text.trim().length > 0, latencyMs: Date.now() - start };
    } catch (err) {
      const kind = classifyAiError(err);
      markAiError(kind);
      await logAiCall(app, { route: 'health', model, latencyMs: Date.now() - start, ok: false, errorKind: kind });
      return { provider: modelProvider, model, ok: false, latencyMs: Date.now() - start, error: errorText(err) };
    }
  });

  app.get('/ai/status', async () => getAiStatus());

  app.get('/ai/models', async () => getModels(app.config.model));

  app.get<{ Params: { id: string } }>('/projects/:id/ai/logs', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const logs = await app.prisma.aiCallLog.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return logs.map((l) => ({
      id: l.id,
      route: l.route,
      model: l.model,
      latencyMs: l.latencyMs,
      ok: l.ok,
      errorKind: l.errorKind,
      createdAt: l.createdAt.toISOString(),
    }));
  });

  // ── Chat threads (we own the transcript) ────────────────────────────────────

  app.get<{ Params: { id: string } }>('/projects/:id/chat/threads', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const threads = await app.prisma.chatThread.findMany({
      where: { projectId: project.id },
      orderBy: { updatedAt: 'desc' },
    });
    return threads.map(serialiseThread);
  });

  app.post<{ Params: { id: string } }>('/projects/:id/chat/threads', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = createThreadBody.safeParse(request.body ?? {});
    const thread = await app.prisma.chatThread.create({
      data: { projectId: project.id, title: parsed.success && parsed.data.title ? parsed.data.title : 'Chat' },
    });
    return reply.code(201).send(serialiseThread(thread));
  });

  app.get<{ Params: { tid: string } }>('/chat/threads/:tid/messages', async (request, reply) => {
    const thread = await app.prisma.chatThread.findUnique({ where: { id: request.params.tid } });
    if (!thread) return reply.callNotFound();
    const messages = await app.prisma.chatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map(serialiseMessage);
  });

  app.delete<{ Params: { tid: string } }>('/chat/threads/:tid', async (request, reply) => {
    await app.prisma.chatThread.delete({ where: { id: request.params.tid } }).catch(() => undefined);
    return reply.code(204).send();
  });

  // ── Chat (streaming SSE) ────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/chat', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = chatBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    // Resolve / create the thread, persist the user message.
    let threadId = parsed.data.threadId;
    if (threadId) {
      const existing = await app.prisma.chatThread.findFirst({
        where: { id: threadId, projectId: project.id },
      });
      if (!existing) threadId = undefined;
    }
    if (!threadId) {
      const created = await app.prisma.chatThread.create({
        data: { projectId: project.id, title: deriveTitle(parsed.data.message) },
      });
      threadId = created.id;
    }
    await app.prisma.chatMessage.create({
      data: { threadId, role: 'user', content: parsed.data.message },
    });

    // Assemble context + transcript (our stored history is the source of truth).
    const [history, files] = await Promise.all([
      app.prisma.chatMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' } }),
      app.prisma.texFile.findMany({ where: { projectId: project.id }, select: { path: true, content: true } }),
    ]);
    const { chatSystemPrompt } = await import('../providers/prompts.js');
    const system = chatSystemPrompt(project.aiInstructions, assembleContext(files, parsed.data.context));
    const messages = history.map((h) => ({ role: h.role as 'user' | 'assistant', content: h.content }));

    // Stream via SSE.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('meta', { threadId });

    const ac = new AbortController();
    request.raw.on('close', () => ac.abort());
    const start = Date.now();
    let assistant = '';
    try {
      for await (const delta of app.modelProvider.chatStream({ system, messages, model: project.model }, ac.signal)) {
        assistant += delta.text;
        send('token', { text: delta.text });
      }
      const saved = await app.prisma.chatMessage.create({
        data: { threadId, role: 'assistant', content: assistant },
      });
      await app.prisma.chatThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
      markAiOk();
      await logAiCall(app, { projectId: project.id, route: 'chat', model: project.model, latencyMs: Date.now() - start, ok: true });
      send('done', { threadId, messageId: saved.id });
    } catch (err) {
      const kind = classifyAiError(err);
      markAiError(kind);
      // Persist any partial output so a reload matches what the user saw.
      if (assistant.trim()) {
        await app.prisma.chatMessage
          .create({ data: { threadId, role: 'assistant', content: assistant } })
          .catch(() => undefined);
      }
      await logAiCall(app, { projectId: project.id, route: 'chat', model: project.model, latencyMs: Date.now() - start, ok: false, errorKind: kind });
      send('error', { kind, message: errorText(err) });
    } finally {
      raw.end();
    }
    return reply;
  });

  // ── Inline edit (Cmd+K) ─────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/edit', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = editBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    return runReplacement(app, reply, {
      projectId: project.id,
      route: 'edit',
      model: project.model,
      instruction: parsed.data.instruction,
      selection: parsed.data.selection,
      context: parsed.data.context,
    });
  });

  // ── Fix-from-log ────────────────────────────────────────────────────────────

  app.post<{ Params: { id: string } }>('/projects/:id/fix', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = fixBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    return runReplacement(app, reply, {
      projectId: project.id,
      route: 'fix',
      model: project.model,
      instruction: buildFixInstruction(parsed.data.diagnostic.message, parsed.data.diagnostic.line, parsed.data.logExcerpt),
      selection: parsed.data.region,
      context: '',
    });
  });

  // ── Inline completions (ghost text) — the latency-critical path ──────────────

  app.post<{ Params: { id: string } }>('/projects/:id/complete', async (request, reply) => {
    const parsed = completeBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
    }
    const projectId = request.params.id;
    const ac = new AbortController();
    request.raw.on('close', () => ac.abort());
    const start = Date.now();
    try {
      const result = await app.completionService.complete(
        projectId,
        parsed.data as CompletionInlineRequest,
        ac.signal,
      );
      markAiOk();
      await logAiCall(app, {
        projectId,
        route: 'complete',
        provider: result.provider,
        model: result.model,
        variant: result.variant,
        latencyMs: result.latencyMs,
        ok: true,
      });
      return result;
    } catch (err) {
      if (ac.signal.aborted) return reply.code(204).send(); // client superseded the request
      const kind = classifyAiError(err);
      markAiError(kind);
      await logAiCall(app, {
        projectId,
        route: 'complete',
        provider: parsed.data.provider ?? app.config.completionsProvider,
        model: parsed.data.model ?? app.config.completionModel,
        variant: parsed.data.baseline ? 'baseline' : 'warm',
        latencyMs: Date.now() - start,
        ok: false,
        errorKind: kind,
      });
      return reply.code(statusForKind(kind)).send({ error: errorText(err), kind });
    }
  });

  // ── Completion stats (/stats page) ───────────────────────────────────────────

  app.get('/ai/stats', async () => {
    const rows = await app.prisma.aiCallLog.findMany({
      where: { route: 'complete' },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
    return buildStats(rows);
  });
}

interface ReplacementInput {
  projectId: string;
  route: 'edit' | 'fix';
  model: string;
  instruction: string;
  selection: string;
  context: string;
}

async function runReplacement(
  app: FastifyInstance,
  reply: FastifyReply,
  input: ReplacementInput,
): Promise<unknown> {
  const start = Date.now();
  const ac = new AbortController();
  try {
    const replacement = await app.modelProvider.editRegion(
      { instruction: input.instruction, selection: input.selection, context: input.context, model: input.model },
      ac.signal,
    );
    markAiOk();
    await logAiCall(app, { projectId: input.projectId, route: input.route, model: input.model, latencyMs: Date.now() - start, ok: true });
    const body: ReplacementResponse = { replacement };
    return body;
  } catch (err) {
    const kind = classifyAiError(err);
    markAiError(kind);
    await logAiCall(app, { projectId: input.projectId, route: input.route, model: input.model, latencyMs: Date.now() - start, ok: false, errorKind: kind });
    return reply.code(statusForKind(kind)).send({ error: errorText(err), kind });
  }
}

function deriveTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  return trimmed.length <= 48 ? trimmed : `${trimmed.slice(0, 48)}…`;
}

function serialiseThread(t: { id: string; projectId: string; title: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function serialiseMessage(m: { id: string; threadId: string; role: string; content: string; createdAt: Date }) {
  return {
    id: m.id,
    threadId: m.threadId,
    role: m.role as 'user' | 'assistant',
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}
