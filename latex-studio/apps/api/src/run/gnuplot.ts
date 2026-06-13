import { join } from 'node:path';
import type { AppConfig } from '../config.js';

/**
 * GNUPLOT SANDBOX PLAN — mirrors the Python runner discipline (ADR-013):
 * every run is a fresh `docker run --rm` from the pyrun image (which carries
 * gnuplot), non-root, CPU/memory/pids-limited, in-container timeout backstop,
 * and — unlike Python — the network is ALWAYS off: a plot never needs one.
 * The project source mounts READ-ONLY; only `diagrams/` (outputs) and the
 * run's scratch dir are writable. GNUplot never executes on the host outside
 * the explicitly-unsandboxed local dev mode shared with the Python runner.
 *
 * Output terminal: `cairolatex pdf` — the LaTeX-native terminal (text comes
 * out as a .tex overlay typeset by the DOCUMENT's fonts; curves in a .pdf the
 * overlay includes). Documented in docs/decisions.md; `pdfcairo` is the
 * fallback when a plain frozen PDF is wanted.
 */

export interface GnuplotInput {
  projectId: string;
  runId: string;
  /** Project-relative script path (inside the run scratch). */
  scriptRel: string;
  timeoutMs: number;
}

export interface GnuplotPlan {
  command: string;
  argv: string[];
  cwd?: string;
  containerName: string | null;
}

/**
 * Translate math/LaTeX-style function syntax into valid GNUplot. Users of the
 * Math Diagram naturally type `e^{x}`, `x^2`, `\ln x`, `\cdot`, `\frac{a}{b}` —
 * none of which GNUplot understands (it wants `exp()`, `**`, `log()`, `*`,
 * `(a)/(b)`). Only the plot EXPRESSION is translated; axis labels stay LaTeX
 * (the cairolatex terminal typesets them with the document's fonts).
 */
