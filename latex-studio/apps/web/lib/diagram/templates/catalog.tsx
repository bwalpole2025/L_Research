/**
 * THE STARTER CATALOGUE — every template is one data object; see types.ts for
 * the how-to-add guide. Categories: 2D Axes & Grids · 3D Axes · Vectors ·
 * 2D Shapes · 3D Solids · Curves & Wavy Lines · Sets & Logic.
 */

import React from 'react';
import {
  bool,
  defaults,
  fillOpt,
  fillOr,
  fmt,
  num,
  pgfView,
  project3d,
  str,
  type DiagramTemplate,
  type Params,
  type TemplateCtx,
} from './types';
import { setTemplateSizeHook, type TemplateElement } from '../model';

const INK = 'var(--ls-text, #1c2335)';
const S = 40; // canvas px per cm (mirrors PX_PER_CM)

// shorthand canvas helpers (local px coords, y down, origin at element centre)
const L = (x1: number, y1: number, x2: number, y2: number, key: string, dash?: string, color = INK, w = 1.3) => (
  <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} strokeDasharray={dash} />
);
const arrowAt = (x: number, y: number, angle: number, key: string, color = INK) => {
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  return (
    <path
      key={key}
      d={`M${x + Math.cos(a1) * 7},${y + Math.sin(a1) * 7} L${x},${y} L${x + Math.cos(a2) * 7},${y + Math.sin(a2) * 7}`}
      fill="none"
      stroke={color}
      strokeWidth={1.3}
    />
  );
};
const TXT = (x: number, y: number, text: string, key: string, size = 11) => (
  <text key={key} x={x} y={y} fontSize={size} fill={INK} fontStyle="italic" fontFamily="Georgia, serif">
    {text}
  </text>
);

// ════════════════════════════ 2D AXES & GRIDS ════════════════════════════

const axes2d: DiagramTemplate = {
  id: 'axes-2d',
  category: '2D Axes & Grids',
  name: 'Cartesian axes',
  description: 'x–y axes with ticks, labels, optional grid; quadrant variant',
  params: [
    { key: 'xmax', label: 'x max', type: 'number', default: 4, min: 1, max: 20, step: 1 },
    { key: 'ymax', label: 'y max', type: 'number', default: 3, min: 1, max: 20, step: 1 },
    { key: 'quadrants', label: 'Quadrants', type: 'select', default: 'first', options: ['first', 'all'] },
    { key: 'grid', label: 'Grid', type: 'boolean', default: true },
    { key: 'ticks', label: 'Ticks', type: 'boolean', default: true },
    { key: 'xlabel', label: 'x label', type: 'text', default: '$x$' },
    { key: 'ylabel', label: 'y label', type: 'text', default: '$y$' },
  ],
  requiredPackages: [],
  size: (p) => ({ w: (num(p, 'xmax') * (str(p, 'quadrants') === 'all' ? 2 : 1) + 1) * S, h: (num(p, 'ymax') * (str(p, 'quadrants') === 'all' ? 2 : 1) + 1) * S }),
  renderCanvas(p) {
    const all = str(p, 'quadrants') === 'all';
    const xm = num(p, 'xmax') * S;
    const ym = num(p, 'ymax') * S;
    const x0 = all ? -xm : 0;
    const y0 = all ? ym : 0;
    const out: React.ReactNode[] = [];
    if (bool(p, 'grid')) {
      for (let gx = Math.ceil(x0 / S) * S; gx <= xm; gx += S) out.push(L(gx, -ym, gx, y0, `gx${gx}`, '2 3', '#8884', 1));
      for (let gy = -ym; gy <= y0; gy += S) out.push(L(x0, gy, xm, gy, `gy${gy}`, '2 3', '#8884', 1));
    }
    out.push(L(x0 - 8, 0, xm + 12, 0, 'xa'), arrowAt(xm + 12, 0, 0, 'xh'));
    out.push(L(0, y0 + 8, 0, -ym - 12, 'ya'), arrowAt(0, -ym - 12, -Math.PI / 2, 'yh'));
    if (bool(p, 'ticks')) {
      for (let gx = Math.ceil(x0 / S) * S; gx <= xm; gx += S) if (gx !== 0) out.push(L(gx, -3, gx, 3, `tx${gx}`));
      for (let gy = -ym; gy <= y0; gy += S) if (gy !== 0) out.push(L(-3, gy, 3, gy, `ty${gy}`));
    }
    out.push(TXT(xm + 16, 4, str(p, 'xlabel').replace(/\$/g, ''), 'xl'));
    out.push(TXT(6, -ym - 14, str(p, 'ylabel').replace(/\$/g, ''), 'yl'));
    return <g>{out}</g>;
  },
  exportLatex(p) {
    const all = str(p, 'quadrants') === 'all';
    const xm = num(p, 'xmax');
    const ym = num(p, 'ymax');
    const x0 = all ? -xm : 0;
    const y0 = all ? -ym : 0;
    const out: string[] = [];
    if (bool(p, 'grid')) out.push(`\\draw[help lines, line width=0.2pt] (${fmt(x0)},${fmt(y0)}) grid (${fmt(xm)},${fmt(ym)});`);
    out.push(`\\draw[->] (${fmt(x0 - 0.2)},0) -- (${fmt(xm + 0.35)},0) node[right] {${str(p, 'xlabel')}};`);
    out.push(`\\draw[->] (0,${fmt(y0 - 0.2)}) -- (0,${fmt(ym + 0.35)}) node[above] {${str(p, 'ylabel')}};`);
    if (bool(p, 'ticks')) {
      out.push(`\\foreach \\x in {${fmt(x0 === 0 ? 1 : x0)},...,${fmt(xm)}} \\ifnum\\x=0\\else\\draw (\\x,0.07) -- (\\x,-0.07) node[below, font=\\scriptsize] {\\x};\\fi`);
      out.push(`\\foreach \\y in {${fmt(y0 === 0 ? 1 : y0)},...,${fmt(ym)}} \\ifnum\\y=0\\else\\draw (0.07,\\y) -- (-0.07,\\y) node[left, font=\\scriptsize] {\\y};\\fi`);
    }
    return out;
  },
};

const numberLine: DiagramTemplate = {
  id: 'number-line',
  category: '2D Axes & Grids',
  name: 'Number line',
  description: 'with marked interval; open/closed endpoints',
  params: [
    { key: 'min', label: 'min', type: 'number', default: -3, min: -50, max: 50, step: 1 },
    { key: 'max', label: 'max', type: 'number', default: 5, min: -50, max: 50, step: 1 },
    { key: 'a', label: 'interval a', type: 'number', default: -1, min: -50, max: 50, step: 0.5 },
    { key: 'b', label: 'interval b', type: 'number', default: 2, min: -50, max: 50, step: 0.5 },
    { key: 'aClosed', label: 'a closed', type: 'boolean', default: true },
    { key: 'bClosed', label: 'b closed', type: 'boolean', default: false },
  ],
  requiredPackages: [],
  size: (p) => ({ w: (num(p, 'max') - num(p, 'min') + 1.5) * S, h: 1.6 * S }),
  renderCanvas(p) {
    const min = num(p, 'min');
    const max = num(p, 'max');
    const X = (v: number) => (v - (min + max) / 2) * S;
    const out: React.ReactNode[] = [L(X(min) - 10, 0, X(max) + 14, 0, 'l'), arrowAt(X(max) + 14, 0, 0, 'h')];
    for (let v = Math.ceil(min); v <= max; v++) {
      out.push(L(X(v), -4, X(v), 4, `t${v}`));
      out.push(<text key={`n${v}`} x={X(v) - 3} y={18} fontSize={10} fill={INK}>{v}</text>);
    }
    const a = num(p, 'a');
    const b = num(p, 'b');
    out.push(<line key="iv" x1={X(a)} y1={-12} x2={X(b)} y2={-12} stroke="#4e68f5" strokeWidth={2.5} />);
    out.push(<circle key="ca" cx={X(a)} cy={-12} r={4} fill={bool(p, 'aClosed') ? '#4e68f5' : 'var(--ls-bg, #fff)'} stroke="#4e68f5" strokeWidth={1.6} />);
    out.push(<circle key="cb" cx={X(b)} cy={-12} r={4} fill={bool(p, 'bClosed') ? '#4e68f5' : 'var(--ls-bg, #fff)'} stroke="#4e68f5" strokeWidth={1.6} />);
    return <g>{out}</g>;
  },
  exportLatex(p) {
    const min = num(p, 'min');
    const max = num(p, 'max');
    const mid = (min + max) / 2;
    const X = (v: number) => fmt(v - mid);
    const a = num(p, 'a');
    const b = num(p, 'b');
    return [
      `\\draw[->] (${X(min - 0.25)},0) -- (${X(max + 0.35)},0);`,
      `\\foreach \\x in {${fmt(min)},...,${fmt(max)}} \\draw ({\\x-(${fmt(mid)})},0.08) -- ({\\x-(${fmt(mid)})},-0.08) node[below, font=\\scriptsize] {\\x};`,
      `\\draw[blue!70!black, very thick] (${X(a)},0.3) -- (${X(b)},0.3);`,
      `\\draw[blue!70!black, ${bool(p, 'aClosed') ? 'fill=blue!70!black' : 'fill=white'}, thick] (${X(a)},0.3) circle (0.07);`,
      `\\draw[blue!70!black, ${bool(p, 'bClosed') ? 'fill=blue!70!black' : 'fill=white'}, thick] (${X(b)},0.3) circle (0.07);`,
    ];
  },
};

