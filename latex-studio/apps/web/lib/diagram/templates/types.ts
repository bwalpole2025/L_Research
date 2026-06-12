import type { ReactNode } from 'react';

/**
 * TEMPLATE OBJECT SYSTEM for the maths diagram editor — a DATA-DRIVEN
 * catalogue of parameterised, click-to-insert objects.
 *
 * HOW TO ADD A TEMPLATE (the whole point of the registry):
 *   1. Write one `DiagramTemplate` object in catalog.tsx under its category:
 *      declare typed `params` (defaults + ranges), a `renderCanvas` SVG
 *      approximation, an `exportLatex` that emits the REAL code (plain TikZ,
 *      pgfplots or tikz-3dplot), `requiredPackages`, and a `size` for
 *      hit-testing.
 *   2. Append it to the TEMPLATES array. Nothing else: the palette, inspector,
 *      exporter, preview and preamble-offer all read the registry.
 *
 * 3D: the canvas preview projects through the SAME tikz-3dplot main-coords
 * matrix the export uses (scene.view3d = {theta, phi}), so placement is
 * faithful — but the canvas is an APPROXIMATION; the compiled export is the
 * fidelity target.
 */

export type ParamValue = number | string | boolean;
export type Params = Record<string, ParamValue>;

export interface TemplateParam {
  key: string;
  label: string;
  type: 'number' | 'text' | 'boolean' | 'select';
  default: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface View3D {
  /** tikz-3dplot main coords: θ = tilt from z-axis, φ = rotation about it. */
  theta: number;
  phi: number;
}

export interface TemplateCtx {
  view3d: View3D;
  /** Canvas px per TikZ cm (40). */
  scale: number;
}

/** Required preamble entries. Plain names are packages (`pgfplots`,
 *  `tikz-3dplot`); `lib:<name>` entries are \usetikzlibrary names. */
export type Requirement = string;

/** Libraries that must load via \usepgfplotslibrary, NOT \usetikzlibrary —
 *  the tikz form silently half-loads in current pgfplots builds. The api
 *  routes (preview.ts, diagram.ts) keep a matching set. */
export const PGFPLOTS_TIKZ_LIBS = new Set(['fillbetween']);

export interface DiagramTemplate {
  id: string;
  category: string;
  name: string;
  description: string;
  params: TemplateParam[];
  requiredPackages: Requirement[];
  /** SVG approximation, drawn in canvas px around the local origin (0,0). */
  renderCanvas(p: Params, ctx: TemplateCtx): ReactNode;
  /** Lines emitted inside the tikzpicture (the editor wraps them in a
   *  shift-scope at the element's position). Coordinates in cm. */
  exportLatex(p: Params, ctx: TemplateCtx): string[];
  /** Approximate canvas footprint (px) for selection/hit-testing. */
  size(p: Params, ctx: TemplateCtx): { w: number; h: number };
}

export function defaults(t: DiagramTemplate): Params {
  return Object.fromEntries(t.params.map((p) => [p.key, p.default]));
}

export const num = (p: Params, k: string, fb = 0): number => (typeof p[k] === 'number' ? (p[k] as number) : fb);
export const str = (p: Params, k: string, fb = ''): string => (typeof p[k] === 'string' ? (p[k] as string) : fb);
export const bool = (p: Params, k: string, fb = false): boolean => (typeof p[k] === 'boolean' ? (p[k] as boolean) : fb);

export const fmt = (n: number): string => {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
};

/** tikz-3dplot main-coords projection (matches \tdplotsetmaincoords{θ}{φ}):
 *  unit vectors  X → (cosφ, −cosθ·sinφ)   Y → (sinφ, cosθ·cosφ)   Z → (0, sinθ)
 *  with screen-y up. Returns CANVAS px (y down) at `scale` px/cm. */
export function project3d(x: number, y: number, z: number, view: View3D, scale: number): { x: number; y: number } {
  const t = (view.theta * Math.PI) / 180;
  const f = (view.phi * Math.PI) / 180;
  const sx = x * Math.cos(f) + y * Math.sin(f);
  const syUp = -x * Math.cos(t) * Math.sin(f) + y * Math.cos(t) * Math.cos(f) + z * Math.sin(t);
  return { x: sx * scale, y: -syUp * scale };
}

/** pgfplots `view={az}{el}` that approximates the tikz-3dplot frame, so surf
 *  solids sit consistently with tdplot axes/wireframes. */
export function pgfView(view: View3D): { az: number; el: number } {
  return { az: view.phi - 90, el: 90 - view.theta };
}
