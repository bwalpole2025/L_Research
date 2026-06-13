import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * GNUplot label/axis rendering, live: a plot's axis labels and tick numbers
 * live in the cairolatex .tex overlay (the .pdf holds only the curve + axes
 * lines). Two things must hold for the editor to show them:
 *  1. the run's canvas preview compiles the .tex overlay (labels included);
 *  2. the diagram's TYPESET preview (render-snippet) stages the generated .pdf
 *     so \input{plot.tex} → \includegraphics{plot.pdf} doesn't abort — and a
 *     restyle busts the cache (variant) so the change is actually re-rendered.
 */
const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('gnuplot labels + axes show in the editor previews (live)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `gpprev ${Date.now()}` } });
    projectId = p.json().id;
  });
  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  const run = (base: string, style?: object) =>
    app.inject({
      method: 'POST', url: `/projects/${projectId}/gnuplot`, headers: auth,
      payload: {
        source: { type: 'function', expr: 'sin(x)/x' },
        settings: { xrange: '[-10:10]', yrange: '[]', xlabel: '$x$', ylabel: '$\\sin(x)/x$', plotStyle: 'lines' },
        ...(style ? { style } : {}),
        widthCm: 8, heightCm: 6, base,
      },
    });

  const snippet = (base: string, variant?: string) =>
    app.inject({
      method: 'POST', url: `/projects/${projectId}/render-snippet`, headers: auth,
      payload: {
        kind: 'tikz',
        latex: `\\begin{tikzpicture}\n\\node[anchor=north west, inner sep=0pt] at (0,0) {\\input{diagrams/plots/${base}.tex}};\n\\end{tikzpicture}`,
        ...(variant ? { variant } : {}),
      },
    });

  it('the run preview compiles the cairolatex overlay (labels), not just the raw curve pdf', async () => {
    const r = await run('lblplot', { stroke: '#4e68f5', strokeWidth: 2, dash: 'solid' });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; stderr: string; previewPng?: string };
    expect(body.ok, body.stderr).toBe(true);
    expect(body.previewPng, 'a canvas preview PNG').toBeTruthy();
    expect((body.previewPng ?? '').length).toBeGreaterThan(1000);
  }, 180000);

  it('the typeset preview renders the plot (staged .pdf) — no "File not found" abort', async () => {
    const r = await snippet('lblplot');
    expect(r.statusCode, r.body.slice(0, 600)).toBe(200);
    expect((r.json() as { pngBase64: string }).pngBase64.length).toBeGreaterThan(500);
  }, 180000);

  it('a 3D surface compiles live (splot) and produces a labelled preview', async () => {
    const r = await app.inject({
      method: 'POST', url: `/projects/${projectId}/gnuplot`, headers: auth,
      payload: {
        source: { type: 'function', expr: 'sin(sqrt(x^2+y^2))' },
        settings: { dim: '3d', xrange: '[-5:5]', yrange: '[-5:5]', xlabel: '$x$', ylabel: '$y$', zlabel: '$z$', plotStyle: 'lines', view: '60,30' },
        widthCm: 8, heightCm: 6, base: 'surf3d',
      },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { ok: boolean; stderr: string; previewPng?: string };
    expect(body.ok, body.stderr).toBe(true);
    expect((body.previewPng ?? '').length).toBeGreaterThan(1000);
    const snip = await snippet('surf3d');
    expect(snip.statusCode, snip.body.slice(0, 600)).toBe(200);
  }, 180000);

  it('a restyle regenerates the plot and the variant busts the stale preview cache', async () => {
    // Same base, new colour → new .pdf on disk; same TikZ text.
    await run('lblplot', { stroke: '#e8443d', strokeWidth: 3, dash: 'dashed' });
    const cached = await snippet('lblplot');              // no variant → cache hit (stale)
    expect((cached.json() as { cached: boolean }).cached).toBe(true);
    const busted = await snippet('lblplot', 'restyle-v2'); // variant → recompile
    expect((busted.json() as { cached: boolean }).cached).toBe(false);
    expect((busted.json() as { pngBase64: string }).pngBase64.length).toBeGreaterThan(500);
  }, 180000);
});