const polarGrid: DiagramTemplate = {
  id: 'polar-grid',
  category: '2D Axes & Grids',
  name: 'Polar grid',
  description: 'concentric circles + radial spokes',
  params: [
    { key: 'rmax', label: 'max radius', type: 'number', default: 3, min: 1, max: 10, step: 1 },
    { key: 'spokes', label: 'spokes', type: 'number', default: 12, min: 4, max: 24, step: 2 },
  ],
  requiredPackages: [],
  size: (p) => ({ w: (num(p, 'rmax') * 2 + 1) * S, h: (num(p, 'rmax') * 2 + 1) * S }),
  renderCanvas(p) {
    const rm = num(p, 'rmax');
    const n = num(p, 'spokes');
    const out: React.ReactNode[] = [];
    for (let r = 1; r <= rm; r++) out.push(<circle key={`c${r}`} cx={0} cy={0} r={r * S} fill="none" stroke="#8886" strokeWidth={r === rm ? 1.4 : 0.8} />);
    for (let i = 0; i < n; i++) {
      const a = (i * 2 * Math.PI) / n;
      out.push(L(0, 0, rm * S * Math.cos(a), -rm * S * Math.sin(a), `s${i}`, undefined, '#8886', 0.8));
    }
    out.push(L(-rm * S - 8, 0, rm * S + 8, 0, 'x'), L(0, rm * S + 8, 0, -rm * S - 8, 'y'));
    return <g>{out}</g>;
  },
  exportLatex(p) {
    const rm = num(p, 'rmax');
    const n = num(p, 'spokes');
    return [
      `\\foreach \\r in {1,...,${fmt(rm)}} \\draw[gray!60, line width=0.25pt] (0,0) circle (\\r);`,
      `\\foreach \\a in {0,${fmt(360 / n)},...,${fmt(360 - 360 / n)}} \\draw[gray!60, line width=0.25pt] (0,0) -- (\\a:${fmt(rm)});`,
      `\\draw[->] (${fmt(-rm - 0.2)},0) -- (${fmt(rm + 0.3)},0);`,
      `\\draw[->] (0,${fmt(-rm - 0.2)}) -- (0,${fmt(rm + 0.3)});`,
    ];
  },
};

// ════════════════════════════ 3D AXES ════════════════════════════

function axis3dLines(len: number, ctx: TemplateCtx, ground: boolean): { canvas: React.ReactNode; tikz: string[] } {
  const pr = (x: number, y: number, z: number) => project3d(x, y, z, ctx.view3d, ctx.scale);
  const o = pr(0, 0, 0);
  const ex = pr(len, 0, 0);
  const ey = pr(0, len, 0);
  const ez = pr(0, 0, len);
  const canvas = (
    <g>
      {ground &&
        Array.from({ length: Math.floor(len) + 1 }, (_, i) => {
          const a1 = pr(i, 0, 0);
          const a2 = pr(i, len, 0);
          const b1 = pr(0, i, 0);
          const b2 = pr(len, i, 0);
          return (
            <g key={`g${i}`}>
              <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} stroke="#8885" strokeWidth={0.7} />
              <line x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} stroke="#8885" strokeWidth={0.7} />
            </g>
          );
        })}
      {L(o.x, o.y, ex.x, ex.y, 'x')}
      {arrowAt(ex.x, ex.y, Math.atan2(ex.y - o.y, ex.x - o.x), 'xh')}
      {L(o.x, o.y, ey.x, ey.y, 'y')}
      {arrowAt(ey.x, ey.y, Math.atan2(ey.y - o.y, ey.x - o.x), 'yh')}
      {L(o.x, o.y, ez.x, ez.y, 'z')}
      {arrowAt(ez.x, ez.y, Math.atan2(ez.y - o.y, ez.x - o.x), 'zh')}
      {TXT(ex.x + 6, ex.y + 4, 'x', 'lx')}
      {TXT(ey.x + 6, ey.y + 4, 'y', 'ly')}
      {TXT(ez.x + 6, ez.y - 4, 'z', 'lz')}
    </g>
  );
  const tikz = [
    ...(ground ? [`\\draw[tdplot_main_coords, gray!40, line width=0.25pt] (0,0,0) grid[step=1] (${fmt(len)},${fmt(len)});`] : []),
    `\\draw[tdplot_main_coords, ->] (0,0,0) -- (${fmt(len)},0,0) node[anchor=north east] {$x$};`,
    `\\draw[tdplot_main_coords, ->] (0,0,0) -- (0,${fmt(len)},0) node[anchor=north west] {$y$};`,
    `\\draw[tdplot_main_coords, ->] (0,0,0) -- (0,0,${fmt(len)}) node[anchor=south] {$z$};`,
  ];
  return { canvas, tikz };
}

const axes3d: DiagramTemplate = {
  id: 'axes-3d',
  category: '3D Axes',
  name: '3D axes',
  description: 'x, y, z axes in the SHARED view angle; optional ground grid',
  params: [
    { key: 'len', label: 'axis length', type: 'number', default: 3, min: 1, max: 10, step: 0.5 },
    { key: 'ground', label: 'ground grid', type: 'boolean', default: true },
  ],
  requiredPackages: ['tikz-3dplot'],
  size: (p) => ({ w: num(p, 'len') * 2.2 * S, h: num(p, 'len') * 2 * S }),
  renderCanvas: (p, ctx) => axis3dLines(num(p, 'len'), ctx, bool(p, 'ground')).canvas,
  exportLatex: (p, ctx) => axis3dLines(num(p, 'len'), ctx, bool(p, 'ground')).tikz,
};

// ════════════════════════════ VECTORS ════════════════════════════

const vector2d: DiagramTemplate = {
  id: 'vector-2d',
  category: 'Vectors',
  name: '2D vector',
  description: 'from a point, with optional dashed component projections',
  params: [
    { key: 'vx', label: 'x component', type: 'number', default: 2, min: -10, max: 10, step: 0.5 },
    { key: 'vy', label: 'y component', type: 'number', default: 1.5, min: -10, max: 10, step: 0.5 },
    { key: 'label', label: 'label', type: 'text', default: '$\\vec{v}$' },
    { key: 'projections', label: 'projections', type: 'boolean', default: true },
  ],
  requiredPackages: [],
  size: (p) => ({ w: (Math.abs(num(p, 'vx')) + 1) * S * 2, h: (Math.abs(num(p, 'vy')) + 1) * S * 2 }),
  renderCanvas(p) {
    const vx = num(p, 'vx') * S;
    const vy = -num(p, 'vy') * S;
    const out: React.ReactNode[] = [];
    if (bool(p, 'projections')) {
      out.push(L(vx, 0, vx, vy, 'p1', '4 3', '#888'));
      out.push(L(0, vy, vx, vy, 'p2', '4 3', '#888'));
    }
    out.push(L(0, 0, vx, vy, 'v', undefined, '#4e68f5', 1.8), arrowAt(vx, vy, Math.atan2(vy, vx), 'h', '#4e68f5'));
    out.push(TXT(vx / 2 + 6, vy / 2 - 6, str(p, 'label').replace(/\$/g, ''), 'l'));
    return <g>{out}</g>;
  },
  exportLatex(p) {
    const vx = num(p, 'vx');
    const vy = num(p, 'vy');
    const out: string[] = [];
    if (bool(p, 'projections')) {
      out.push(`\\draw[dashed, gray] (${fmt(vx)},0) -- (${fmt(vx)},${fmt(vy)});`);
      out.push(`\\draw[dashed, gray] (0,${fmt(vy)}) -- (${fmt(vx)},${fmt(vy)});`);
    }
    out.push(`\\draw[->, very thick, blue!70!black] (0,0) -- (${fmt(vx)},${fmt(vy)}) node[midway, above left] {${str(p, 'label')}};`);
    return out;
  },
};

