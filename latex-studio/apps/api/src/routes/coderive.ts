import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { classifyAiError } from '../providers/index.js';
import { errorText } from '../providers/errors.js';
import { markAiError, markAiOk } from '../ai/status.js';
import { assembleBundle } from '../coderive/context.js';
import { runCoderive } from '../coderive/engine.js';
import { runDocumentVerification } from '../coderive/document.js';
import { collectMacros } from '../docmodel/build.js';
import { looksLikeMath } from '../coderive/anchors.js';
import type { RefFile } from '../coderive/references.js';
import { loadLibraryResolver } from '../literature/refs.js';
import type { CoderiveResponse } from '@latex-studio/shared';

const coderiveBody = z.object({
  fileId: z.string().optional(),
  intent: z.enum(['fill-gap', 'next-step', 'reach-goal', 'justify', 'verify-document']),
  anchorRange: z
    .object({
      fromLine: z.number().int().positive(),
      toLine: z.number().int().positive().optional(),
    })
    .optional(),
  target: z.string().max(4000).optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

export async function coderiveRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/projects/:id/coderive', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = coderiveBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const macros = (project.macros as Record<string, string> | null) ?? {};

    // Load project files once (DB + live editor overrides).
    const dbFiles = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    const map = new Map<string, RefFile>(dbFiles.map((f) => [f.path, { path: f.path, content: f.content, encoding: f.encoding }]));
    if (parsed.data.overrides) {
      for (const [p, c] of Object.entries(parsed.data.overrides)) map.set(p, { path: p, content: c, encoding: 'utf8' });
    }
    const files = [...map.values()];

    // ── Whole-document verification (no anchor) ──────────────────────────────
    // SymPy verifies every display equation across the document; the AI only
    // adds context for the ones it could not pass — it decides no verdict. The
    // guarded auditMaths excludes .bib/.bst and bibliography environments, so
    // reference text can never reach the verifier here either.
    if (parsed.data.intent === 'verify-document') {
      const texFiles = files
        .filter((f) => f.encoding !== 'base64' && /\.tex$/i.test(f.path))
        .map((f) => ({ path: f.path, content: f.content }));
      // Expand macros from the whole project (preamble + .sty/.cls, e.g. jfm.cls's
      // `\newcommand\p{\ensuremath{\partial}}`), not just the (often empty) Settings
      // table — otherwise macro-laden equations falsely read as "parse-error".
      const docMacros = collectMacros(
        files.filter((f) => f.encoding !== 'base64').map((f) => ({ path: f.path, content: f.content })),
        macros,
      );

      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      const sse = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const ac = new AbortController();
      request.raw.on('close', () => ac.abort());
      const start = Date.now();
      try {
        const documentVerification = await runDocumentVerification(
          texFiles,
          {
            mathcheckUrl: app.config.mathcheckUrl,
            macros: docMacros,
            assumptions: project.assumptions,
            modelProvider: app.modelProvider,
            model: project.model,
            onProgress: (stage) => sse('progress', { stage }),
          },
          ac.signal,
        );
        markAiOk();
        await app.prisma.aiCallLog
          .create({ data: { projectId: project.id, route: 'coderive', model: project.model, latencyMs: Date.now() - start, ok: true } })
          .catch(() => undefined);
        const response: CoderiveResponse = {
          intent: 'verify-document',
          candidates: [],
          skipped: [],
          context: { macroCount: Object.keys(macros).length, assumptions: project.assumptions, documentWindowChars: 0, windowPreview: '', references: [] },
          rounds: [],
          anchors: {},
          documentVerification,
        };
        sse('result', response);
      } catch (err) {
        const kind = classifyAiError(err);
        markAiError(kind);
        await app.prisma.aiCallLog
          .create({ data: { projectId: project.id, route: 'coderive', model: project.model, latencyMs: Date.now() - start, ok: false, errorKind: kind } })
          .catch(() => undefined);
        sse('error', { kind, message: errorText(err) });
      } finally {
        raw.end();
      }
      return reply;
    }

    // ── Generative intents (need a .tex anchor) ──────────────────────────────
    if (!parsed.data.fileId) return reply.code(400).send({ error: 'fileId is required for this intent' });
    if (!parsed.data.anchorRange) return reply.code(400).send({ error: 'anchorRange is required for this intent' });
    const target = await app.prisma.texFile.findFirst({ where: { id: parsed.data.fileId, projectId: project.id } });
    if (!target) return reply.code(404).send({ error: 'file not found' });

    // Co-derive anchors must be display equations in a document — bibliography
    // data (.bib/.bst) and other non-.tex files can never supply a verification
    // expression (this is how `author = {Basset, AB},` once reached SymPy).
    if (!/\.tex$/i.test(target.path)) {
      return reply.code(422).send({
        error: `Co-derive works on .tex documents — "${target.path}" cannot supply a mathematical anchor.`,
        kind: 'invalid',
      });
    }

    const targetContent = map.get(target.path)?.content ?? target.content;
    const ar = parsed.data.anchorRange;
    const range = ar.toLine !== undefined ? { fromLine: ar.fromLine, toLine: ar.toLine } : { fromLine: ar.fromLine };

    const libraryItems = await loadLibraryResolver(app.prisma, project.id);
    const { bundle, anchors } = await assembleBundle({
      intent: parsed.data.intent,
      range,
      ...(parsed.data.target ? { target: parsed.data.target } : {}),
      targetFile: { path: target.path, content: targetContent },
      files,
      macros,
      assumptions: project.assumptions,
      libraryItems,
    });

    // Pre-flight: don't spend an LLM call on a non-mathematical anchor (e.g. a
    // preamble line like \usepackage{tikz}). SymPy would only ever return
    // "unknown"; tell the user to anchor on an equation instead.
    const beginDoc = targetContent.indexOf('\\begin{document}');
    const preambleLines = beginDoc === -1 ? 0 : targetContent.slice(0, beginDoc).split('\n').length;
    const anchorGuard = (): string | null => {
      if (preambleLines > 0 && range.fromLine <= preambleLines) {
        return 'place the cursor in the document body, not the preamble';
      }
      const checks: Array<[string, string | undefined]> =
        parsed.data.intent === 'fill-gap' || parsed.data.intent === 'justify'
          ? [['the first selected line', anchors.from], ['the second selected line', anchors.to]]
          : parsed.data.intent === 'reach-goal'
            ? [['the current line', anchors.from], ['the target expression', anchors.goal]]
            : [['the current line', anchors.from]];
      const bad = checks.find(([, v]) => !looksLikeMath(v));
      return bad ? `${bad[0]} is not a mathematical expression — select (or place the cursor in) a display equation` : null;
    };
    const guardMessage = anchorGuard();
    if (guardMessage) {
      return reply.code(422).send({ error: `Co-derive needs a mathematical anchor: ${guardMessage}.`, kind: 'invalid' });
    }

    // Stream propose→verify→retry progress, then the final structured result.
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const sse = (event: string, data: unknown) => raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const ac = new AbortController();
    request.raw.on('close', () => ac.abort());
    const start = Date.now();

    try {
      const result = await runCoderive(
        bundle,
        anchors,
        {
          modelProvider: app.modelProvider,
          mathcheckUrl: app.config.mathcheckUrl,
          model: project.model,
          onRound: (r) => sse('round', r),
        },
        ac.signal,
      );
      markAiOk();
      await app.prisma.aiCallLog
        .create({ data: { projectId: project.id, route: 'coderive', model: project.model, latencyMs: Date.now() - start, ok: true } })
        .catch(() => undefined);
      sse('result', result);
    } catch (err) {
      const kind = classifyAiError(err);
      markAiError(kind);
      await app.prisma.aiCallLog
        .create({ data: { projectId: project.id, route: 'coderive', model: project.model, latencyMs: Date.now() - start, ok: false, errorKind: kind } })
        .catch(() => undefined);
      sse('error', { kind, message: errorText(err) });
    } finally {
      raw.end();
    }
    return reply;
  });
}
