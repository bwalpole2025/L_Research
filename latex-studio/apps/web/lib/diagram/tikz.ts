import {
  PX_PER_CM,
  type ArrowHead,
  type DiagramElement,
  type DiagramScene,
  type DiagramStyle,
  type EdgeElement,
  type NodeElement,
  type TemplateElement,
} from './model';
import { collectRequirements, getTemplate } from './templates/catalog';
import { PGFPLOTS_TIKZ_LIBS, type TemplateCtx } from './templates/types';

/**
 * SCENE → TikZ. The output is deliberately clean, human-readable and hand-
 * editable: named \node commands, \draw edges between node names (so TikZ does
 * its own anchoring), explicit coordinates in cm, and one comment block per
 * element group. Edits made to the exported file are NOT read back — the scene
 * JSON remains the source of truth.
 */

const f = (n: number): string => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? '0' : String(v);
};

/** Canvas px (y-down) → TikZ cm (y-up). */
const X = (x: number): string => f(x / PX_PER_CM);
const Y = (y: number): string => f(-y / PX_PER_CM);
const CM = (px: number): string => `${f(px / PX_PER_CM)}cm`;

// Classic built-in tips only (stealth/latex ship with TikZ core) — the export
// is \input into document BODIES, where \usetikzlibrary{arrows.meta} is not
// allowed, so the modern Stealth/Latex tips would break compiles.
const ARROW_TIP: Record<ArrowHead, string> = { none: '', arrow: '->', stealth: '-stealth', latex: '-latex' };

interface ColorTable {
  /** hex (lowercase, no #) → TikZ colour name. */
  map: Map<string, string>;
  resolve(hex: string): string;
}

function makeColors(): ColorTable {
  const map = new Map<string, string>();
  const NAMED: Record<string, string> = {
    '000000': 'black',
    'ffffff': 'white',
    'ff0000': 'red',
    '00ff00': 'green',
    '0000ff': 'blue',
  };
  return {
    map,
    resolve(hex: string): string {
      const h = hex.replace('#', '').toLowerCase();
      if (NAMED[h]) return NAMED[h];
      let name = map.get(h);
      if (!name) {
        name = `lsColor${map.size + 1}`;
        map.set(h, name);
      }
      return name;
    },
  };
}

function styleOptions(s: DiagramStyle, colors: ColorTable, extra: string[] = []): string {
  const opts: string[] = [...extra];
  if (s.stroke) opts.push(`draw=${colors.resolve(s.stroke)}`);
  if (s.strokeWidth && s.strokeWidth !== 0.4) opts.push(`line width=${f(s.strokeWidth)}pt`);
  if (s.dash !== 'solid') opts.push(s.dash);
  if (s.fill) opts.push(`fill=${colors.resolve(s.fill)}`);
  if (s.opacity < 1) opts.push(`opacity=${f(s.opacity)}`);
  return opts.filter(Boolean).join(', ');
}

function opt(parts: string): string {
  return parts ? `[${parts}]` : '';
}

/** Stable, readable node names: n1, n2, … in scene order. */
export function nodeNames(scene: DiagramScene): Map<string, string> {
  const names = new Map<string, string>();
  let i = 0;
  for (const el of scene.elements) {
    if (el.kind === 'node') {
      i += 1;
      names.set(el.id, `n${i}`);
    }
  }
  return names;
}

function nodeLine(n: NodeElement, name: string, colors: ColorTable): string {
  const shape = n.shape === 'rect' ? 'rectangle' : n.shape === 'circle' ? 'circle' : 'ellipse';
  const extra = [shape, `minimum width=${CM(n.w)}`, `minimum height=${CM(n.h)}`, 'inner sep=1pt'];
  if (n.rotation) extra.push(`rotate=${f(n.rotation)}`);
  if (n.style.fontSize) extra.push(`font=\\fontsize{${n.style.fontSize}}{${f(n.style.fontSize * 1.2)}}\\selectfont`);
  return `  \\node${opt(styleOptions(n.style, colors, extra))} (${name}) at (${X(n.x)},${Y(n.y)}) {${n.label}};`;
}