const vector3d: DiagramTemplate = {
  id: 'vector-3d',
  category: 'Vectors',
  name: '3D vector',
  description: 'in the shared 3D frame, optional projections to the planes',
  params: [
    { key: 'vx', label: 'x', type: 'number', default: 2, min: -8, max: 8, step: 0.5 },
    { key: 'vy', label: 'y', type: 'number', default: 1.5, min: -8, max: 8, step: 0.5 },
    { key: 'vz', label: 'z', type: 'number', default: 2, min: -8, max: 8, step: 0.5 },
    { key: 'label', label: 'label', type: 'text', default: '$\\vec{r}$' },
    { key: 'projections', label: 'projections', type: 'boolean', default: true },
  ],
  requiredPackages: ['tikz-3dplot'],
  size: () => ({ w: 5 * S, h: 5 * S }),
  renderCanvas(p, ctx) {
    const pr = (x: number, y: number, z: number) => project3d(x, y, z, ctx.view3d, ctx.scale);
    const o = pr(0, 0, 0);
    const v = pr(num(p, 'vx'), num(p, 'vy'), num(p, 'vz'));
    const g = pr(num(p, 'vx'), num(p, 'vy'), 0);
    const out: React.ReactNode[] = [];
    if (bool(p, 'projections')) {
      out.push(L(o.x, o.y, g.x, g.y, 'pg', '4 3', '#888'));
      out.push(L(g.x, g.y, v.x, v.y, 'pv', '4 3', '#888'));
    }
    out.push(L(o.x, o.y, v.x, v.y, 'v', undefined, '#e8443d', 1.8), arrowAt(v.x, v.y, Math.atan2(v.y - o.y, v.x - o.x), 'h', '#e8443d'));
    out.push(TXT(v.x + 6, v.y - 4, str(p, 'label').replace(/\$/g, ''), 'l'));
    return <g>{out}</g>;
  },
  exportLatex(p) {
    const vx = fmt(num(p, 'vx'));
    const vy = fmt(num(p, 'vy'));
    const vz = fmt(num(p, 'vz'));
    const out: string[] = [];
    if (bool(p, 'projections')) {
      out.push(`\\draw[tdplot_main_coords, dashed, gray] (0,0,0) -- (${vx},${vy},0) -- (${vx},${vy},${vz});`);
    }
    out.push(`\\draw[tdplot_main_coords, ->, very thick, red!75!black] (0,0,0) -- (${vx},${vy},${vz}) node[anchor=south west] {${str(p, 'label')}};`);
    return out;
  },
};

const vectorAddition: DiagramTemplate = {
  id: 'vector-addition',
  category: 'Vectors',
  name: 'Vector addition',
  description: 'tip-to-tail or parallelogram',
  params: [
    { key: 'ax', label: 'a·x', type: 'number', default: 2, min: -8, max: 8, step: 0.5 },
    { key: 'ay', label: 'a·y', type: 'number', default: 0.5, min: -8, max: 8, step: 0.5 },
    { key: 'bx', label: 'b·x', type: 'number', default: 1, min: -8, max: 8, step: 0.5 },
    { key: 'by', label: 'b·y', type: 'number', default: 1.5, min: -8, max: 8, step: 0.5 },
    { key: 'mode', label: 'mode', type: 'select', default: 'tip-to-tail', options: ['tip-to-tail', 'parallelogram'] },
  ],
  requiredPackages: [],
  size: () => ({ w: 6 * S, h: 5 * S }),
  renderCanvas(p) {
    const ax = num(p, 'ax') * S;
    const ay = -num(p, 'ay') * S;
    const bx = num(p, 'bx') * S;
    const by = -num(p, 'by') * S;
    const para = str(p, 'mode') === 'parallelogram';
    const out: React.ReactNode[] = [
      L(0, 0, ax, ay, 'a', undefined, '#4e68f5', 1.8),
      arrowAt(ax, ay, Math.atan2(ay, ax), 'ah', '#4e68f5'),
      TXT(ax / 2, ay / 2 - 8, 'a', 'al'),
      L(0, 0, ax + bx, ay + by, 's', undefined, '#45b89e', 1.8),
      arrowAt(ax + bx, ay + by, Math.atan2(ay + by, ax + bx), 'sh', '#45b89e'),
      TXT((ax + bx) / 2 + 8, (ay + by) / 2 + 12, 'a+b', 'sl'),
    ];
    if (para) {
      out.push(L(0, 0, bx, by, 'b', undefined, '#e8443d', 1.8), arrowAt(bx, by, Math.atan2(by, bx), 'bh', '#e8443d'), TXT(bx / 2 - 14, by / 2, 'b', 'bl'));
      out.push(L(ax, ay, ax + bx, ay + by, 'd1', '4 3', '#888'), L(bx, by, ax + bx, ay + by, 'd2', '4 3', '#888'));
    } else {
      out.push(L(ax, ay, ax + bx, ay + by, 'b', undefined, '#e8443d', 1.8), arrowAt(ax + bx, ay + by, Math.atan2(by, bx), 'bh', '#e8443d'), TXT(ax + bx / 2 + 6, ay + by / 2, 'b', 'bl'));
    }
    return <g>{out}</g>;
  },
  exportLatex(p) {
    const ax = fmt(num(p, 'ax'));
    const ay = fmt(num(p, 'ay'));
    const sx = fmt(num(p, 'ax') + num(p, 'bx'));
    const sy = fmt(num(p, 'ay') + num(p, 'by'));
    const bx = fmt(num(p, 'bx'));
    const by = fmt(num(p, 'by'));
    const para = str(p, 'mode') === 'parallelogram';
    const out = [
      `\\draw[->, very thick, blue!70!black] (0,0) -- (${ax},${ay}) node[midway, above] {$\\vec{a}$};`,
      para
        ? `\\draw[->, very thick, red!75!black] (0,0) -- (${bx},${by}) node[midway, left] {$\\vec{b}$};`
        : `\\draw[->, very thick, red!75!black] (${ax},${ay}) -- (${sx},${sy}) node[midway, right] {$\\vec{b}$};`,
      `\\draw[->, very thick, green!50!black] (0,0) -- (${sx},${sy}) node[near end, below right] {$\\vec{a}+\\vec{b}$};`,
    ];
    if (para) out.push(`\\draw[dashed, gray] (${ax},${ay}) -- (${sx},${sy}) (${bx},${by}) -- (${sx},${sy});`);
    return out;
  },
};

const basisVectors: DiagramTemplate = {
  id: 'basis-vectors',
  category: 'Vectors',
  name: 'Basis vectors',
  description: 'î, ĵ (2D) or î, ĵ, k̂ (3D, shared view)',
  params: [{ key: 'dims', label: 'dimensions', type: 'select', default: '2D', options: ['2D', '3D'] }],
  requiredPackages: ['tikz-3dplot'],
  size: () => ({ w: 3 * S, h: 3 * S }),
  renderCanvas(p, ctx) {
    if (str(p, 'dims') === '2D') {
      return (
        <g>
          {L(0, 0, S, 0, 'i', undefined, '#4e68f5', 1.8)}
          {arrowAt(S, 0, 0, 'ih', '#4e68f5')}
          {TXT(S / 2 - 3, 16, 'î', 'il')}
          {L(0, 0, 0, -S, 'j', undefined, '#e8443d', 1.8)}
          {arrowAt(0, -S, -Math.PI / 2, 'jh', '#e8443d')}
          {TXT(-16, -S / 2, 'ĵ', 'jl')}
        </g>
      );
    }
    const pr = (x: number, y: number, z: number) => project3d(x, y, z, ctx.view3d, ctx.scale);
    const o = pr(0, 0, 0);
    const pts = [pr(1, 0, 0), pr(0, 1, 0), pr(0, 0, 1)];
    const cols = ['#4e68f5', '#e8443d', '#45b89e'];
    const labels = ['î', 'ĵ', 'k̂'];
    return (
      <g>
        {pts.map((q, i) => (
          <g key={i}>
            <line x1={o.x} y1={o.y} x2={q.x} y2={q.y} stroke={cols[i]} strokeWidth={1.8} />
            {arrowAt(q.x, q.y, Math.atan2(q.y - o.y, q.x - o.x), `h${i}`, cols[i])}
            {TXT(q.x + 5, q.y, labels[i]!, `l${i}`)}
          </g>
        ))}
      </g>
    );
  },
  exportLatex(p) {
    if (str(p, 'dims') === '2D') {
      return [
        `\\draw[->, very thick, blue!70!black] (0,0) -- (1,0) node[below] {$\\hat{\\imath}$};`,
        `\\draw[->, very thick, red!75!black] (0,0) -- (0,1) node[left] {$\\hat{\\jmath}$};`,
      ];
    }
    return [
      `\\draw[tdplot_main_coords, ->, very thick, blue!70!black] (0,0,0) -- (1,0,0) node[anchor=north] {$\\hat{\\imath}$};`,
      `\\draw[tdplot_main_coords, ->, very thick, red!75!black] (0,0,0) -- (0,1,0) node[anchor=west] {$\\hat{\\jmath}$};`,
      `\\draw[tdplot_main_coords, ->, very thick, green!50!black] (0,0,0) -- (0,0,1) node[anchor=south] {$\\hat{k}$};`,
    ];
  },
};

// ════════════════════════════ 2D SHAPES ════════════════════════════

