import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildGnuplotPlan, gnuplotScript, sanitizeView, toGnuplotExpr } from '../src/run/gnuplot.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('GNUplot sandbox plan (the security contract — asserted, not assumed)', () => {
  const cfg = { ...loadConfig(), pyrunMode: 'docker' as const };
  const plan = buildGnuplotPlan(cfg, { projectId: 'p1', runId: 'r1', scriptRel: '.gpout/r1/plot.gp', timeoutMs: 20_000 });

  it('runs in docker, never on the host', () => {
    expect(plan.command).toBe('docker');
    expect(plan.argv[0]).toBe('run');
    expect(plan.argv).toContain('--rm');
  });

  it('network is ALWAYS off (no opt-in exists for plots)', () => {
    const i = plan.argv.indexOf('--network');
    expect(i).toBeGreaterThan(0);
    expect(plan.argv[i + 1]).toBe('none');
  });

  it('non-root with CPU/memory/pids limits and an in-container timeout backstop', () => {
    expect(plan.argv).toContain('--user');
    expect(plan.argv.some((a) => a.startsWith('--cpus='))).toBe(true);
    expect(plan.argv.some((a) => a.startsWith('--memory='))).toBe(true);
    expect(plan.argv.some((a) => a.startsWith('--pids-limit='))).toBe(true);
    expect(plan.argv.at(-1)).toMatch(/^timeout -s KILL \d+ gnuplot/);
  });

  it('project source mounts READ-ONLY; only diagrams/ and the run scratch are writable', () => {
    const mounts = plan.argv.filter((_, i) => plan.argv[i - 1] === '-v');
    expect(mounts.some((m) => m.endsWith(':/workspace:ro'))).toBe(true);
    expect(mounts.some((m) => m.endsWith('/diagrams:/workspace/diagrams:rw'))).toBe(true);
    expect(mounts.some((m) => m.includes('.gpout/r1'))).toBe(true);
  });
});

describe('gnuplot script generation (cairolatex — LaTeX-native fonts)', () => {
  it('function plots target cairolatex pdf with size, ranges and labels', () => {
    const s = gnuplotScript({
      source: { type: 'function', expr: 'sin(x)/x' },
      settings: { xrange: '[-10:10]', yrange: '[]', xlabel: 'x', ylabel: 'y', plotStyle: 'lines' },
      widthCm: 8,
      heightCm: 6,
      outBase: 'diagrams/plots/p1',
    });
    expect(s).toContain('set terminal cairolatex pdf size 8.00cm,6.00cm');
    expect(s).toContain("set output 'diagrams/plots/p1.tex'");
    expect(s).toContain('set xrange [-10:10]');
    expect(s).not.toContain('set yrange'); // [] = auto
    expect(s).toContain('plot sin(x)/x with lines notitle');
  });

  it('translates math/LaTeX expression syntax to GNUplot (e^{x}, ^, ln, \\frac)', () => {
    expect(toGnuplotExpr('e^{x}*sin(x)/x')).toBe('exp(x)*sin(x)/x');
    expect(toGnuplotExpr('e^{x}*ln(x)/x')).toBe('exp(x)*log(x)/x'); // GNUplot log = natural log
    expect(toGnuplotExpr('x^2 + 2x')).toBe('x**2 + 2x');
    expect(toGnuplotExpr('e^{-x^2}')).toBe('exp(-x**2)');
    expect(toGnuplotExpr('\\frac{\\sin(x)}{x}')).toBe('((sin(x))/(x))');
    // valid GNUplot passes through untouched
    expect(toGnuplotExpr('exp(x)*sin(x)/x')).toBe('exp(x)*sin(x)/x');
    // the generated script embeds the TRANSLATED expression
    const s = gnuplotScript({
      source: { type: 'function', expr: 'e^{x}*sin(x)/x' },
      settings: { xrange: '', yrange: '', xlabel: '', ylabel: '', plotStyle: 'lines' },
      widthCm: 8,
      heightCm: 6,
      outBase: 'diagrams/plots/p',
    });
    expect(s).toContain('plot exp(x)*sin(x)/x with lines notitle');
  });

  it('applies the element style (colour, width, dash) as GNUplot line options', () => {
    const s = gnuplotScript({
      source: { type: 'function', expr: 'sin(x)' },
      settings: { xrange: '', yrange: '', xlabel: '', ylabel: '', plotStyle: 'lines' },
      style: { stroke: '#e05c7e', strokeWidth: 2.5, dash: 'dashed' },
      widthCm: 8,
      heightCm: 6,
      outBase: 'diagrams/plots/p',
    });
    expect(s).toContain("plot sin(x) with lines lc rgb '#e05c7e' lw 2.5 dt 2 notitle");
    // points style gets a marker; dotted dash maps to dt 3
    const pts = gnuplotScript({
      source: { type: 'function', expr: 'cos(x)' },
      settings: { xrange: '', yrange: '', xlabel: '', ylabel: '', plotStyle: 'linespoints' },
      style: { stroke: '#45b89e', strokeWidth: 1.4, dash: 'dotted' },
      widthCm: 6,
      heightCm: 4,
      outBase: 'diagrams/plots/q',
    });
    expect(pts).toMatch(/plot cos\(x\) with linespoints lc rgb '#45b89e' lw 1\.4 dt 3 pt 7 ps [\d.]+ notitle/);
  });

  it('data plots reference the staged data file', () => {
    const s = gnuplotScript({
      source: { type: 'data', data: '0 0\n1 1\n' },
      settings: { xrange: '', yrange: '', xlabel: '', ylabel: '', plotStyle: 'points' },
      widthCm: 6,
      heightCm: 4,
      outBase: 'diagrams/plots/d1',
      dataRel: '.gpout/r/data.dat',
    });
    expect(s).toContain("plot '.gpout/r/data.dat' with points notitle");
  });

  it('3D surfaces use splot with view/hidden3d (mesh) or pm3d (colour), z range + label', () => {
    const mesh = gnuplotScript({
      source: { type: 'function', expr: 'sin(sqrt(x^2+y^2))' },
      settings: { dim: '3d', xrange: '[-5:5]', yrange: '[-5:5]', zrange: '[-1:1]', xlabel: '$x$', ylabel: '$y$', zlabel: '$z$', plotStyle: 'lines', view: '60,30' },
      style: { stroke: '#4e68f5', strokeWidth: 2 },
      widthCm: 8,
      heightCm: 6,
      outBase: 'diagrams/plots/s1',
    });
    expect(mesh).toContain('set view 60,30');
    expect(mesh).toContain('set hidden3d');
    expect(mesh).toContain('set zlabel');
    expect(mesh).toContain('set zrange [-1:1]');
    expect(mesh).toContain("splot sin(sqrt(x**2+y**2)) with lines lc rgb '#4e68f5' lw 2.0 dt 1 notitle");
    expect(mesh).not.toContain('set pm3d');

    const colour = gnuplotScript({
      source: { type: 'function', expr: 'x*exp(-x^2-y^2)' },
      settings: { dim: '3d', xrange: '', yrange: '', xlabel: '', ylabel: '', plotStyle: 'pm3d' },
      widthCm: 8,
      heightCm: 6,
      outBase: 'diagrams/plots/s2',
    });
    expect(colour).toContain('set pm3d');
    expect(colour).toContain('splot x*exp(-x**2-y**2) with pm3d notitle'); // palette, no line colour
    expect(colour).not.toContain('set hidden3d');
  });

  it('the 3D view string is validated/clamped (never injected raw)', () => {
    expect(sanitizeView('60,30')).toBe('60,30');
    expect(sanitizeView('200,400')).toBe('180,360'); // clamped
    expect(sanitizeView('garbage; set output "/etc/x"')).toBe('60,30'); // rejected → default
    expect(sanitizeView(undefined)).toBe('60,30');
  });
});

