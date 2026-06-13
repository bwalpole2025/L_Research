import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

/** Live: standalone TikZ + maths snippets compile through the real TeX engine
 *  and rasterise to PNG (the Visual editor's semi-compiled rendering). */
describe('POST /projects/:id/render-snippet (live texlive + mathcheck)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `snip ${Date.now()}` } });
    projectId = p.json().id;
    // A project macro the snippet should inherit.
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: { path: 'defs.tex', content: '\\newcommand{\\Bo}{\\mathrm{Bo}}\n\\usetikzlibrary{arrows.meta}\n\\usepackage{labmath}' },
    });
    // A project-local package whose macro depends on package machinery the
    // definition-extractor cannot reproduce — the snippet must \usepackage it.
    await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/files`,
      headers: auth,
      payload: {
        path: 'labmath.sty',
        content: '\\ProvidesPackage{labmath}\n\\newcommand{\\labdotbox}{\\mathbin{\\mbox{\\boldmath$\\cdot$}}}\n',
      },
    });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('renders a TikZ diagram to PNG; the second call is served from cache', async () => {
    const body = { kind: 'tikz', latex: '\\begin{tikzpicture}\\draw[->] (0,0) -- (2,1);\\draw (0,0) circle (0.5);\\end{tikzpicture}' };
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/render-snippet`, headers: auth, payload: body });
    expect(res.statusCode).toBe(200);
    const first = res.json() as { pngBase64: string; cached: boolean };
    expect(first.pngBase64.length).toBeGreaterThan(500); // a real image
    expect(first.cached).toBe(false);

    const again = await app.inject({ method: 'POST', url: `/projects/${projectId}/render-snippet`, headers: auth, payload: body });
    expect((again.json() as { cached: boolean }).cached).toBe(true);
  }, 120000);

  it('renders maths using the PROJECT macros (\\Bo compiles)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-snippet`,
      headers: auth,
      payload: { kind: 'math', latex: '\\Bo^{-1} \\eta_{xx} = \\frac{a}{b}' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { pngBase64: string }).pngBase64.length).toBeGreaterThan(500);
  }, 120000);

  it('renders maths from a PROJECT-LOCAL .sty package (loaded, not re-extracted)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-snippet`,
      headers: auth,
      payload: { kind: 'math', latex: '\\boldsymbol{u} \\labdotbox \\boldsymbol{v}', inline: true },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { pngBase64: string }).pngBase64.length).toBeGreaterThan(300);
  }, 120000);

  it('a display block with equation TAGS renders (align*), where aligned-in-$ would fail', async () => {
    // The inner content of an align environment with \tag on its rows — what the
    // Visual editor passes for a tagged equation. \tag is illegal inside `aligned`
    // / inline `$…$`, so this must be wrapped in a real numbered environment.
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-snippet`,
      headers: auth,
      payload: { kind: 'math', latex: 'E &= mc^2 \\tag{1} \\\\\n F &= ma \\tag{2}' },
    });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    expect((res.json() as { pngBase64: string }).pngBase64.length).toBeGreaterThan(500);

    // A single tagged equation (no &) too.
    const single = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-snippet`,
      headers: auth,
      payload: { kind: 'math', latex: '\\nabla \\cdot \\boldsymbol{u} = 0 \\tag{$\\ast$}' },
    });
    expect(single.statusCode, single.body.slice(0, 400)).toBe(200);
  }, 120000);

  it('a snippet that cannot compile returns 422 with a log tail (never a broken image)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/render-snippet`,
      headers: auth,
      payload: { kind: 'math', latex: '\\begin{nonsenseenv} x \\end{otherenv}' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/failed to compile/);
  }, 120000);
});