const circleT: DiagramTemplate = {
  id: 'circle',
  category: '2D Shapes',
  name: 'Circle',
  description: 'centre dot + radius marker + label',
  params: [
    { key: 'r', label: 'radius', type: 'number', default: 1.5, min: 0.2, max: 10, step: 0.1 },
    { key: 'label', label: 'radius label', type: 'text', default: '$r$' },
    { key: 'showRadius', label: 'radius marker', type: 'boolean', default: true },
  ],
  requiredPackages: [],
  size: (p) => ({ w: num(p, 'r') * 2 * S + 20, h: num(p, 'r') * 2 * S + 20 }),
  renderCanvas(p, ctx) {
    const r = num(p, 'r') * S;
    return (
      <g>
        <circle cx={0} cy={0} r={r} fill={fillOr(ctx, 'none')} stroke={INK} strokeWidth={1.4} />
        <circle cx={0} cy={0} r={2.2} fill={INK} />
        {bool(p, 'showRadius') && (
          <>
            {L(0, 0, r * Math.cos(-0.6), r * Math.sin(-0.6), 'r')}
            {TXT((r / 2) * Math.cos(-0.6) + 4, (r / 2) * Math.sin(-0.6) - 4, str(p, 'label').replace(/\$/g, ''), 'rl')}
          </>
        )}
      </g>
    );
  },
  exportLatex(p, ctx) {
    const r = fmt(num(p, 'r'));
    const out = [`\\draw${fillOpt(ctx)} (0,0) circle (${r});`, `\\fill (0,0) circle (0.04);`];
    if (bool(p, 'showRadius')) out.push(`\\draw (0,0) -- (34:${r}) node[midway, above, sloped] {${str(p, 'label')}};`);
    return out;
  },
};

const ellipseT: DiagramTemplate = {
  id: 'ellipse',
  category: '2D Shapes',
  name: 'Ellipse',
  description: 'semi-axes a, b',
  params: [
    { key: 'a', label: 'a (x semi-axis)', type: 'number', default: 2, min: 0.2, max: 10, step: 0.1 },
    { key: 'b', label: 'b (y semi-axis)', type: 'number', default: 1.2, min: 0.2, max: 10, step: 0.1 },
  ],
  requiredPackages: [],
  size: (p) => ({ w: num(p, 'a') * 2 * S + 20, h: num(p, 'b') * 2 * S + 20 }),
  renderCanvas: (p, ctx) => <ellipse cx={0} cy={0} rx={num(p, 'a') * S} ry={num(p, 'b') * S} fill={fillOr(ctx, 'none')} stroke={INK} strokeWidth={1.4} />,
  exportLatex: (p, ctx) => [`\\draw${fillOpt(ctx)} (0,0) ellipse (${fmt(num(p, 'a'))} and ${fmt(num(p, 'b'))});`],
};

const arcSector: DiagramTemplate = {
  id: 'arc-sector',
  category: '2D Shapes',
  name: 'Arc / sector',
  description: 'arc between two angles; optional filled sector',
  params: [
    { key: 'r', label: 'radius', type: 'number', default: 1.5, min: 0.2, max: 10, step: 0.1 },
    { key: 'from', label: 'from °', type: 'number', default: 0, min: -360, max: 360, step: 5 },
    { key: 'to', label: 'to °', type: 'number', default: 60, min: -360, max: 360, step: 5 },
    { key: 'sector', label: 'filled sector', type: 'boolean', default: true },
  ],
  requiredPackages: [],
  size: (p) => ({ w: num(p, 'r') * 2 * S + 20, h: num(p, 'r') * 2 * S + 20 }),
  renderCanvas(p, ctx) {
    const r = num(p, 'r') * S;
    const a0 = (-num(p, 'from') * Math.PI) / 180;
    const a1 = (-num(p, 'to') * Math.PI) / 180;
    const large = Math.abs(num(p, 'to') - num(p, 'from')) > 180 ? 1 : 0;
    const p0 = { x: r * Math.cos(a0), y: r * Math.sin(a0) };
    const p1 = { x: r * Math.cos(a1), y: r * Math.sin(a1) };
    const d = bool(p, 'sector')
      ? `M0,0 L${p0.x},${p0.y} A${r},${r} 0 ${large} 0 ${p1.x},${p1.y} Z`
      : `M${p0.x},${p0.y} A${r},${r} 0 ${large} 0 ${p1.x},${p1.y}`;
    return <path d={d} fill={bool(p, 'sector') ? fillOr(ctx, 'rgba(78,104,245,0.15)') : 'none'} stroke={INK} strokeWidth={1.4} />;
  },
  exportLatex(p, ctx) {
    const r = fmt(num(p, 'r'));
    const a0 = fmt(num(p, 'from'));
    const a1 = fmt(num(p, 'to'));
    return bool(p, 'sector')
      ? [`\\draw[fill=${fillOr(ctx, 'blue!15')}] (0,0) -- (${a0}:${r}) arc (${a0}:${a1}:${r}) -- cycle;`]
      : [`\\draw (${a0}:${r}) arc (${a0}:${a1}:${r});`];
  },
};

const angleMark: DiagramTemplate = {
  id: 'angle-mark',
  category: '2D Shapes',
  name: 'Angle mark',
  description: 'two rays + arc with optional value label',
  params: [
    { key: 'angle', label: 'angle °', type: 'number', default: 40, min: 5, max: 355, step: 5 },
    { key: 'label', label: 'label', type: 'text', default: '$\\theta$' },
    { key: 'rayLen', label: 'ray length', type: 'number', default: 2, min: 0.5, max: 8, step: 0.5 },
  ],
  requiredPackages: [],
  size: (p) => ({ w: num(p, 'rayLen') * 2 * S, h: num(p, 'rayLen') * 2 * S }),
  renderCanvas(p) {
    const len = num(p, 'rayLen') * S;
    const a = (-num(p, 'angle') * Math.PI) / 180;
    const r = 0.55 * S;
    return (
      <g>
        {L(0, 0, len, 0, 'r1')}
        {L(0, 0, len * Math.cos(a), len * Math.sin(a), 'r2')}
        <path d={`M${r},0 A${r},${r} 0 0 0 ${r * Math.cos(a)},${r * Math.sin(a)}`} fill="none" stroke="#4e68f5" strokeWidth={1.4} />
        {TXT(r * 1.45 * Math.cos(a / 2), r * 1.45 * Math.sin(a / 2) + 4, str(p, 'label').replace(/\$/g, ''), 'l')}
      </g>
    );
  },
  exportLatex(p) {
    const len = fmt(num(p, 'rayLen'));
    const ang = fmt(num(p, 'angle'));
    return [
      `\\draw (${len},0) -- (0,0) -- (${ang}:${len});`,
      `\\draw[blue!70!black] (0.55,0) arc (0:${ang}:0.55);`,
      `\\node at (${fmt(num(p, 'angle') / 2)}:0.85) {${str(p, 'label')}};`,
    ];
  },
};

const regularPolygon: DiagramTemplate = {
  id: 'regular-polygon',
  category: '2D Shapes',
  name: 'Regular polygon',
  description: 'triangle / square / pentagon / hexagon',
  params: [
    { key: 'sides', label: 'sides', type: 'select', default: '5', options: ['3', '4', '5', '6'] },
    { key: 'r', label: 'circumradius', type: 'number', default: 1.5, min: 0.3, max: 8, step: 0.1 },
  ],
  requiredPackages: [],
  size: (p) => ({ w: num(p, 'r') * 2 * S + 16, h: num(p, 'r') * 2 * S + 16 }),
  renderCanvas(p, ctx) {
    const n = Number(str(p, 'sides'));
    const r = num(p, 'r') * S;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i * 2 * Math.PI) / n - Math.PI / 2;
      return `${r * Math.cos(a)},${r * Math.sin(a)}`;
    }).join(' ');
    return <polygon points={pts} fill={fillOr(ctx, 'none')} stroke={INK} strokeWidth={1.4} />;
  },
  exportLatex(p, ctx) {
    const n = Number(str(p, 'sides'));
    const r = num(p, 'r');
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i * 360) / n + 90;
      return `(${fmt(a)}:${fmt(r)})`;
    });
    return [`\\draw${fillOpt(ctx)} ${pts.join(' -- ')} -- cycle;`];
  },
};

const segmentRay: DiagramTemplate = {
  id: 'segment-ray',
  category: '2D Shapes',
  name: 'Line / segment / ray',
  description: 'between two points, with end style',
  params: [
    { key: 'x2', label: 'Δx', type: 'number', default: 3, min: -10, max: 10, step: 0.5 },
    { key: 'y2', label: 'Δy', type: 'number', default: 1, min: -10, max: 10, step: 0.5 },
    { key: 'mode', label: 'mode', type: 'select', default: 'segment', options: ['segment', 'ray', 'line'] },
  ],
  requiredPackages: [],
  size: (p) => ({ w: (Math.abs(num(p, 'x2')) + 1) * 2 * S, h: (Math.abs(num(p, 'y2')) + 1) * 2 * S }),
  renderCanvas(p) {
    const x = num(p, 'x2') * S;
    const y = -num(p, 'y2') * S;
    const mode = str(p, 'mode');
    const ang = Math.atan2(y, x);
    return (
      <g>
        {L(mode === 'line' ? -x : 0, mode === 'line' ? -y : 0, x, y, 's')}
        {mode !== 'segment' && arrowAt(x, y, ang, 'h1')}
        {mode === 'line' && arrowAt(-x, -y, ang + Math.PI, 'h2')}
        <circle cx={0} cy={0} r={2.2} fill={INK} />
      </g>
    );
  },
  exportLatex(p) {
    const x = fmt(num(p, 'x2'));
    const y = fmt(num(p, 'y2'));
    const mode = str(p, 'mode');
    if (mode === 'segment') return [`\\draw (0,0) -- (${x},${y});`, `\\fill (0,0) circle (0.035);`];
    if (mode === 'ray') return [`\\draw[->] (0,0) -- (${x},${y});`, `\\fill (0,0) circle (0.035);`];
    return [`\\draw[<->] (${fmt(-num(p, 'x2'))},${fmt(-num(p, 'y2'))}) -- (${x},${y});`];
  },
};