describe('POST /projects/:id/gnuplot (live sandboxed run)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `gnuplot ${Date.now()}` } });
    projectId = p.json().id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('a function plot produces diagrams/plots/<base>.tex + .pdf as PROJECT FILES (cairolatex pair)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/gnuplot`,
      headers: auth,
      payload: {
        source: { type: 'function', expr: 'sin(x)/x' },
        settings: { xrange: '[-10:10]', yrange: '[]', xlabel: '$x$', ylabel: '$\\sin(x)/x$', plotStyle: 'lines' },
        widthCm: 8,
        heightCm: 6,
        base: 'testplot',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; stderr: string };
    expect(body.ok, body.stderr).toBe(true);

    const tex = await app.prisma.texFile.findUnique({ where: { projectId_path: { projectId, path: 'diagrams/plots/testplot.tex' } } });
    const pdf = await app.prisma.texFile.findUnique({ where: { projectId_path: { projectId, path: 'diagrams/plots/testplot.pdf' } } });
    expect(tex?.content).toContain('\\includegraphics'); // the LaTeX overlay includes the curve pdf
    expect(pdf?.encoding).toBe('base64');
    expect((pdf?.content ?? '').length).toBeGreaterThan(1000);
  }, 120000);

  it('plots a math-style expression once translated, in the chosen style (e^{x}*sin(x)/x)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/gnuplot`,
      headers: auth,
      payload: {
        source: { type: 'function', expr: 'e^{x}*sin(x)/x' }, // math syntax — would be invalid GNUplot untranslated
        settings: { xrange: '[-3:3]', yrange: '[]', xlabel: '$x$', ylabel: '$y$', plotStyle: 'lines' },
        style: { stroke: '#4e68f5', strokeWidth: 2, dash: 'dashed' },
        widthCm: 8,
        heightCm: 6,
        base: 'mathstyled',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; stderr: string };
    expect(body.ok, body.stderr).toBe(true);
    const pdf = await app.prisma.texFile.findUnique({ where: { projectId_path: { projectId, path: 'diagrams/plots/mathstyled.pdf' } } });
    expect((pdf?.content ?? '').length).toBeGreaterThan(1000);
  }, 120000);

  it('a GNUplot error surfaces in the output area (stderr), not as silence', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/gnuplot`,
      headers: auth,
      payload: {
        source: { type: 'function', expr: 'thisisnotafunction(((' },
        settings: { xrange: '', yrange: '', xlabel: '', ylabel: '', plotStyle: 'lines' },
        widthCm: 6,
        heightCm: 4,
        base: 'badplot',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; stderr: string };
    expect(body.ok).toBe(false);
    expect(body.stderr.length).toBeGreaterThan(0);
  }, 120000);
});