function edgeLine(e: EdgeElement, names: Map<string, string>, colors: ColorTable): string {
  const tip = ARROW_TIP[e.arrowHead];
  const optsStr = styleOptions({ ...e.style, fill: '' }, colors, tip ? [tip] : []);
  const end = (ep: EdgeElement['from']): string =>
    'node' in ep ? `(${names.get(ep.node) ?? '??'})` : `(${X(ep.x)},${Y(ep.y)})`;
  const connector = e.bend ? `to[bend ${e.bend > 0 ? 'left' : 'right'}=${f(Math.abs(e.bend))}]` : '--';
  const label = e.label
    ? ` node[${e.labelPos === 'midway' ? 'midway, fill=white, inner sep=2pt' : `midway, ${e.labelPos}`}] {${e.label}}`
    : '';
  return `  \\draw${opt(optsStr)} ${end(e.from)} ${connector} ${end(e.to)}${label};`;
}

function templateLines(el: TemplateElement, ctx: TemplateCtx): string[] {
  const t = getTemplate(el.templateId);
  if (!t) return [`  % unknown template "${el.templateId}"`];
  // Templates emit code around their own local origin; a shift-scope places
  // them, so the template code stays clean and composable.
  return [
    `  % template: ${t.name}`,
    `  \\begin{scope}[shift={(${X(el.x)},${Y(el.y)})}]`,
    ...t.exportLatex(el.params, ctx).map((l) => `    ${l}`),
    `  \\end{scope}`,
  ];
}

function elementLines(el: DiagramElement, names: Map<string, string>, colors: ColorTable, ctx: TemplateCtx): string[] {
  switch (el.kind) {
    case 'node':
      return [nodeLine(el, names.get(el.id) ?? 'n?', colors)];
    case 'edge':
      return [edgeLine(el, names, colors)];
    case 'rect': {
      const extra = el.rotation ? [`rotate around={${f(el.rotation)}:(${X(el.x + el.w / 2)},${Y(el.y + el.h / 2)})}`] : [];
      return [`  \\draw${opt(styleOptions(el.style, colors, extra))} (${X(el.x)},${Y(el.y)}) rectangle (${X(el.x + el.w)},${Y(el.y + el.h)});`];
    }
    case 'ellipse':
      return [`  \\draw${opt(styleOptions(el.style, colors))} (${X(el.cx)},${Y(el.cy)}) ellipse (${CM(el.rx)} and ${CM(el.ry)});`];
    case 'line': {
      const tip = ARROW_TIP[el.arrowHead];
      return [`  \\draw${opt(styleOptions(el.style, colors, tip ? [tip] : []))} (${X(el.x1)},${Y(el.y1)}) -- (${X(el.x2)},${Y(el.y2)});`];
    }
    case 'polygon': {
      const pts = el.points.map((p) => `(${X(p.x)},${Y(p.y)})`).join(' -- ');
      return [`  \\draw${opt(styleOptions(el.style, colors))} ${pts} -- cycle;`];
    }
    case 'path': {
      const pts = el.points.map((p) => `(${X(p.x)},${Y(p.y)})`);
      const body = el.smooth ? `plot[smooth${el.closed ? ' cycle' : ''}] coordinates {${pts.join(' ')}}` : pts.join(' -- ') + (el.closed ? ' -- cycle' : '');
      return [`  \\draw${opt(styleOptions(el.style, colors))} ${body};`];
    }
    case 'text': {
      const extra = ['anchor=west'];
      if (el.rotation) extra.push(`rotate=${f(el.rotation)}`);
      if (el.style.fontSize) extra.push(`font=\\fontsize{${el.style.fontSize}}{${f(el.style.fontSize * 1.2)}}\\selectfont`);
      const colour = el.style.stroke ? [`text=${colors.resolve(el.style.stroke)}`] : [];
      return [`  \\node[${[...extra, ...colour].join(', ')}] at (${X(el.x)},${Y(el.y)}) {${el.label}};`];
    }
    case 'raw-tikz':
      return ['  % raw TikZ (opaque — edited only as code):', ...el.code.split('\n').map((l) => `  ${l}`)];
    case 'plot': {
      if (!el.generatedBase) return [`  % plot "${el.id}" not generated yet — run GNUplot from the diagram editor`];
      // cairolatex output = a .tex overlay that \includegraphics its .pdf — place
      // it as a node so it sits where the canvas put it.
      return [
        `  \\node[anchor=north west, inner sep=0pt] at (${X(el.x)},${Y(el.y)}) {\\input{diagrams/plots/${el.generatedBase}.tex}};`,
      ];
    }
    case 'template':
      return templateLines(el, ctx);
  }
}