const tangentLine: DiagramTemplate = {
  id: 'tangent-line',
  category: '2D Shapes',
  name: 'Tangent line',
  description: 'circle + tangent at an angle',
  params: [
    { key: 'r', label: 'radius', type: 'number', default: 1.2, min: 0.3, max: 6, step: 0.1 },
    { key: 'at', label: 'tangent at °', type: 'number', default: 50, min: 0, max: 360, step: 5 },
    { key: 'len', label: 'tangent length', type: 'number', default: 2, min: 0.5, max: 8, step: 0.5 },
  ],
  requiredPackages: [],
  size: (p) => ({ w: (num(p, 'r') + num(p, 'len')) * 2 * S, h: (num(p, 'r') + num(p, 'len')) * 2 * S }),
  renderCanvas(p) {
    const r = num(p, 'r') * S;
    const a = (-num(p, 'at') * Math.PI) / 180;
    const len = num(p, 'len') * S;
    const px = r * Math.cos(a);
    const py = r * Math.sin(a);
    const tx = -Math.sin(a);
    const ty = Math.cos(a);
    return (
      <g>
        <circle cx={0} cy={0} r={r} fill="none" stroke={INK} strokeWidth={1.4} />
        {L(px - tx * len, py - ty * len, px + tx * len, py + ty * len, 't', undefined, '#4e68f5', 1.5)}
        <circle cx={px} cy={py} r={2.5} fill="#4e68f5" />
      </g>
    );
  },
  exportLatex(p) {
    const r = fmt(num(p, 'r'));
    const at = fmt(num(p, 'at'));
    const len = fmt(num(p, 'len'));
    return [
      `\\draw (0,0) circle (${r});`,
      `\\draw[blue!70!black] ([shift={(${at}:${r})}] ${fmt(num(p, 'at') + 90)}:${len}) -- ([shift={(${at}:${r})}] ${fmt(num(p, 'at') - 90)}:${len});`,
      `\\fill[blue!70!black] (${at}:${r}) circle (0.045);`,
    ];
  },
};

// ════════════════════════════ 3D SOLIDS ════════════════════════════
// Shaded smooth solids → pgfplots \addplot3[surf]; wireframe/great-circle
// styles → tikz-3dplot. Everything respects the SHARED view angle.

function surfAxisOpen(view: { az: number; el: number }): string {
  return `\\begin{axis}[hide axis, view={${fmt(view.az)}}{${fmt(view.el)}}, axis equal image, anchor=origin, at={(0,0)}, disabledatascaling]`;
}

/** Canvas approximation of a solid: projected silhouette curves. */
function solidOutline(kind: string, p: Params, ctx: TemplateCtx): React.ReactNode {
  const pr = (x: number, y: number, z: number) => project3d(x, y, z, ctx.view3d, ctx.scale);
  const path = (pts: Array<{ x: number; y: number }>, key: string, dash?: string, close = false) => (
    <polyline
      key={key}
      points={(close ? [...pts, pts[0]!] : pts).map((q) => `${q.x},${q.y}`).join(' ')}
      fill="none"
      stroke={INK}
      strokeWidth={1.3}
      strokeDasharray={dash}
    />
  );
  const ring = (z: number, r: number, key: string, dash?: string) =>
    path(Array.from({ length: 49 }, (_, i) => {
      const a = (i * 2 * Math.PI) / 48;
      return pr(r * Math.cos(a), r * Math.sin(a), z);
    }), key, dash, true);

  switch (kind) {
    case 'sphere': {
      const r = num(p, 'r', 1.5);
      const R = r * ctx.scale; // projected silhouette of a sphere is a circle of radius r
      const out: React.ReactNode[] = [<circle key="sil" cx={0} cy={0} r={R} fill="rgba(78,104,245,0.08)" stroke={INK} strokeWidth={1.4} />];
      if (bool(p, 'equator', true)) out.push(ring(0, r, 'eq'));
      if (bool(p, 'meridian', true))
        out.push(path(Array.from({ length: 49 }, (_, i) => {
          const a = (i * 2 * Math.PI) / 48;
          return pr(r * Math.cos(a), 0, r * Math.sin(a));
        }), 'mer', '4 3', true));
      return <g>{out}</g>;
    }
    case 'hemisphere': {
      const r = num(p, 'r', 1.5);
      const R = r * ctx.scale;
      return (
        <g>
          <path d={`M${-R},0 A${R},${R} 0 0 1 ${R},0`} fill="rgba(78,104,245,0.08)" stroke={INK} strokeWidth={1.4} />
          {ring(0, r, 'base')}
        </g>
      );
    }
    case 'cylinder': {
      const r = num(p, 'r', 1);
      const h = num(p, 'h', 2);
      const a = pr(-r, 0, 0);
      const b = pr(-r, 0, h);
      const c = pr(r, 0, 0);
      const d = pr(r, 0, h);
      return (
        <g>
          {ring(0, r, 'b0')}
          {ring(h, r, 'b1')}
          {L(a.x, a.y, b.x, b.y, 's1')}
          {L(c.x, c.y, d.x, d.y, 's2')}
        </g>
      );
    }
    case 'cone': {
      const r = num(p, 'r', 1);
      const h = num(p, 'h', 2);
      const apex = pr(0, 0, h);
      const a = pr(-r, 0, 0);
      const c = pr(r, 0, 0);
      return (
        <g>
          {ring(0, r, 'base')}
          {L(a.x, a.y, apex.x, apex.y, 's1')}
          {L(c.x, c.y, apex.x, apex.y, 's2')}
        </g>
      );
    }
    case 'box': {
      const a = num(p, 'a', 2);
      const b = num(p, 'b', 1.5);
      const c = num(p, 'c', 1);
      const v = [
        pr(0, 0, 0), pr(a, 0, 0), pr(a, b, 0), pr(0, b, 0),
        pr(0, 0, c), pr(a, 0, c), pr(a, b, c), pr(0, b, c),
      ];
      const E: Array<[number, number, boolean]> = [
        [0, 1, false], [1, 2, false], [2, 3, true], [3, 0, true],
        [4, 5, false], [5, 6, false], [6, 7, false], [7, 4, false],
        [0, 4, false], [1, 5, false], [2, 6, false], [3, 7, true],
      ];
      return <g>{E.map(([i, j, hidden], k) => L(v[i]!.x, v[i]!.y, v[j]!.x, v[j]!.y, `e${k}`, hidden ? '4 3' : undefined))}</g>;
    }
    case 'plane-patch': {
      const a = num(p, 'a', 2.5);
      const b = num(p, 'b', 2);
      const v = [pr(0, 0, 0), pr(a, 0, 0), pr(a, b, 0), pr(0, b, 0), pr(0, 0, 0)];
      return (
        <g>
          <polygon points={v.slice(0, 4).map((q) => `${q.x},${q.y}`).join(' ')} fill="rgba(69,184,158,0.12)" stroke={INK} strokeWidth={1.3} />
        </g>
      );
    }
    case 'torus': {
      const R = num(p, 'R', 1.5);
      const r = num(p, 'r', 0.4);
      return (
        <g>
          {ring(0, R + r, 'outer')}
          {ring(0, R - r, 'inner')}
        </g>
      );
    }
    default:
      return null;
  }
}

function solidTemplate(opts: {
  id: string;
  name: string;
  description: string;
  params: DiagramTemplate['params'];
  packages: string[];
  exportLatex: DiagramTemplate['exportLatex'];
  sizeCm: (p: Params) => number;
}): DiagramTemplate {
  return {
    id: opts.id,
    category: '3D Solids',
    name: opts.name,
    description: `${opts.description} (canvas is a projected approximation — the export is the fidelity target)`,
    params: opts.params,
    requiredPackages: opts.packages,
    size: (p) => ({ w: opts.sizeCm(p) * 2 * S, h: opts.sizeCm(p) * 2 * S }),
    renderCanvas: (p, ctx) => solidOutline(opts.id === 'plane-patch' ? 'plane-patch' : opts.id, p, ctx),
    exportLatex: opts.exportLatex,
  };
}

const sphere = solidTemplate({
  id: 'sphere',
  name: 'Sphere',
  description: 'silhouette + equator + meridian (tikz-3dplot)',
  params: [
    { key: 'r', label: 'radius', type: 'number', default: 1.5, min: 0.3, max: 6, step: 0.1 },
    { key: 'equator', label: 'equator', type: 'boolean', default: true },
    { key: 'meridian', label: 'meridian', type: 'boolean', default: true },
  ],
  packages: ['tikz-3dplot'],
  sizeCm: (p) => num(p, 'r', 1.5) + 0.4,
  exportLatex(p, ctx) {
    const r = num(p, 'r', 1.5);
    const out = [`\\draw[fill=blue!8, opacity=0.9] (0,0) circle (${fmt(r)});`];
    if (bool(p, 'equator', true)) {
      // the equator's projected ellipse: minor axis shrinks with cos(theta)
      out.push(`\\draw (0,0) ellipse (${fmt(r)} and ${fmt(Math.abs(Math.cos((ctx.view3d.theta * Math.PI) / 180)) * r)});`);
    }
    if (bool(p, 'meridian', true)) {
      out.push(`\\draw[tdplot_main_coords, dashed] plot[domain=0:360, samples=72, smooth] ({${fmt(r)}*cos(\\x)}, 0, {${fmt(r)}*sin(\\x)});`);
    }
    return out;
  },
});

