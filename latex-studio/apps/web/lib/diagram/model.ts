/**
 * DIAGRAM SCENE MODEL — the canonical representation of a visual diagram,
 * stored as `<name>.diagram.json` in the project. TikZ (and the PDF/SVG
 * preview) are GENERATED exports; the scene is the source of truth and exports
 * are never parsed back (the raw-tikz element is explicitly opaque).
 *
 * Canvas coordinates are pixels, y-down. The TikZ exporter maps them to cm
 * (PX_PER_CM) with y flipped, so what you draw is what TikZ typesets.
 */

export const PX_PER_CM = 40;
export const DEFAULT_GRID = 10;

export type DashStyle = 'solid' | 'dashed' | 'dotted';
export type ArrowHead = 'none' | 'arrow' | 'stealth' | 'latex';
export type NodeShape = 'rect' | 'circle' | 'ellipse';
export type LabelPos = 'above' | 'below' | 'left' | 'right' | 'midway';

export interface DiagramStyle {
  stroke: string; // hex or '' for none
  strokeWidth: number; // px (≈ pt in export)
  dash: DashStyle;
  fill: string; // hex or '' for none
  opacity: number; // 0..1
  fontSize?: number; // pt, labels
}

export const DEFAULT_STYLE: DiagramStyle = { stroke: '#1c2335', strokeWidth: 1.4, dash: 'solid', fill: '', opacity: 1 };

interface ElementBase {
  id: string;
  style: DiagramStyle;
  /** Degrees, counter-clockwise on canvas (exported as TikZ rotate). */
  rotation?: number;
}