/** Preamble requirements of every template in the scene. */
export function sceneRequirements(scene: DiagramScene): { packages: string[]; libraries: string[] } {
  return collectRequirements(scene.elements.filter((e): e is TemplateElement => e.kind === 'template').map((e) => e.templateId));
}

export interface TikzExport {
  /** The .tikz file body (definecolor prelude + tikzpicture). */
  code: string;
  /** tikzpicture only — what the live preview compiles. */
  picture: string;
}

export function sceneToTikz(scene: DiagramScene, sourceName?: string): TikzExport {
  const colors = makeColors();
  const names = nodeNames(scene);
  const ctx: TemplateCtx = { view3d: scene.view3d, scale: PX_PER_CM };
  const requirements = sceneRequirements(scene);

  const body: string[] = [];
  const params = Object.entries(scene.params);
  if (params.length > 0) {
    body.push('  % parameters (usable from raw TikZ snippets)');
    for (const [k, v] of params) body.push(`  \\def\\${k}{${f(v)}}`);
  }
  const groups: Array<[string, DiagramElement['kind'][]]> = [
    ['template objects', ['template']],
    ['nodes', ['node']],
    ['edges', ['edge']],
    ['shapes', ['rect', 'ellipse', 'polygon', 'line', 'path']],
    ['labels', ['text']],
    ['plots', ['plot']],
    ['raw snippets', ['raw-tikz']],
  ];
  for (const [comment, kinds] of groups) {
    const els = scene.elements.filter((e) => kinds.includes(e.kind));
    if (els.length === 0) continue;
    body.push(`  % ${comment}`);
    for (const el of els) body.push(...elementLines(el, names, colors, ctx));
  }

  // The shared 3D frame — every tikz-3dplot template draws in
  // tdplot_main_coords, so one \tdplotsetmaincoords covers the whole figure.
  const header: string[] = [];
  if (requirements.packages.includes('tikz-3dplot')) {
    header.push(`\\tdplotsetmaincoords{${f(scene.view3d.theta)}}{${f(scene.view3d.phi)}}`);
  }

  const picture = [...header, `\\begin{tikzpicture}[>=stealth]`, ...body, `\\end{tikzpicture}`].join('\n');

  const prelude: string[] = [
    `% Generated by LaTeX Studio's diagram editor${sourceName ? ` from ${sourceName}` : ''}.`,
    '% The scene file is the source of truth — manual edits here are overwritten',
    '% on the next export (raw-tikz elements pass through verbatim).',
  ];
  if (requirements.packages.length > 0 || requirements.libraries.length > 0) {
    // \usepackage/\usetikzlibrary are illegal in document bodies, so the
    // requirements live in the PREAMBLE (the editor offers the exact lines).
    prelude.push('% requires in the preamble:');
    for (const p of requirements.packages) {
      prelude.push(`%   \\usepackage{${p}}${p === 'pgfplots' ? '  +  \\pgfplotsset{compat=newest}' : ''}`);
    }
    const tikzLibs = requirements.libraries.filter((l) => !PGFPLOTS_TIKZ_LIBS.has(l));
    const plotLibs = requirements.libraries.filter((l) => PGFPLOTS_TIKZ_LIBS.has(l));
    if (tikzLibs.length > 0) prelude.push(`%   \\usetikzlibrary{${tikzLibs.join(', ')}}`);
    if (plotLibs.length > 0) prelude.push(`%   \\usepgfplotslibrary{${plotLibs.join(', ')}}`);
  }
  for (const [hex, name] of colors.map) prelude.push(`\\definecolor{${name}}{HTML}{${hex.toUpperCase()}}`);

  return { code: `${prelude.join('\n')}\n${picture}\n`, picture };
}

/** Project-relative path the export is written to. */
export function tikzExportPath(diagramPath: string): string {
  const base = diagramPath.split('/').pop()!.replace(/\.diagram\.json$/i, '');
  return `diagrams/${base}.tikz`;
}

export function inputSnippet(diagramPath: string): string {
  return `\\input{${tikzExportPath(diagramPath)}}`;
}
