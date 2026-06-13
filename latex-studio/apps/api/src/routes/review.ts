import { readFile, writeFile } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ContextBundle, ReviewResponse } from '@latex-studio/shared';
import { markAiError, markAiOk } from '../ai/status.js';
import { buildReferences, type RefFile } from '../coderive/references.js';
import { runReview, reviewTotals } from '../review/engine.js';
import { resolveModelProvider } from '../providers/registry.js';
import { mapFindingsToPdf } from '../review/coords.js';
import { annotatePdf } from '../review/annotate.js';
import { loadLibraryResolver } from '../literature/refs.js';
import { collectMacros } from '../docmodel/build.js';

const reviewBody = z.object({
  scope: z.enum(['file', 'project']),
  fileId: z.string().optional(),
  deterministicOnly: z.boolean().optional(),
  overrides: z.record(z.string(), z.string()).optional(),
});

const CITE_RE = /\\(?:cite|citep|citet|citeauthor|citeyear|parencite|textcite)\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;

function citedKeys(texts: string[]): string[] {
  const keys = new Set<string>();
  for (const t of texts) {
    CITE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_RE.exec(t)) !== null) {
      for (const k of (m[1] ?? '').split(',')) {
        const key = k.trim();
        if (key) keys.add(key);
      }
    }
  }
  return [...keys];
}

export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const project = request.project!;
    const parsed = reviewBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const dbFiles = await app.prisma.texFile.findMany({
      where: { projectId: project.id },
      select: { path: true, content: true, encoding: true },
    });
    const map = new Map<string, RefFile>(dbFiles.map((f) => [f.path, { path: f.path, content: f.content, encoding: f.encoding }]));
    if (parsed.data.overrides) {
      for (const [p, c] of Object.entries(parsed.data.overrides)) map.set(p, { path: p, content: c, encoding: 'utf8' });
    }
    const allFiles = [...map.values()];

    let texFiles = allFiles.filter((f) => f.path.endsWith('.tex') && f.encoding !== 'base64').map((f) => ({ path: f.path, content: f.content }));
    if (parsed.data.scope === 'file' && parsed.data.fileId) {
      const target = await app.prisma.texFile.findFirst({ where: { id: parsed.data.fileId, projectId: project.id } });
      if (target) texFiles = texFiles.filter((f) => f.path === target.path);
    }

    // Expand macros from the whole project (preamble + .sty/.cls, e.g. jfm.cls's
    // `\p`), not just the Settings table — so macro-laden equations actually parse.
    const macros = collectMacros(
      allFiles.filter((f) => f.encoding !== 'base64').map((f) => ({ path: f.path, content: f.content })),
      (project.macros as Record<string, string> | null) ?? {},
    );
    const queryText = texFiles.map((f) => f.content).join('\n').slice(0, 8000);
    const libraryItems = await loadLibraryResolver(app.prisma, project.id);
    const references = await buildReferences(citedKeys(texFiles.map((f) => f.content)), allFiles, queryText, libraryItems);
    const bundle: ContextBundle = {
      macros,
      assumptions: project.assumptions,
      documentWindow: '',
      references,
      intent: 'next-step',
      anchors: {},
    };

    const deterministicOnly = parsed.data.deterministicOnly ?? false;
    const start = Date.now();
    // RAG axes only engage when the library has an embedded index — otherwise they
    // degrade to nothing (no model or embedding calls for an empty library).
    const chunkCount = await app.prisma.libraryChunk.count({ where: { projectId: project.id } }).catch(() => 0);
    // Route to the project's selected model connector (Claude/ChatGPT/Gemini).
    const { provider: modelProvider, model: aiModel } = await resolveModelProvider(app, project);
    const { findings, aiError } = await runReview({
      texFiles,
      allFiles: allFiles.filter((f) => f.encoding !== 'base64').map((f) => ({ path: f.path, content: f.content })),
      rootFile: project.rootFile,
      bundle,
      customWords: project.customWords,
      mathcheckUrl: app.config.mathcheckUrl,
      modelProvider,
      model: aiModel,
      deterministicOnly,
      ...(chunkCount > 0
        ? {
            rag: {
              prisma: app.prisma,
              projectId: project.id,
              mathcheckUrl: app.config.mathcheckUrl,
              modelProvider,
              model: aiModel,
              libraryItems,
            },
          }
        : {}),
    });
    if (aiError) markAiError(aiError);
    else if (!deterministicOnly) markAiOk();
    await app.prisma.aiCallLog
      .create({
        data: {
          projectId: project.id,
          route: 'review',
          model: aiModel,
          latencyMs: Date.now() - start,
          ok: !aiError,
          ...(aiError ? { errorKind: aiError } : {}),
        },
      })
      .catch(() => undefined);

    // Map findings → PDF coordinates and write the annotated review PDF (never the clean one).
    let annotated = false;
    let reviewPdfUrl: string | undefined;
    const pdfPath = app.compileService.pdfPath(project.id, project.rootFile);
    let pdfBuffer: Buffer | null = null;
    try {
      pdfBuffer = await readFile(pdfPath);
    } catch {
      pdfBuffer = null;
    }
    // Highlight only ACTIONABLE findings on the PDF — a wrong equation (green), a
    // structural ref error (red), a RAG-grounded contradiction (orange, evidence in
    // the popup), a statement to check (yellow), or a grammar fix (red underline).
    // Honest non-errors ("unknown" maths, "no library source", "attribution
    // unverified", "supported") are listed in the panel but never highlighted —
    // they would bury the real issues.
    const NOTE_TIERS = new Set(['no-library-source', 'attribution-unverified', 'rag-supported']);
    const annotatable = findings.filter(
      (f) => !(f.axis === 'maths' && f.confidence === 'unknown') && !NOTE_TIERS.has(f.confidence),
    );
    if (pdfBuffer && annotatable.length > 0) {
      const coords = await mapFindingsToPdf(annotatable, (file, line) =>
        app.compileService.forward(project.id, project.rootFile, file, line),
      );
      if (coords.size > 0) {
        const result = await annotatePdf(app.config.mathcheckUrl, pdfBuffer.toString('base64'), annotatable, coords);
        if (result) {
          await writeFile(pdfPath.replace(/\.pdf$/, '.review.pdf'), Buffer.from(result.pdfBase64, 'base64'));
          annotated = true;
          reviewPdfUrl = `/projects/${project.id}/review-pdf?rev=${Date.now()}`;
        }
      }
    }

    const response: ReviewResponse = {
      findings,
      totals: reviewTotals(findings),
      references: references.map((r) => ({
        key: r.key,
        provenance: r.provenance,
        ...(r.sourceFile ? { sourceFile: r.sourceFile } : {}),
        passageCount: r.passages?.length ?? 0,
        ...(r.library ? { library: true } : {}),
      })),
      annotated,
      generatedAt: new Date().toISOString(),
      ...(reviewPdfUrl ? { reviewPdfUrl } : {}),
    };
    return response;
  };

  app.post<{ Params: { id: string } }>('/projects/:id/review', handler);
  // The full document check (same pipeline; explicit name for the compile hook).
  app.post<{ Params: { id: string } }>('/projects/:id/check', handler);

  app.get<{ Params: { id: string } }>('/projects/:id/review-pdf', async (request, reply) => {
    const project = request.project!;
    const reviewPath = app.compileService.pdfPath(project.id, project.rootFile).replace(/\.pdf$/, '.review.pdf');
    let buffer: Buffer;
    try {
      buffer = await readFile(reviewPath);
    } catch {
      return reply.callNotFound();
    }
    reply.header('content-type', 'application/pdf');
    return reply.send(buffer);
  });
}