export interface RectElement extends ElementBase {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EllipseElement extends ElementBase {
  kind: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface PolygonElement extends ElementBase {
  kind: 'polygon';
  points: Array<{ x: number; y: number }>;
}

export interface LineElement extends ElementBase {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  arrowHead: ArrowHead; // 'none' = plain line, else an arrow
}

export interface PathElement extends ElementBase {
  kind: 'path';
  points: Array<{ x: number; y: number }>;
  smooth: boolean; // false = polyline, true = smooth curve through points
  closed: boolean;
}

export interface NodeElement extends ElementBase {
  kind: 'node';
  x: number; // centre
  y: number;
  shape: NodeShape;
  w: number;
  h: number;
  label: string; // LaTeX (maths in $…$)
}

export type EdgeEndpoint = { node: string } | { x: number; y: number };

export interface EdgeElement extends ElementBase {
  kind: 'edge';
  from: EdgeEndpoint;
  to: EdgeEndpoint;
  arrowHead: ArrowHead;
  /** TikZ bend angle; 0 = straight, >0 bend left, <0 bend right. */
  bend: number;
  label: string;
  labelPos: LabelPos;
}

export interface TextElement extends ElementBase {
  kind: 'text';
  x: number;
  y: number;
  label: string; // LaTeX
}

export interface RawTikzElement extends ElementBase {
  kind: 'raw-tikz';
  /** Canvas placeholder box (the snippet itself is NOT rendered on canvas). */
  x: number;
  y: number;
  w: number;
  h: number;
  code: string; // carried to the export verbatim; never parsed back
}

export interface PlotElement extends ElementBase {
  kind: 'plot';
  x: number;
  y: number;
  w: number;
  h: number;
  source: { type: 'function'; expr: string } | { type: 'data'; data: string };
  settings: { xrange: string; yrange: string; xlabel: string; ylabel: string; plotStyle: 'lines' | 'points' | 'linespoints' };
  /** Project-relative basename of generated output (diagrams/plots/<base>.*). */
  generatedBase?: string;
  /** Data-URL PNG preview of the generated plot (canvas display only). */
  previewPng?: string;
}

export interface TemplateElement extends ElementBase {
  kind: 'template';
  /** Registry id (lib/diagram/templates). */
  templateId: string;
  /** Placement of the template's local origin (canvas px). */
  x: number;
  y: number;
  /** Parameter values (validated against the template's param spec). */
  params: Record<string, number | string | boolean>;
}

export type DiagramElement =
  | RectElement
  | EllipseElement
  | PolygonElement
  | LineElement
  | PathElement
  | NodeElement
  | EdgeElement
  | TextElement
  | RawTikzElement
  | PlotElement
  | TemplateElement;

export interface DiagramScene {
  version: 1;
  grid: number;
  snap: boolean;
  /** Shared 3D frame (tikz-3dplot main coords): θ = tilt from the z-axis,
   *  φ = rotation about it. EVERY 3D template renders + exports against this,
   *  so solids and axes line up on one figure. */
  view3d: { theta: number; phi: number };
  /** Named lengths (cm) usable from raw-tikz snippets; exported as \def\name{value}. */
  params: Record<string, number>;
  /** Paint order — index 0 is the back. */
  elements: DiagramElement[];
}

export function emptyScene(): DiagramScene {
  return { version: 1, grid: DEFAULT_GRID, snap: true, view3d: { theta: 70, phi: 110 }, params: {}, elements: [] };
}

export function parseScene(content: string): DiagramScene {
  try {
    const raw = JSON.parse(content) as Partial<DiagramScene>;
    if (!raw || !Array.isArray(raw.elements)) return emptyScene();
    return { ...emptyScene(), ...raw, elements: raw.elements as DiagramElement[] };
  } catch {
    return emptyScene();
  }
}

export function serializeScene(scene: DiagramScene): string {
  return JSON.stringify(scene, null, 2);
}

export function isDiagramPath(path: string): boolean {
  return path.toLowerCase().endsWith('.diagram.json');
}

/** Set by the template registry so bbox() can size template elements. */
let templateSizeHook: ((el: TemplateElement) => { w: number; h: number }) | null = null;
export function setTemplateSizeHook(fn: (el: TemplateElement) => { w: number; h: number }): void {
  templateSizeHook = fn;
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `e${Date.now().toString(36)}${counter.toString(36)}`;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

export function nodeCentre(n: NodeElement): { x: number; y: number } {
  return { x: n.x, y: n.y };
}

/** Point on a node's border along the direction towards `toward` — the canvas
 *  mirror of TikZ's automatic edge anchoring, so edges reflow as nodes move. */
export function borderPoint(n: NodeElement, toward: { x: number; y: number }): { x: number; y: number } {
  const dx = toward.x - n.x;
  const dy = toward.y - n.y;
  if (dx === 0 && dy === 0) return { x: n.x, y: n.y };
  if (n.shape === 'circle' || n.shape === 'ellipse') {
    const rx = n.w / 2;
    const ry = n.h / 2;
    const t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    return { x: n.x + dx * t, y: n.y + dy * t };
  }
  // rectangle: intersect the centre ray with the box
  const hw = n.w / 2;
  const hh = n.h / 2;
  const tx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: n.x + dx * t, y: n.y + dy * t };
}

/** Resolve an edge endpoint to canvas coordinates. */
export function endpointXY(scene: DiagramScene, ep: EdgeEndpoint, other?: { x: number; y: number }): { x: number; y: number } {
  if ('node' in ep) {
    const n = scene.elements.find((e): e is NodeElement => e.kind === 'node' && e.id === ep.node);
    if (!n) return { x: 0, y: 0 };
    return other ? borderPoint(n, other) : nodeCentre(n);
  }
  return { x: ep.x, y: ep.y };
}

/** Both endpoints of an edge, anchored to node borders. */
export function edgeEnds(scene: DiagramScene, e: EdgeElement): { a: { x: number; y: number }; b: { x: number; y: number } } {
  const rawA = endpointXY(scene, e.from);
  const rawB = endpointXY(scene, e.to);
  return { a: endpointXY(scene, e.from, rawB), b: endpointXY(scene, e.to, rawA) };
}

export function bbox(el: DiagramElement, scene?: DiagramScene): { x: number; y: number; w: number; h: number } {
  switch (el.kind) {
    case 'rect':
    case 'raw-tikz':
    case 'plot':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'template': {
      const size = templateSizeHook?.(el) ?? { w: 160, h: 120 };
      return { x: el.x - size.w / 2, y: el.y - size.h / 2, w: size.w, h: size.h };
    }
    case 'ellipse':
      return { x: el.cx - el.rx, y: el.cy - el.ry, w: el.rx * 2, h: el.ry * 2 };
    case 'node':
      return { x: el.x - el.w / 2, y: el.y - el.h / 2, w: el.w, h: el.h };
    case 'line':
      return { x: Math.min(el.x1, el.x2), y: Math.min(el.y1, el.y2), w: Math.abs(el.x2 - el.x1), h: Math.abs(el.y2 - el.y1) };
    case 'polygon':
    case 'path': {
      const xs = el.points.map((p) => p.x);
      const ys = el.points.map((p) => p.y);
      const x = Math.min(...xs, Infinity);
      const y = Math.min(...ys, Infinity);
      return { x, y, w: Math.max(...xs, -Infinity) - x, h: Math.max(...ys, -Infinity) - y };
    }
    case 'text':
      return { x: el.x, y: el.y - 8, w: 80, h: 16 };
    case 'edge': {
      if (!scene) return { x: 0, y: 0, w: 0, h: 0 };
      const { a, b } = edgeEnds(scene, el);
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    }
  }
}

/** Move an element by (dx, dy) — returns a NEW element. */
export function translated<T extends DiagramElement>(el: T, dx: number, dy: number): T {
  switch (el.kind) {
    case 'rect':
    case 'raw-tikz':
    case 'plot':
    case 'node':
    case 'text':
    case 'template':
      return { ...el, x: el.x + dx, y: el.y + dy };
    case 'ellipse':
      return { ...el, cx: el.cx + dx, cy: el.cy + dy };
    case 'line':
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    case 'polygon':
    case 'path':
      return { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'edge': {
      const moveEp = (ep: EdgeEndpoint): EdgeEndpoint => ('node' in ep ? ep : { x: ep.x + dx, y: ep.y + dy });
      return { ...el, from: moveEp(el.from), to: moveEp(el.to) };
    }
  }
}