const hemisphere = solidTemplate({
  id: 'hemisphere',
  name: 'Hemisphere',
  description: 'dome + base ellipse (tikz-3dplot)',
  params: [{ key: 'r', label: 'radius', type: 'number', default: 1.5, min: 0.3, max: 6, step: 0.1 }],
  packages: ['tikz-3dplot'],
  sizeCm: (p) => num(p, 'r', 1.5) + 0.4,
  exportLatex(p, ctx) {
    const r = num(p, 'r', 1.5);
    const minor = fmt(Math.abs(Math.cos((ctx.view3d.theta * Math.PI) / 180)) * r);
    return [
      `\\draw[fill=blue!8] (${fmt(-r)},0) arc (180:0:${fmt(r)});`,
      `\\draw (0,0) ellipse (${fmt(r)} and ${minor});`,
    ];
  },
});

const cylinder = solidTemplate({
  id: 'cylinder',
  name: 'Cylinder',
  description: 'shaded smooth solid (pgfplots surf)',
  params: [
    { key: 'r', label: 'radius', type: 'number', default: 1, min: 0.2, max: 5, step: 0.1 },
    { key: 'h', label: 'height', type: 'number', default: 2, min: 0.2, max: 8, step: 0.1 },
  ],
  packages: ['pgfplots'],
  sizeCm: (p) => Math.max(num(p, 'r', 1) * 2, num(p, 'h', 2)),
  exportLatex(p, ctx) {
    const v = pgfView(ctx.view3d);
    const r = fmt(num(p, 'r', 1));
    const h = fmt(num(p, 'h', 2));
    return [
      surfAxisOpen(v),
      `\\addplot3[surf, shader=interp, colormap/blackwhite, opacity=0.85, domain=0:360, y domain=0:${h}, samples=40, samples y=8, z buffer=sort] ({${r}*cos(x)}, {${r}*sin(x)}, y);`,
      `\\end{axis}`,
    ];
  },
});

const cone = solidTemplate({
  id: 'cone',
  name: 'Cone',
  description: 'shaded smooth solid (pgfplots surf)',
  params: [
    { key: 'r', label: 'base radius', type: 'number', default: 1, min: 0.2, max: 5, step: 0.1 },
    { key: 'h', label: 'height', type: 'number', default: 2, min: 0.2, max: 8, step: 0.1 },
  ],
  packages: ['pgfplots'],
  sizeCm: (p) => Math.max(num(p, 'r', 1) * 2, num(p, 'h', 2)),
  exportLatex(p, ctx) {
    const v = pgfView(ctx.view3d);
    const r = fmt(num(p, 'r', 1));
    const h = fmt(num(p, 'h', 2));
    return [
      surfAxisOpen(v),
      `\\addplot3[surf, shader=interp, colormap/blackwhite, opacity=0.85, domain=0:360, y domain=0:${h}, samples=40, samples y=8, z buffer=sort] ({${r}*(1-y/${h})*cos(x)}, {${r}*(1-y/${h})*sin(x)}, y);`,
      `\\end{axis}`,
    ];
  },
});

const box3d = solidTemplate({
  id: 'box',
  name: 'Cube / box',
  description: 'a×b×c wireframe with hidden edges dashed (tikz-3dplot)',
  params: [
    { key: 'a', label: 'a (x)', type: 'number', default: 2, min: 0.2, max: 6, step: 0.1 },
    { key: 'b', label: 'b (y)', type: 'number', default: 1.5, min: 0.2, max: 6, step: 0.1 },
    { key: 'c', label: 'c (z)', type: 'number', default: 1, min: 0.2, max: 6, step: 0.1 },
  ],
  packages: ['tikz-3dplot'],
  sizeCm: (p) => Math.max(num(p, 'a', 2), num(p, 'b', 1.5), num(p, 'c', 1)) + 0.5,
  exportLatex(p) {
    const a = fmt(num(p, 'a', 2));
    const b = fmt(num(p, 'b', 1.5));
    const c = fmt(num(p, 'c', 1));
    return [
      `\\draw[tdplot_main_coords, dashed] (0,0,0) -- (${a},0,0) (0,0,0) -- (0,${b},0) (0,0,0) -- (0,0,${c});`,
      `\\draw[tdplot_main_coords] (${a},0,0) -- (${a},${b},0) -- (0,${b},0) -- (0,${b},${c}) -- (0,0,${c}) -- (${a},0,${c}) -- cycle;`,
      `\\draw[tdplot_main_coords] (${a},${b},0) -- (${a},${b},${c}) -- (0,${b},${c}) (${a},${b},${c}) -- (${a},0,${c});`,
    ];
  },
});

const planePatch = solidTemplate({
  id: 'plane-patch',
  name: 'Plane patch',
  description: 'a filled a×b rectangle in the z=0 plane (tikz-3dplot)',
  params: [
    { key: 'a', label: 'a (x)', type: 'number', default: 2.5, min: 0.2, max: 8, step: 0.1 },
    { key: 'b', label: 'b (y)', type: 'number', default: 2, min: 0.2, max: 8, step: 0.1 },
  ],
  packages: ['tikz-3dplot'],
  sizeCm: (p) => Math.max(num(p, 'a', 2.5), num(p, 'b', 2)),
  exportLatex(p) {
    const a = fmt(num(p, 'a', 2.5));
    const b = fmt(num(p, 'b', 2));
    return [`\\draw[tdplot_main_coords, fill=green!12, opacity=0.9] (0,0,0) -- (${a},0,0) -- (${a},${b},0) -- (0,${b},0) -- cycle;`];
  },
});

const torus = solidTemplate({
  id: 'torus',
  name: 'Torus',
  description: 'shaded (pgfplots surf, optional)',
  params: [
    { key: 'R', label: 'ring radius', type: 'number', default: 1.5, min: 0.4, max: 5, step: 0.1 },
    { key: 'r', label: 'tube radius', type: 'number', default: 0.4, min: 0.1, max: 2, step: 0.05 },
  ],
  packages: ['pgfplots'],
  sizeCm: (p) => num(p, 'R', 1.5) + num(p, 'r', 0.4) + 0.3,
  exportLatex(p, ctx) {
    const v = pgfView(ctx.view3d);
    const R = fmt(num(p, 'R', 1.5));
    const r = fmt(num(p, 'r', 0.4));
    return [
      surfAxisOpen(v),
      `\\addplot3[surf, shader=interp, colormap/blackwhite, opacity=0.85, domain=0:360, y domain=0:360, samples=36, samples y=18, z buffer=sort] ({(${R}+${r}*cos(y))*cos(x)}, {(${R}+${r}*cos(y))*sin(x)}, {${r}*sin(y)});`,
      `\\end{axis}`,
    ];
  },
});

// ════════════════════════════ CURVES & WAVY LINES ════════════════════════════

function curveCanvas(fn: (x: number) => number, x0: number, x1: number, ctx: TemplateCtx, color = '#4e68f5'): React.ReactNode {
  const N = 80;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / N;
    return `${x * ctx.scale},${-fn(x) * ctx.scale}`;
  }).join(' ');
  return (
    <g>
      <line x1={x0 * ctx.scale} y1={0} x2={x1 * ctx.scale} y2={0} stroke="#8886" strokeWidth={1} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} />
    </g>
  );
}

function pgfCurve(opts: { id: string; name: string; expr: string; canvasFn: (a: number) => (x: number) => number; domain: [number, number]; extraParams?: DiagramTemplate['params'] }): DiagramTemplate {
  return {
    id: opts.id,
    category: 'Curves & Wavy Lines',
    name: opts.name,
    description: `true plot via pgfplots (\\addplot{${opts.expr}})`,
    params: [
      { key: 'amp', label: 'amplitude / scale', type: 'number', default: 1, min: 0.1, max: 6, step: 0.1 },
      { key: 'x0', label: 'x from', type: 'number', default: opts.domain[0], min: -50, max: 50, step: 0.5 },
      { key: 'x1', label: 'x to', type: 'number', default: opts.domain[1], min: -50, max: 50, step: 0.5 },
      { key: 'axes', label: 'show axes', type: 'boolean', default: true },
      ...(opts.extraParams ?? []),
    ],
    requiredPackages: ['pgfplots'],
    size: (p) => ({ w: (num(p, 'x1') - num(p, 'x0')) * S + 30, h: Math.max(2, num(p, 'amp') * 2 + 1) * S }),
    renderCanvas: (p, ctx) => curveCanvas(opts.canvasFn(num(p, 'amp', 1)), num(p, 'x0'), num(p, 'x1'), ctx),
    exportLatex(p) {
      const a = fmt(num(p, 'amp', 1));
      const axisOpts = bool(p, 'axes', true)
        ? `axis lines=middle, xlabel={$x$}, ylabel={$y$}`
        : `hide axis`;
      return [
        `\\begin{axis}[${axisOpts}, anchor=origin, at={(0,0)}, domain=${fmt(num(p, 'x0'))}:${fmt(num(p, 'x1'))}, samples=120, width=${fmt((num(p, 'x1') - num(p, 'x0')) * 1.1 + 2)}cm, height=${fmt(Math.max(3, num(p, 'amp', 1) * 2 + 2))}cm]`,
        `\\addplot[blue!70!black, thick, smooth] {${a}*(${opts.expr})};`,
        `\\end{axis}`,
      ];
    },
  };
}

