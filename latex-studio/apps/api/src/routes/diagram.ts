import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const execFileP = promisify(execFile);

/**
 * DIAGRAM EDITOR backend:
 *  · POST /projects/:id/diagram-pdf — compile generated TikZ standalone to a
 *    frozen vector PDF saved as a project file (the \includegraphics target).
 *  · POST /projects/:id/gnuplot — run GNUplot in the SANDBOX (see run/gnuplot:
 *    fresh non-root container, no network, resource+time limits, read-only
 *    project mount). Outputs land in diagrams/plots/<base>.{tex,pdf} via the
 *    LaTeX-native cairolatex terminal and are saved back as project files.
 */

const pdfBody = z.object({
  tikz: z.string().min(1).max(200_000),
  outPath: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\w./-]+\.pdf$/),
  /** Template-object requirements — same server-side whitelists as render-snippet. */
  packages: z.array(z.string()).max(8).optional(),
  tikzLibraries: z.array(z.string()).max(12).optional(),
});

const PDF_EXTRA_PKGS = new Set(['pgfplots', 'tikz-3dplot']);
const PDF_TIKZ_LIBS = new Set([
  'decorations.pathmorphing', 'decorations.pathreplacing', 'decorations.markings',
  'fillbetween', 'calc', 'patterns', 'angles', 'quotes', '3d', 'shapes.geometric',
]);
/** \usepgfplotslibrary-only libraries (mirrors preview.ts + web templates/types). */
const PGFPLOTS_TIKZ_LIBS = new Set(['fillbetween']);

const gnuplotBody = z.object({
  source: z.union([
    z.object({ type: z.literal('function'), expr: z.string().min(1).max(2000) }),
    z.object({ type: z.literal('data'), data: z.string().min(1).max(200_000) }),
  ]),
  settings: z.object({
    xrange: z.string().max(60).default(''),
    yrange: z.string().max(60).default(''),
    xlabel: z.string().max(200).default(''),
    ylabel: z.string().max(200).default(''),
    plotStyle: z.string().max(20).default('lines'),
  }),
  // The element's stroke colour/width/dash, so the curve renders in the chosen style.
  style: z
    .object({
      stroke: z.string().max(20).optional(),
      strokeWidth: z.number().min(0).max(40).optional(),
      dash: z.string().max(10).optional(),
    })
    .optional(),
  widthCm: z.number().min(2).max(40),
  heightCm: z.number().min(2).max(40),
  base: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[\w-]+$/),
});

async function upsertProjectFile(
  app: FastifyInstance,
  projectId: string,
  path: string,
  content: string,
  encoding: 'utf8' | 'base64',
): Promise<void> {
  const existing = await app.prisma.texFile.findUnique({ where: { projectId_path: { projectId, path } } });
  if (existing) await app.prisma.texFile.update({ where: { id: existing.id }, data: { content, encoding } });
  else await app.prisma.texFile.create({ data: { projectId, path, content, encoding } });
}

