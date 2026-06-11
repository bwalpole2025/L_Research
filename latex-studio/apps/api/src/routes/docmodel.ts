import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DocumentModelResponse, PredictNextResponse } from '@latex-studio/shared';
import { buildContextCard, buildDocumentModel } from '../docmodel/build.js';
import { classifyAiError } from '../providers/index.js';
import { errorText } from '../providers/errors.js';
import { markAiError, markAiOk } from '../ai/status.js';
import { parseCompletion } from '../ai/completion/prompts.js';

const overridesSchema = z.record(z.string(), z.string()).optional();

const docModelBody = z.object({
  cursorFile: z.string().optional(),
  cursorLine: z.number().int().positive().optional(),
  headingNote: z.boolean().optional(),
  overrides: overridesSchema,
});

const predictBody = z.object({
  fileId: z.string(),
  cursorLine: z.number().int().positive(),
  granularity: z.enum(['auto', 'prose', 'maths', 'structural']),
  card: z.string().max(8_000).optional(),
  position: z.string().max(200).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  overrides: overridesSchema,
});

async function loadTextFiles(app: FastifyInstance, projectId: string, overrides?: Record<string, string>): Promise<{ path: string; content: string }[]> {
  const files = await app.prisma.texFile.findMany({ where: { projectId }, select: { path: true, content: true, encoding: true } });
  const map = new Map<string, string>(files.filter((f) => f.encoding !== 'base64').map((f) => [f.path, f.content]));
  if (overrides) for (const [p, c] of Object.entries(overrides)) map.set(p, c);
  return [...map].map(([path, content]) => ({ path, content }));
}

/** Heuristic granularity from the local cursor context. */
function detectGranularity(content: string, cursorLine: number): 'prose' | 'maths' | 'structural' {
  const lines = content.split('\n');
  const idx = Math.min(cursorLine, lines.length) - 1;
  let depth = 0;
  const MATH = /\\begin\{(align|equation|gather|multline|eqnarray|flalign|alignat)\*?\}/;
  const MATH_END = /\\end\{(align|equation|gather|multline|eqnarray|flalign|alignat)\*?\}/;
  for (let i = 0; i <= idx && i < lines.length; i++) {
    if (MATH.test(lines[i] ?? '')) depth += 1;
    if (MATH_END.test(lines[i] ?? '')) depth = Math.max(0, depth - 1);
  }
  if (depth > 0) return 'maths';
  // Section boundary: a heading within the previous 2 lines and an empty current area.
  for (let i = idx; i >= Math.max(0, idx - 2); i--) {
    if (/\\(?:sub)*section\*?\s*\{/.test(lines[i] ?? '')) return 'structural';
  }
  return 'prose';
}

function instruction(g: 'prose' | 'maths' | 'structural'): string {
  if (g === 'maths')
    return 'Predict the next 1–3 derivation steps as display-math lines (ONE step per line), each algebraically following from the previous. Reuse the document macros. Output only the step lines.';
  if (g === 'structural')
    return 'You are at a section boundary. Predict a short outline (3–5 lines, each starting with "- ") of what this (sub)section will cover, consistent with the document\'s stated aims. Output only the outline.';
  return 'Predict the next sentence or two that complete the current thought. If the cursor is at a paragraph boundary, instead give a next-paragraph scaffold: a topic sentence plus a phrase stating the intended direction. Output only the prose.';
}

export async function docmodelRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>('/projects/:id/document-model', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = docModelBody.safeParse(request.body ?? {});
    const data = parsed.success ? parsed.data : {};
    const files = await loadTextFiles(app, project.id, data.overrides);
    const macros = (project.macros as Record<string, string> | null) ?? {};
    const model = buildDocumentModel({
      files,
      rootFile: project.rootFile,
      projectMacros: macros,
      ...(data.cursorFile ? { cursorFile: data.cursorFile } : {}),
      ...(data.cursorLine ? { cursorLine: data.cursorLine } : {}),
    });

    // Optional: a 2–3 sentence "where this is heading" hint (once per recompute).
    if (data.headingNote && (model.abstract || model.recentHeading)) {
      try {
        let note = '';
        for await (const d of app.modelProvider.chatStream(
          {
            system:
              'In 2–3 sentences, say where this document or section seems to be heading. This is a HINT only — never assert facts. Plain prose, no preamble.',
            messages: [
              {
                role: 'user',
                content: `Abstract: ${model.abstract || '(none)'}\nCurrent section: ${model.recentHeading || '(none)'}\nOutline: ${model.outline.map((o) => o.title).join(' · ')}`,
              },
            ],
            model: app.config.completionModel,
          },
        )) {
          note += d.text;
        }
        markAiOk();
        if (note.trim()) model.headingNote = note.trim();
      } catch (err) {
        markAiError(classifyAiError(err)); // non-fatal — the card is still useful
      }
    }

    const res: DocumentModelResponse = {
      card: buildContextCard(model),
      notationSymbols: model.notationSymbols,
      outline: model.outline,
      builtAt: new Date().toISOString(),
    };
    return res;
  });

  app.post<{ Params: { id: string } }>('/projects/:id/predict-next', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = predictBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const target = await app.prisma.texFile.findFirst({ where: { id: parsed.data.fileId, projectId: project.id } });
    if (!target) return reply.code(404).send({ error: 'file not found' });
    const content = parsed.data.overrides?.[target.path] ?? target.content;

    const granularity: 'prose' | 'maths' | 'structural' =
      parsed.data.granularity === 'auto' ? detectGranularity(content, parsed.data.cursorLine) : (parsed.data.granularity as 'prose' | 'maths' | 'structural');

    const lines = content.split('\n');
    const from = Math.max(0, parsed.data.cursorLine - 40);
    const window = lines.slice(from, parsed.data.cursorLine).join('\n');

    const user = [
      parsed.data.card?.trim() ? `Document context card (reuse its notation):\n${parsed.data.card.trim()}` : '',
      parsed.data.position?.trim() ? `Cursor position: ${parsed.data.position.trim()}.` : '',
      instruction(granularity),
      'Text up to the cursor:',
      window,
      'Predicted continuation:',
    ]
      .filter(Boolean)
      .join('\n\n');

    let text = '';
    try {
      for await (const d of app.modelProvider.chatStream(
        {
          system:
            'You predict the continuation of a LaTeX document. Use the document context card macros, symbols and notation. ' +
            'Output ONLY the predicted text/LaTeX to insert — no commentary, no fences, no repetition of the existing text.',
          messages: [{ role: 'user', content: user }],
          model: parsed.data.model ?? project.model,
        },
        (() => {
          const ac = new AbortController();
          request.raw.on('close', () => ac.abort());
          return ac.signal;
        })(),
      )) {
        text += d.text;
      }
      markAiOk();
    } catch (err) {
      const kind = classifyAiError(err);
      markAiError(kind);
      return reply.code(kind === 'credit_exhausted' ? 402 : kind === 'auth' || kind === 'unavailable' ? 503 : 502).send({ error: errorText(err), kind });
    }

    const prediction = parseCompletion(text);
    const res: PredictNextResponse = { prediction, kind: granularity };
    if (granularity === 'maths') {
      res.steps = prediction
        .split('\n')
        .map((s) => s.replace(/\\\\\s*$/, '').trim())
        .filter((s) => s.length > 0);
    }
    return res;
  });
}