const sineWave = pgfCurve({ id: 'sine-wave', name: 'Sine / cosine wave', expr: 'sin(deg(x))', canvasFn: (a) => (x) => a * Math.sin(x), domain: [0, 6.5] });
const parabola = pgfCurve({ id: 'parabola', name: 'Parabola', expr: 'x^2', canvasFn: (a) => (x) => a * x * x, domain: [-2, 2] });
const exponential = pgfCurve({ id: 'exponential', name: 'Exponential', expr: 'exp(x)', canvasFn: (a) => (x) => a * Math.exp(x), domain: [-2, 1.6] });
const logarithm = pgfCurve({ id: 'logarithm', name: 'Logarithm', expr: 'ln(x)', canvasFn: (a) => (x) => (x > 0.02 ? a * Math.log(x) : -4), domain: [0.1, 5] });

const wavyLine: DiagramTemplate = {
  id: 'wavy-line',
  category: 'Curves & Wavy Lines',
  name: 'Wavy line (snake)',
  description: 'decorative — decorations.pathmorphing',
  params: [
    { key: 'len', label: 'length', type: 'number', default: 3, min: 0.5, max: 12, step: 0.5 },
    { key: 'amplitude', label: 'amplitude (pt)', type: 'number', default: 3, min: 0.5, max: 12, step: 0.5 },
    { key: 'segment', label: 'segment (pt)', type: 'number', default: 8, min: 2, max: 30, step: 1 },
  ],
  requiredPackages: ['lib:decorations.pathmorphing'],
  size: (p) => ({ w: num(p, 'len') * S + 20, h: S }),
  renderCanvas(p, ctx) {
    const len = num(p, 'len') * ctx.scale;
    const amp = num(p, 'amplitude') * 1.4;
    const seg = num(p, 'segment') * 1.6;
    let d = `M${0},0`;
    for (let x = 0; x < len; x += seg) d += ` Q${x + seg / 4},${-amp} ${x + seg / 2},0 Q${x + (3 * seg) / 4},${amp} ${Math.min(x + seg, len)},0`;
    return <path d={d} fill="none" stroke={INK} strokeWidth={1.4} />;
  },
  exportLatex(p) {
    return [
      `\\draw[decorate, decoration={snake, amplitude=${fmt(num(p, 'amplitude'))}pt, segment length=${fmt(num(p, 'segment'))}pt}] (0,0) -- (${fmt(num(p, 'len'))},0);`,
    ];
  },
};

const coil: DiagramTemplate = {
  id: 'coil',
  category: 'Curves & Wavy Lines',
  name: 'Coil (spring)',
  description: 'decorations.pathmorphing coil',
  params: [
    { key: 'len', label: 'length', type: 'number', default: 3, min: 0.5, max: 12, step: 0.5 },
    { key: 'amplitude', label: 'amplitude (pt)', type: 'number', default: 5, min: 1, max: 14, step: 0.5 },
    { key: 'segment', label: 'segment (pt)', type: 'number', default: 5, min: 2, max: 20, step: 1 },
  ],
  requiredPackages: ['lib:decorations.pathmorphing'],
  size: (p) => ({ w: num(p, 'len') * S + 20, h: S }),
  renderCanvas(p, ctx) {
    const len = num(p, 'len') * ctx.scale;
    const amp = num(p, 'amplitude') * 1.6;
    const seg = num(p, 'segment') * 1.4;
    const out: React.ReactNode[] = [];
    for (let x = 0; x < len - seg; x += seg) {
      out.push(<ellipse key={x} cx={x + seg / 2} cy={0} rx={seg * 0.7} ry={amp} fill="none" stroke={INK} strokeWidth={1.2} />);
    }
    return <g>{out}</g>;
  },
  exportLatex(p) {
    return [
      `\\draw[decorate, decoration={coil, aspect=0.6, amplitude=${fmt(num(p, 'amplitude'))}pt, segment length=${fmt(num(p, 'segment'))}pt}] (0,0) -- (${fmt(num(p, 'len'))},0);`,
    ];
  },
};

const spiral: DiagramTemplate = {
  id: 'spiral',
  category: 'Curves & Wavy Lines',
  name: 'Spiral',
  description: 'Archimedean, drawn parametrically',
  params: [
    { key: 'turns', label: 'turns', type: 'number', default: 3, min: 1, max: 8, step: 0.5 },
    { key: 'rmax', label: 'outer radius', type: 'number', default: 1.5, min: 0.3, max: 6, step: 0.1 },
  ],
  requiredPackages: [],
  size: (p) => ({ w: num(p, 'rmax') * 2 * S + 16, h: num(p, 'rmax') * 2 * S + 16 }),
  renderCanvas(p, ctx) {
    const turns = num(p, 'turns');
    const rmax = num(p, 'rmax') * ctx.scale;
    const N = Math.ceil(turns * 36);
    const pts = Array.from({ length: N + 1 }, (_, i) => {
      const t = (i / N) * turns * 2 * Math.PI;
      const r = (rmax * t) / (turns * 2 * Math.PI);
      return `${r * Math.cos(t)},${-r * Math.sin(t)}`;
    }).join(' ');
    return <polyline points={pts} fill="none" stroke={INK} strokeWidth={1.4} />;
  },
  exportLatex(p) {
    const deg = fmt(num(p, 'turns') * 360);
    const k = fmt(num(p, 'rmax') / (num(p, 'turns') * 360));
    return [`\\draw plot[domain=0:${deg}, samples=${Math.ceil(num(p, 'turns') * 60)}, smooth, variable=\\t] ({${k}*\\t*cos(\\t)}, {${k}*\\t*sin(\\t)});`];
  },
};

// ════════════════════════════ SETS & LOGIC ════════════════════════════

const venn2: DiagramTemplate = {
  id: 'venn-2',
  category: 'Sets & Logic',
  name: 'Venn (2 sets)',
  description: 'two filled circles + labels + optional universe box',
  params: [
    { key: 'labelA', label: 'A label', type: 'text', default: '$A$' },
    { key: 'labelB', label: 'B label', type: 'text', default: '$B$' },
    { key: 'universe', label: 'universe box', type: 'boolean', default: true },
    { key: 'shade', label: 'shade intersection', type: 'boolean', default: true },
  ],
  requiredPackages: [],
  size: () => ({ w: 5.4 * S, h: 4 * S }),
  renderCanvas(p) {
    const r = 1.1 * S;
    const d = 0.7 * S;
    return (
      <g>
        {bool(p, 'universe', true) && <rect x={-2.6 * S} y={-1.9 * S} width={5.2 * S} height={3.8 * S} fill="none" stroke={INK} strokeWidth={1.2} />}
        <circle cx={-d} cy={0} r={r} fill="rgba(78,104,245,0.14)" stroke={INK} strokeWidth={1.3} />
        <circle cx={d} cy={0} r={r} fill="rgba(232,68,61,0.12)" stroke={INK} strokeWidth={1.3} />
        {TXT(-d - 8, -r - 8, str(p, 'labelA').replace(/\$/g, ''), 'la')}
        {TXT(d, -r - 8, str(p, 'labelB').replace(/\$/g, ''), 'lb')}
      </g>
    );
  },
  exportLatex(p) {
    const out: string[] = [];
    if (bool(p, 'universe', true)) out.push(`\\draw (-2.6,-1.9) rectangle (2.6,1.9);`);
    if (bool(p, 'shade', true)) {
      out.push(`\\begin{scope}`);
      out.push(`\\clip (-0.7,0) circle (1.1);`);
      out.push(`\\fill[purple!25] (0.7,0) circle (1.1);`);
      out.push(`\\end{scope}`);
    }
    out.push(`\\draw[fill=blue!12, fill opacity=0.5] (-0.7,0) circle (1.1);`);
    out.push(`\\draw[fill=red!12, fill opacity=0.5] (0.7,0) circle (1.1);`);
    out.push(`\\node at (-1.5,1.35) {${str(p, 'labelA')}};`);
    out.push(`\\node at (1.5,1.35) {${str(p, 'labelB')}};`);
    return out;
  },
};