export function toGnuplotExpr(expr: string): string {
  let e = expr.trim();
  e = e.replace(/\\left|\\right/g, '');
  e = e.replace(/\\cdot|\\times|\\ast/g, '*');
  e = e.replace(/\\[,;!:]/g, '').replace(/\\ /g, ''); // thin spaces etc.
  e = e.replace(/\\pi\b/g, 'pi');
  // \frac{a}{b} -> ((a)/(b)); a few passes resolve simple nesting (innermost first).
  for (let i = 0; i < 5 && /\\frac/.test(e); i++) {
    e = e.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
  }
  // \sin, \cos, … -> sin, cos, … (drop the backslash GNUplot doesn't take).
  e = e.replace(/\\(sinh|cosh|tanh|asin|acos|atan|sin|cos|tan|exp|log|sqrt|abs)\b/g, '$1');
  // natural log: ln(...) -> log(...) (GNUplot's log IS the natural log).
  e = e.replace(/\bln\s*(?=\()/g, 'log');
  // Euler's number powers: e^{…} / e^(…) / e^token -> exp(…).
  e = e.replace(/\be\s*\^\s*\{([^{}]*)\}/g, 'exp($1)');
  e = e.replace(/\be\s*\^\s*\(([^()]*)\)/g, 'exp($1)');
  e = e.replace(/\be\s*\^\s*([A-Za-z0-9.]+)/g, 'exp($1)');
  // general powers: a^{b} -> a**(b); a^b -> a**b.
  e = e.replace(/\^\s*\{([^{}]*)\}/g, '**($1)');
  e = e.replace(/\^/g, '**');
  // any LaTeX grouping braces left over become parentheses.
  e = e.replace(/\{/g, '(').replace(/\}/g, ')');
  return e.trim();
}

/** The plot element's stroke colour/width/dash, emitted as GNUplot line options. */
export interface PlotStyle {
  stroke?: string | undefined; // hex, with or without '#'
  strokeWidth?: number | undefined; // px (≈ pt)
  dash?: string | undefined; // 'solid' | 'dashed' | 'dotted'
}

const HEX6 = /^#?[0-9a-fA-F]{6}$/;

/** Turn the element's style into GNUplot `plot ... with <style> <these>` options
 *  so the inspector's colour/width/dash actually change the rendered curve. */
function plotLineOptions(style: PlotStyle | undefined, plotStyle: string): string {
  if (!style) return '';
  const parts: string[] = [];
  if (style.stroke && HEX6.test(style.stroke)) parts.push(`lc rgb '#${style.stroke.replace('#', '').toLowerCase()}'`);
  if (style.strokeWidth && style.strokeWidth > 0) parts.push(`lw ${Math.max(0.5, Math.min(12, style.strokeWidth)).toFixed(1)}`);
  if (plotStyle !== 'points') {
    // dashtype — cairolatex honours it for line-based plots.
    const dt = style.dash === 'dashed' ? 2 : style.dash === 'dotted' ? 3 : 1;
    parts.push(`dt ${dt}`);
  }
  if (plotStyle === 'points' || plotStyle === 'linespoints') {
    parts.push(`pt 7 ps ${Math.max(0.4, Math.min(3, (style.strokeWidth ?? 1.4) / 1.6)).toFixed(1)}`);
  }
  return parts.join(' ');
}

/** Validate a 3D view ("rotx,rotz") to two clamped numbers — never let the
 *  raw string into `set view`. Defaults to gnuplot's classic 60,30. */
export function sanitizeView(v: string | undefined): string {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(v ?? '');
  if (!m) return '60,30';
  const rotx = Math.max(0, Math.min(180, Number.parseFloat(m[1]!)));
  const rotz = Math.max(0, Math.min(360, Number.parseFloat(m[2]!)));
  return `${rotx},${rotz}`;
}

export interface GnuplotSettings {
  /** '2d' (gnuplot `plot`, default) or '3d' surface (`splot`, f(x,y)). */
  dim?: '2d' | '3d' | undefined;
  xrange: string;
  yrange: string;
  zrange?: string | undefined;
  xlabel: string;
  ylabel: string;
  zlabel?: string | undefined;
  plotStyle: string;
  view?: string | undefined;
}

export function gnuplotScript(opts: {
  source: { type: 'function'; expr: string } | { type: 'data'; data: string };
  settings: GnuplotSettings;
  widthCm: number;
  heightCm: number;
  outBase: string; // e.g. diagrams/plots/plot-1
  dataRel?: string; // scratch-relative data file when source.type === 'data'
  style?: PlotStyle; // the element's stroke colour/width/dash
}): string {
  const { source, settings } = opts;
  const is3d = settings.dim === '3d';
  const esc = (t: string) => t.replace(/['\\]/g, '');
  const lines = [
    `set terminal cairolatex pdf size ${opts.widthCm.toFixed(2)}cm,${opts.heightCm.toFixed(2)}cm`,
    `set output '${opts.outBase}.tex'`,
  ];
  if (settings.xlabel) lines.push(`set xlabel '${esc(settings.xlabel)}'`);
  if (settings.ylabel) lines.push(`set ylabel '${esc(settings.ylabel)}'`);
  if (settings.xrange && settings.xrange !== '[]') lines.push(`set xrange ${settings.xrange}`);
  if (settings.yrange && settings.yrange !== '[]') lines.push(`set yrange ${settings.yrange}`);
  lines.push('set grid');

  if (is3d) {
    // 3D surface via splot f(x,y). pm3d = a colour-mapped surface (palette, so
    // no line colour); otherwise a hidden-line mesh in the element's stroke.
    if (settings.zlabel) lines.push(`set zlabel '${esc(settings.zlabel)}'`);
    if (settings.zrange && settings.zrange !== '[]') lines.push(`set zrange ${settings.zrange}`);
    lines.push(`set view ${sanitizeView(settings.view)}`);
    lines.push('set ticslevel 0');
    lines.push('set isosamples 40,40');
    lines.push('set samples 40,40');
    const pm3d = settings.plotStyle === 'pm3d';
    lines.push(pm3d ? 'set pm3d' : 'set hidden3d');
    const sstyle = pm3d ? 'pm3d' : settings.plotStyle === 'points' ? 'points' : 'lines';
    const lineOpts = pm3d ? '' : plotLineOptions(opts.style, sstyle);
    const withClause = `with ${sstyle}${lineOpts ? ` ${lineOpts}` : ''} notitle`;
    lines.push(source.type === 'function' ? `splot ${toGnuplotExpr(source.expr)} ${withClause}` : `splot '${opts.dataRel}' ${withClause}`);
    lines.push('unset output');
    return lines.join('\n') + '\n';
  }

  const style = ['lines', 'points', 'linespoints'].includes(settings.plotStyle) ? settings.plotStyle : 'lines';
  const lineOpts = plotLineOptions(opts.style, style);
  const withClause = `with ${style}${lineOpts ? ` ${lineOpts}` : ''} notitle`;
  if (source.type === 'function') {
    lines.push(`plot ${toGnuplotExpr(source.expr)} ${withClause}`);
  } else {
    lines.push(`plot '${opts.dataRel}' ${withClause}`);
  }
  lines.push('unset output');
  return lines.join('\n') + '\n';
}

export function buildGnuplotPlan(config: AppConfig, input: GnuplotInput): GnuplotPlan {
  if (config.pyrunMode === 'local') {
    // DEV/TEST ONLY — same explicit opt-out as the Python runner (ADR-013).
    return { command: 'gnuplot', argv: [input.scriptRel], cwd: join(config.compileWorkspace, input.projectId), containerName: null };
  }
  const backstopSecs = Math.ceil(input.timeoutMs / 1000) + 5;
  const projHost = join(config.pyrunWorkspaceHost, input.projectId);
  const containerName = `gnuplot-${input.projectId}-${input.runId}`;
  const argv = [
    'run',
    '--rm',
    '--name',
    containerName,
    '--network',
    'none', // ALWAYS off — plotting needs no network
    `--cpus=${config.pyrunCpus}`,
    `--memory=${config.pyrunMemory}`,
    `--pids-limit=${config.pyrunPids}`,
    '--user',
    config.pyrunUser,
    '-v',
    `${projHost}:/workspace:ro`,
    '-v',
    `${join(projHost, 'diagrams')}:/workspace/diagrams:rw`,
    '-v',
    `${join(projHost, '.gpout', input.runId)}:/workspace/.gpout/${input.runId}:rw`,
    '-w',
    '/workspace',
    config.pyrunImage,
    'sh',
    '-lc',
    `timeout -s KILL ${backstopSecs} gnuplot ${input.scriptRel}`,
  ];
  return { command: 'docker', argv, containerName };
}