export async function diagramRoutes(app: FastifyInstance): Promise<void> {
  // ── Frozen PDF export (Stage 2's \includegraphics target) ──
  app.post<{ Params: { id: string } }>('/projects/:id/diagram-pdf', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = pdfBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const extraPkgs = (parsed.data.packages ?? []).filter((p) => PDF_EXTRA_PKGS.has(p));
    const requested = (parsed.data.tikzLibraries ?? []).filter((l) => PDF_TIKZ_LIBS.has(l));
    const tikzLibs = requested.filter((l) => !PGFPLOTS_TIKZ_LIBS.has(l));
    const plotLibs = requested.filter((l) => PGFPLOTS_TIKZ_LIBS.has(l));
    const doc = [
      '\\documentclass[tikz,border=2pt]{standalone}',
      '\\usepackage{amsmath,amssymb}',
      // Packages before libraries — pgfplots libraries only exist once pgfplots loads.
      ...extraPkgs.map((p) => `\\usepackage{${p}}${p === 'pgfplots' ? '\n\\pgfplotsset{compat=newest}' : ''}`),
      tikzLibs.length ? `\\usetikzlibrary{${tikzLibs.join(',')}}` : '',
      plotLibs.length ? `\\usepgfplotslibrary{${plotLibs.join(',')}}` : '',
      '\\begin{document}',
      parsed.data.tikz,
      '\\end{document}',
    ]
      .filter(Boolean)
      .join('\n');
    const base = `dgexp${randomUUID().slice(0, 8)}`;
    await app.compileService.writeSnippet(project.id, `${base}.tex`, doc);
    const compiled = await app.compileService.compileSnippet(project.id, `${base}.tex`);
    let pdf: Buffer;
    try {
      pdf = await readFile(app.compileService.pdfPath(project.id, `${base}.tex`));
    } catch {
      return reply.code(422).send({ error: 'diagram failed to compile', log: compiled.logTail.slice(-1500) });
    }
    await upsertProjectFile(app, project.id, parsed.data.outPath, pdf.toString('base64'), 'base64');
    return { path: parsed.data.outPath };
  });

  // ── Sandboxed GNUplot ──
  app.post<{ Params: { id: string } }>('/projects/:id/gnuplot', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } });
    if (!project) return reply.callNotFound();
    const parsed = gnuplotBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });

    const { buildGnuplotPlan, gnuplotScript } = await import('../run/gnuplot.js');
    const cfg = app.config;
    const runId = randomUUID().slice(0, 8);
    const projDir = join(cfg.compileWorkspace, project.id);
    const scratchRel = `.gpout/${runId}`;
    const outBase = `diagrams/plots/${parsed.data.base}`;

    // Stage project files + dirs the run reads/writes.
    const files = await app.prisma.texFile.findMany({ where: { projectId: project.id }, select: { path: true, content: true, encoding: true } });
    await app.compileService.stageFiles(
      project.id,
      files.map((f) => ({ path: f.path, content: f.content, encoding: f.encoding as 'utf8' | 'base64' })),
    );
    await mkdir(join(projDir, 'diagrams', 'plots'), { recursive: true });
    await mkdir(join(projDir, scratchRel), { recursive: true });

    let dataRel: string | undefined;
    if (parsed.data.source.type === 'data') {
      dataRel = `${scratchRel}/data.dat`;
      await writeFile(join(projDir, dataRel), parsed.data.source.data, 'utf8');
    }
    const script = gnuplotScript({
      source: parsed.data.source,
      settings: parsed.data.settings,
      widthCm: parsed.data.widthCm,
      heightCm: parsed.data.heightCm,
      outBase,
      ...(dataRel ? { dataRel } : {}),
      ...(parsed.data.style ? { style: parsed.data.style } : {}),
    });
    const scriptRel = `${scratchRel}/plot.gp`;
    await writeFile(join(projDir, scriptRel), script, 'utf8');

    const timeoutMs = Math.min(cfg.pyrunTimeoutMs, 60_000);
    const plan = buildGnuplotPlan(cfg, { projectId: project.id, runId, scriptRel, timeoutMs });
    let stdout = '';
    let stderr = '';
    let ok = true;
    try {
      const res = await execFileP(plan.command, plan.argv, { timeout: timeoutMs + 10_000, ...(plan.cwd ? { cwd: plan.cwd } : {}) });
      stdout = res.stdout;
      stderr = res.stderr;
    } catch (err) {
      ok = false;
      const e = err as { stdout?: string; stderr?: string; message?: string };
      stdout = e.stdout ?? '';
      stderr = e.stderr ?? e.message ?? 'gnuplot failed';
    }

    // Collect outputs (cairolatex emits <base>.tex + <base>.pdf).
    let previewPng: string | undefined;
    if (ok) {
      try {
        const tex = await readFile(join(projDir, `${outBase}.tex`), 'utf8');
        const pdf = await readFile(join(projDir, `${outBase}.pdf`));
        await upsertProjectFile(app, project.id, `${outBase}.tex`, tex, 'utf8');
        await upsertProjectFile(app, project.id, `${outBase}.pdf`, pdf.toString('base64'), 'base64');

        // Faithful canvas preview: the cairolatex .pdf holds only the GRAPHICS
        // (curve, axes, grid); the axis/tick LABELS live in the .tex overlay.
        // Rasterising the raw .pdf would drop every label, so compile a tiny
        // standalone that \input the overlay (it \includegraphics the .pdf,
        // both already on disk) and rasterise THAT. Fall back to the bare .pdf
        // if the overlay compile fails.
        let previewPdf = pdf;
        try {
          const previewBase = `gpprev${runId}`;
          const previewDoc = [
            '\\documentclass[border=2pt]{standalone}',
            '\\usepackage{amsmath,amssymb,graphicx}',
            '\\begin{document}',
            `\\input{${outBase}.tex}`,
            '\\end{document}',
          ].join('\n');
          await app.compileService.writeSnippet(project.id, `${previewBase}.tex`, previewDoc);
          await app.compileService.compileSnippet(project.id, `${previewBase}.tex`);
          previewPdf = await readFile(app.compileService.pdfPath(project.id, `${previewBase}.tex`));
        } catch {
          /* overlay compile failed — rasterise the graphics-only .pdf */
        }

        try {
          const r = await fetch(`${cfg.mathcheckUrl}/pdf-png`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pdf_base64: previewPdf.toString('base64'), dpi: 110 }),
          });
          const d = (await r.json()) as { png_base64?: string };
          if (d.png_base64) previewPng = d.png_base64;
        } catch {
          /* preview is best-effort */
        }
      } catch {
        ok = false;
        stderr += '\nNo output produced (expected cairolatex .tex/.pdf pair).';
      }
    }

    return { ok, base: parsed.data.base, stdout, stderr, ...(previewPng ? { previewPng } : {}) };
  });
}