const venn3: DiagramTemplate = {
  id: 'venn-3',
  category: 'Sets & Logic',
  name: 'Venn (3 sets)',
  description: 'three circles + labels + universe',
  params: [
    { key: 'labelA', label: 'A label', type: 'text', default: '$A$' },
    { key: 'labelB', label: 'B label', type: 'text', default: '$B$' },
    { key: 'labelC', label: 'C label', type: 'text', default: '$C$' },
    { key: 'universe', label: 'universe box', type: 'boolean', default: true },
  ],
  requiredPackages: [],
  size: () => ({ w: 5.6 * S, h: 5 * S }),
  renderCanvas(p) {
    const r = 1.05 * S;
    const centres = [
      { x: -0.6 * S, y: -0.45 * S, f: 'rgba(78,104,245,0.13)' },
      { x: 0.6 * S, y: -0.45 * S, f: 'rgba(232,68,61,0.11)' },
      { x: 0, y: 0.55 * S, f: 'rgba(69,184,158,0.13)' },
    ];
    return (
      <g>
        {bool(p, 'universe', true) && <rect x={-2.7 * S} y={-2.2 * S} width={5.4 * S} height={4.6 * S} fill="none" stroke={INK} strokeWidth={1.2} />}
        {centres.map((c, i) => <circle key={i} cx={c.x} cy={c.y} r={r} fill={c.f} stroke={INK} strokeWidth={1.3} />)}
        {TXT(-1.8 * S, -1.6 * S, str(p, 'labelA').replace(/\$/g, ''), 'la')}
        {TXT(1.55 * S, -1.6 * S, str(p, 'labelB').replace(/\$/g, ''), 'lb')}
        {TXT(0, 2 * S, str(p, 'labelC').replace(/\$/g, ''), 'lc')}
      </g>
    );
  },
  exportLatex(p) {
    const out: string[] = [];
    if (bool(p, 'universe', true)) out.push(`\\draw (-2.7,-2.3) rectangle (2.7,2.3);`);
    out.push(`\\draw[fill=blue!12, fill opacity=0.5] (-0.6,0.45) circle (1.05);`);
    out.push(`\\draw[fill=red!12, fill opacity=0.5] (0.6,0.45) circle (1.05);`);
    out.push(`\\draw[fill=green!12, fill opacity=0.5] (0,-0.55) circle (1.05);`);
    out.push(`\\node at (-1.75,1.6) {${str(p, 'labelA')}};`);
    out.push(`\\node at (1.75,1.6) {${str(p, 'labelB')}};`);
    out.push(`\\node at (0,-1.95) {${str(p, 'labelC')}};`);
    return out;
  },
};

const braceT: DiagramTemplate = {
  id: 'brace',
  category: 'Sets & Logic',
  name: 'Brace with label',
  description: 'decorations.pathreplacing; above or below',
  params: [
    { key: 'len', label: 'length', type: 'number', default: 3, min: 0.5, max: 12, step: 0.5 },
    { key: 'label', label: 'label', type: 'text', default: '$n$ terms' },
    { key: 'side', label: 'side', type: 'select', default: 'above', options: ['above', 'below'] },
  ],
  requiredPackages: ['lib:decorations.pathreplacing'],
  size: (p) => ({ w: num(p, 'len') * S + 20, h: 1.4 * S }),
  renderCanvas(p, ctx) {
    const len = num(p, 'len') * ctx.scale;
    const below = str(p, 'side') === 'below';
    const sign = below ? 1 : -1;
    const y = sign * 8;
    const d = `M${-len / 2},0 Q${-len / 2},${y} ${-len / 2 + 12},${y} L${-14},${y} Q${0},${y} ${0},${y + sign * 7} Q${0},${y} ${14},${y} L${len / 2 - 12},${y} Q${len / 2},${y} ${len / 2},0`;
    return (
      <g>
        <path d={d} fill="none" stroke={INK} strokeWidth={1.4} />
        {TXT(-len / 8, y + sign * 22, str(p, 'label').replace(/\$/g, ''), 'l')}
      </g>
    );
  },
  exportLatex(p) {
    const len = num(p, 'len');
    const below = str(p, 'side') === 'below';
    return [
      `\\draw[decorate, decoration={brace${below ? ', mirror' : ''}, amplitude=6pt}] (${fmt(-len / 2)},0) -- (${fmt(len / 2)},0) node[midway, ${below ? 'below' : 'above'}=7pt] {${str(p, 'label')}};`,
    ];
  },
};

const labelledPoint: DiagramTemplate = {
  id: 'labelled-point',
  category: 'Sets & Logic',
  name: 'Labelled point',
  description: 'a filled point with a positioned label',
  params: [
    { key: 'label', label: 'label', type: 'text', default: '$P$' },
    { key: 'pos', label: 'label position', type: 'select', default: 'above right', options: ['above', 'below', 'left', 'right', 'above right', 'above left', 'below right', 'below left'] },
  ],
  requiredPackages: [],
  size: () => ({ w: S, h: S }),
  renderCanvas(p) {
    return (
      <g>
        <circle cx={0} cy={0} r={3} fill={INK} />
        {TXT(6, -6, str(p, 'label').replace(/\$/g, ''), 'l')}
      </g>
    );
  },
  exportLatex(p) {
    return [`\\fill (0,0) circle (0.05) node[${str(p, 'pos')}] {${str(p, 'label')}};`];
  },
};

const shadedRegion: DiagramTemplate = {
  id: 'region-between-curves',
  category: 'Sets & Logic',
  name: 'Region between curves',
  description: 'shades between f(x)=x² and g(x)=x on [0,1] style (pgfplots fillbetween)',
  params: [
    { key: 'f', label: 'upper f(x)', type: 'text', default: 'x' },
    { key: 'g', label: 'lower g(x)', type: 'text', default: 'x^2' },
    { key: 'x0', label: 'x from', type: 'number', default: 0, min: -20, max: 20, step: 0.5 },
    { key: 'x1', label: 'x to', type: 'number', default: 1, min: -20, max: 20, step: 0.5 },
  ],
  requiredPackages: ['pgfplots', 'lib:fillbetween'],
  size: () => ({ w: 4 * S, h: 3.2 * S }),
  renderCanvas(p, ctx) {
    // canvas approximation for the default pair; arbitrary f/g preview as two curves
    const f = (x: number) => x;
    const g = (x: number) => x * x;
    const x0 = num(p, 'x0');
    const x1 = num(p, 'x1');
    const N = 40;
    const up = Array.from({ length: N + 1 }, (_, i) => {
      const x = x0 + ((x1 - x0) * i) / N;
      return `${x * ctx.scale * 2},${-f(x) * ctx.scale * 2}`;
    });
    const down = Array.from({ length: N + 1 }, (_, i) => {
      const x = x1 - ((x1 - x0) * i) / N;
      return `${x * ctx.scale * 2},${-g(x) * ctx.scale * 2}`;
    });
    return (
      <g>
        <polygon points={[...up, ...down].join(' ')} fill="rgba(78,104,245,0.18)" stroke="none" />
        <polyline points={up.join(' ')} fill="none" stroke="#4e68f5" strokeWidth={1.5} />
        <polyline points={down.join(' ')} fill="none" stroke="#e8443d" strokeWidth={1.5} />
      </g>
    );
  },
  exportLatex(p) {
    return [
      `\\begin{axis}[axis lines=middle, anchor=origin, at={(0,0)}, domain=${fmt(num(p, 'x0'))}:${fmt(num(p, 'x1'))}, samples=80, width=6cm, height=5cm]`,
      `\\addplot[blue!70!black, thick, name path=F] {${str(p, 'f')}};`,
      `\\addplot[red!75!black, thick, name path=G] {${str(p, 'g')}};`,
      `\\addplot[blue!20] fill between[of=F and G];`,
      `\\end{axis}`,
    ];
  },
};

// ════════════════════════════ REGISTRY ════════════════════════════

export const TEMPLATES: DiagramTemplate[] = [
  axes2d, numberLine, polarGrid,
  axes3d,
  vector2d, vector3d, vectorAddition, basisVectors,
  circleT, ellipseT, arcSector, angleMark, regularPolygon, segmentRay, tangentLine,
  sphere, hemisphere, cylinder, cone, box3d, planePatch, torus,
  sineWave, parabola, exponential, logarithm, wavyLine, coil, spiral,
  venn2, venn3, braceT, labelledPoint, shadedRegion,
];

export const TEMPLATE_CATEGORIES = [...new Set(TEMPLATES.map((t) => t.category))];

export function getTemplate(id: string): DiagramTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templateDefaults(t: DiagramTemplate): Params {
  return defaults(t);
}

/** Requirements for a set of template ids: {packages, libraries}. */
export function collectRequirements(templateIds: string[]): { packages: string[]; libraries: string[] } {
  const packages = new Set<string>();
  const libraries = new Set<string>();
  for (const id of templateIds) {
    for (const r of getTemplate(id)?.requiredPackages ?? []) {
      if (r.startsWith('lib:')) libraries.add(r.slice(4));
      else packages.add(r);
    }
  }
  return { packages: [...packages], libraries: [...libraries] };
}

// bbox sizing for template elements (registered once; avoids a model→catalog cycle)
setTemplateSizeHook((el: TemplateElement) => {
  const t = getTemplate(el.templateId);
  if (!t) return { w: 160, h: 120 };
  return t.size(el.params, { view3d: { theta: 70, phi: 110 }, scale: S });
});
