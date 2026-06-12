'use client';

/**
 * TIKZ DIAGRAM EDITOR — Illustrator-style canvas over the DiagramScene model
 * (the source of truth, stored as <name>.diagram.json in the file tree). TikZ
 * is a GENERATED export; the live preview compiles that export through the
 * real TeX engine. Complements the freeform Excalidraw editor (/diagram):
 * this one is for TikZ-semantic diagrams (flowcharts, commutative diagrams,
 * physics setups) that should typeset natively with the document.
 *
 * Stage 1: tools (select / shapes / pen / node / edge / text), move/resize,
 * multi-select + marquee, grid + alignment snapping, zoom/pan, undo/redo,
 * copy/paste, layers + z-order, styling panel, KaTeX labels, node-anchored
 * edges that reflow. Stage 2: TikZ code panel, precision inspector, raw-tikz
 * (opaque), params, per-diagram export target (TikZ source vs frozen PDF).
 * Stage 3: GNUplot plot elements (sandboxed run, LaTeX-native output).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import {
  ArrowRight,
  Circle,
  Code2,
  Hexagon,
  MousePointer2,
  MoveDown,
  MoveUp,
  PenTool,
  Play,
  Redo2,
  Shapes,
  Slash,
  Square,
  StickyNote,
  Trash2,
  TrendingUp,
  Type,
  Undo2,
  Workflow,
} from 'lucide-react';
import { api } from '../../lib/api';
import { useEditorStore } from '../../lib/store';
import {
  DEFAULT_STYLE,
  bbox,
  edgeEnds,
  newId,
  parseScene,
  serializeScene,
  translated,
  type DiagramElement,
  type DiagramScene,
  type DiagramStyle,
  type EdgeElement,
  type NodeElement,
  type PlotElement,
  type TemplateElement,
} from '../../lib/diagram/model';
import { inputSnippet, sceneRequirements, sceneToTikz, tikzExportPath } from '../../lib/diagram/tikz';
import { getTemplate, templateDefaults } from '../../lib/diagram/templates/catalog';
import { PGFPLOTS_TIKZ_LIBS, type DiagramTemplate, type TemplateCtx, type TemplateParam } from '../../lib/diagram/templates/types';
import { TemplatePalette } from './TemplatePalette';

type Tool = 'select' | 'rect' | 'ellipse' | 'polygon' | 'line' | 'arrow' | 'path' | 'node' | 'edge' | 'text' | 'raw-tikz' | 'plot';

const TOOLS: Array<{ key: Tool; icon: typeof Square; label: string }> = [
  { key: 'select', icon: MousePointer2, label: 'Select / move (V)' },
  { key: 'rect', icon: Square, label: 'Rectangle (R)' },
  { key: 'ellipse', icon: Circle, label: 'Ellipse (E)' },
  { key: 'polygon', icon: Hexagon, label: 'Polygon — click points, double-click to close' },
  { key: 'line', icon: Slash, label: 'Line (L)' },
  { key: 'arrow', icon: ArrowRight, label: 'Arrow (A)' },
  { key: 'path', icon: PenTool, label: 'Pen — click points, double-click to finish (P)' },
  { key: 'node', icon: StickyNote, label: 'Node — click to place (N)' },
  { key: 'edge', icon: Workflow, label: 'Edge — drag node → node' },
  { key: 'text', icon: Type, label: 'Text label (T)' },
  { key: 'raw-tikz', icon: Code2, label: 'Raw TikZ snippet (opaque — exported verbatim)' },
  { key: 'plot', icon: TrendingUp, label: 'GNUplot plot' },
];

/** Render a label that may contain $maths$ to HTML (KaTeX for the maths). */
function labelHtml(label: string): string {
  if (!label) return '';
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return label
    .split(/(\$[^$]*\$)/)
    .map((seg) =>
      seg.startsWith('$') && seg.endsWith('$') && seg.length > 1
        ? katex.renderToString(seg.slice(1, -1), { throwOnError: false, displayMode: false })
        : esc(seg),
    )
    .join('');
}

const snapTo = (v: number, grid: number, on: boolean): number => (on ? Math.round(v / grid) * grid : v);

interface DragState {
  kind: 'move' | 'create' | 'resize' | 'marquee' | 'edge' | 'pan';
  startX: number;
  startY: number;
  base: DiagramScene;
  draft?: DiagramElement;
  handle?: number;
  fromNode?: string;
  cur?: { x: number; y: number };
  panBase?: { tx: number; ty: number };
}

export function TikzDiagramEditor({ fileId, path, content, embedded }: { fileId: string; path: string; content: string; embedded?: boolean }) {
  const setContent = useEditorStore((s) => s.setContent);
  const projectId = useEditorStore((s) => s.projectId);
  const projects = useEditorStore((s) => s.projects);
  const files = useEditorStore((s) => s.files);

  const scene = useMemo(() => parseScene(content), [content]);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  // ── History ──
  const undoStack = useRef<string[]>([]);
  const redoStack = useRef<string[]>([]);
  const commit = useCallback(
    (next: DiagramScene) => {
      undoStack.current.push(serializeScene(sceneRef.current));
      if (undoStack.current.length > 100) undoStack.current.shift();
      redoStack.current = [];
      setContent(fileId, serializeScene(next));
    },
    [fileId, setContent],
  );
  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (prev === undefined) return;
    redoStack.current.push(serializeScene(sceneRef.current));
    setContent(fileId, prev);
  }, [fileId, setContent]);
  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (next === undefined) return;
    undoStack.current.push(serializeScene(sceneRef.current));
    setContent(fileId, next);
  }, [fileId, setContent]);

  // ── Editor state ──
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<string[]>([]);
  const [view, setView] = useState({ scale: 1, tx: 40, ty: 40 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<Array<{ x: number; y: number }>>([]);
  const [guides, setGuides] = useState<Array<{ x?: number; y?: number }>>([]);
  const [preview, setPreview] = useState<{ png?: string; error?: string; busy: boolean }>({ busy: false });
  const [notice, setNotice] = useState<string | null>(null);
  const [plotOut, setPlotOut] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(!embedded);
  const [preambleOffer, setPreambleOffer] = useState<{ lines: string[]; rootName: string; accept: () => void; skip: () => void } | null>(null);
  const clipboard = useRef<DiagramElement[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const spaceDown = useRef(false);

  const selected = scene.elements.filter((e) => selection.includes(e.id));
  const single = selected.length === 1 ? selected[0] : undefined;

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = svgRef.current!.getBoundingClientRect();
      return { x: (e.clientX - rect.left - view.tx) / view.scale, y: (e.clientY - rect.top - view.ty) / view.scale };
    },
    [view],
  );

  const hitElement = useCallback((p: { x: number; y: number }): DiagramElement | undefined => {
    const s = sceneRef.current;
    for (let i = s.elements.length - 1; i >= 0; i--) {
      const el = s.elements[i]!;
      const b = bbox(el, s);
      const pad = el.kind === 'line' || el.kind === 'edge' || el.kind === 'path' ? 6 : 0;
      if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) return el;
    }
    return undefined;
  }, []);

  const hitNode = useCallback(
    (p: { x: number; y: number }): NodeElement | undefined => {
      const el = hitElement(p);
      return el?.kind === 'node' ? el : undefined;
    },
    [hitElement],
  );

  // ── Alignment guides while moving ──
  const alignSnap = useCallback(
    (moving: string[], dx: number, dy: number, base: DiagramScene): { dx: number; dy: number; guides: Array<{ x?: number; y?: number }> } => {
      const movingEls = base.elements.filter((e) => moving.includes(e.id));
      if (movingEls.length === 0) return { dx, dy, guides: [] };
      const boxes = movingEls.map((e) => bbox(e, base));
      const b0 = boxes.reduce((a, b) => ({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
        h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
      }));
      const xs = [b0.x + dx, b0.x + b0.w / 2 + dx, b0.x + b0.w + dx];
      const ys = [b0.y + dy, b0.y + b0.h / 2 + dy, b0.y + b0.h + dy];
      const out: Array<{ x?: number; y?: number }> = [];
      let bestDx = dx;
      let bestDy = dy;
      const T = 5 / view.scale;
      for (const other of base.elements) {
        if (moving.includes(other.id)) continue;
        const ob = bbox(other, base);
        for (const ox of [ob.x, ob.x + ob.w / 2, ob.x + ob.w]) for (const cx of xs) if (Math.abs(cx - ox) < T) { bestDx = dx + (ox - cx); out.push({ x: ox }); }
        for (const oy of [ob.y, ob.y + ob.h / 2, ob.y + ob.h]) for (const cy of ys) if (Math.abs(cy - oy) < T) { bestDy = dy + (oy - cy); out.push({ y: oy }); }
      }
      return { dx: bestDx, dy: bestDy, guides: out.slice(0, 4) };
    },
    [view.scale],
  );

  // ── Pointer handlers ──
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || spaceDown.current) {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, base: sceneRef.current, panBase: { tx: view.tx, ty: view.ty } });
      return;
    }
    const p = toWorld(e);
    const g = (v: number) => snapTo(v, scene.grid, scene.snap);

    if (tool === 'select') {
      const hit = hitElement(p);
      if (hit) {
        const ids = e.shiftKey
          ? selection.includes(hit.id)
            ? selection.filter((i) => i !== hit.id)
            : [...selection, hit.id]
          : selection.includes(hit.id)
            ? selection
            : [hit.id];
        setSelection(ids);
        setDrag({ kind: 'move', startX: p.x, startY: p.y, base: sceneRef.current });
      } else {
        setSelection(e.shiftKey ? selection : []);
        setDrag({ kind: 'marquee', startX: p.x, startY: p.y, base: sceneRef.current, cur: p });
      }
      return;
    }
    if (tool === 'node') {
      const el: NodeElement = { id: newId(), kind: 'node', x: g(p.x), y: g(p.y), w: 80, h: 40, shape: 'rect', label: '', style: { ...DEFAULT_STYLE } };
      commit({ ...scene, elements: [...scene.elements, el] });
      setSelection([el.id]);
      setTool('select');
      return;
    }
    if (tool === 'text') {
      const el: DiagramElement = { id: newId(), kind: 'text', x: g(p.x), y: g(p.y), label: 'text', style: { ...DEFAULT_STYLE } };
      commit({ ...scene, elements: [...scene.elements, el] });
      setSelection([el.id]);
      setTool('select');
      return;
    }
    if (tool === 'polygon' || tool === 'path') {
      setPending((pts) => [...pts, { x: g(p.x), y: g(p.y) }]);
      return;
    }
    if (tool === 'edge') {
      const from = hitNode(p);
      if (from) setDrag({ kind: 'edge', startX: p.x, startY: p.y, base: sceneRef.current, fromNode: from.id, cur: p });
      return;
    }
    const id = newId();
    const draft: DiagramElement | undefined =
      tool === 'rect'
        ? { id, kind: 'rect', x: g(p.x), y: g(p.y), w: 0, h: 0, style: { ...DEFAULT_STYLE } }
        : tool === 'ellipse'
          ? { id, kind: 'ellipse', cx: g(p.x), cy: g(p.y), rx: 0, ry: 0, style: { ...DEFAULT_STYLE } }
          : tool === 'line' || tool === 'arrow'
            ? { id, kind: 'line', x1: g(p.x), y1: g(p.y), x2: g(p.x), y2: g(p.y), arrowHead: tool === 'arrow' ? 'stealth' : 'none', style: { ...DEFAULT_STYLE } }
            : tool === 'raw-tikz'
              ? { id, kind: 'raw-tikz', x: g(p.x), y: g(p.y), w: 0, h: 0, code: '% paste TikZ here', style: { ...DEFAULT_STYLE } }
              : tool === 'plot'
                ? ({ id, kind: 'plot', x: g(p.x), y: g(p.y), w: 0, h: 0, source: { type: 'function', expr: 'sin(x)/x' }, settings: { xrange: '[-10:10]', yrange: '[]', xlabel: 'x', ylabel: 'y', plotStyle: 'lines' }, style: { ...DEFAULT_STYLE } } as PlotElement)
                : undefined;
    if (draft) setDrag({ kind: 'create', startX: g(p.x), startY: g(p.y), base: sceneRef.current, draft });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toWorld(e);
    if (drag.kind === 'pan') {
      setView((v) => ({ ...v, tx: drag.panBase!.tx + (e.clientX - drag.startX), ty: drag.panBase!.ty + (e.clientY - drag.startY) }));
      return;
    }
    if (drag.kind === 'marquee' || drag.kind === 'edge') {
      setDrag({ ...drag, cur: p });
      return;
    }
    if (drag.kind === 'move') {
      let dx = snapTo(p.x - drag.startX, scene.grid, scene.snap);
      let dy = snapTo(p.y - drag.startY, scene.grid, scene.snap);
      const snapped = alignSnap(selection, dx, dy, drag.base);
      dx = snapped.dx;
      dy = snapped.dy;
      setGuides(snapped.guides);
      const next = { ...drag.base, elements: drag.base.elements.map((el) => (selection.includes(el.id) ? translated(el, dx, dy) : el)) };
      setContent(fileId, serializeScene(next));
      return;
    }
    if (drag.kind === 'resize' && single) {
      const baseEl = drag.base.elements.find((el) => el.id === single.id);
      if (!baseEl) return;
      const b = bbox(baseEl, drag.base);
      const corners = [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ];
      const fixed = corners[(drag.handle! + 2) % 4]!;
      const px = snapTo(p.x, scene.grid, scene.snap);
      const py = snapTo(p.y, scene.grid, scene.snap);
      const box = { x: Math.min(fixed.x, px), y: Math.min(fixed.y, py), w: Math.max(8, Math.abs(px - fixed.x)), h: Math.max(8, Math.abs(py - fixed.y)) };
      const next = { ...drag.base, elements: drag.base.elements.map((el) => (el.id === single.id ? resizeTo(baseEl, box) : el)) };
      setContent(fileId, serializeScene(next));
      return;
    }
    if (drag.kind === 'create' && drag.draft) {
      const g = (v: number) => snapTo(v, scene.grid, scene.snap);
      const d = drag.draft;
      let updated: DiagramElement = d;
      if (d.kind === 'rect' || d.kind === 'raw-tikz' || d.kind === 'plot') {
        updated = { ...d, x: Math.min(drag.startX, g(p.x)), y: Math.min(drag.startY, g(p.y)), w: Math.abs(g(p.x) - drag.startX), h: Math.abs(g(p.y) - drag.startY) } as DiagramElement;
      } else if (d.kind === 'ellipse') {
        updated = { ...d, rx: Math.abs(g(p.x) - drag.startX), ry: Math.abs(g(p.y) - drag.startY) };
      } else if (d.kind === 'line') {
        updated = { ...d, x2: g(p.x), y2: g(p.y) };
      }
      setDrag({ ...drag, draft: updated });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toWorld(e);
    setGuides([]);
    if (drag.kind === 'move' || drag.kind === 'resize') {
      undoStack.current.push(serializeScene(drag.base));
      redoStack.current = [];
    } else if (drag.kind === 'marquee' && drag.cur) {
      const x0 = Math.min(drag.startX, drag.cur.x);
      const y0 = Math.min(drag.startY, drag.cur.y);
      const x1 = Math.max(drag.startX, drag.cur.x);
      const y1 = Math.max(drag.startY, drag.cur.y);
      if (x1 - x0 > 3 || y1 - y0 > 3) {
        const ids = scene.elements
          .filter((el) => {
            const b = bbox(el, scene);
            return b.x >= x0 && b.y >= y0 && b.x + b.w <= x1 && b.y + b.h <= y1;
          })
          .map((el) => el.id);
        setSelection((prev) => (e.shiftKey ? [...new Set([...prev, ...ids])] : ids));
      }
    } else if (drag.kind === 'edge' && drag.fromNode) {
      const target = hitNode(p);
      const to: EdgeElement['to'] = target && target.id !== drag.fromNode ? { node: target.id } : { x: snapTo(p.x, scene.grid, scene.snap), y: snapTo(p.y, scene.grid, scene.snap) };
      const el: EdgeElement = { id: newId(), kind: 'edge', from: { node: drag.fromNode }, to, arrowHead: 'stealth', bend: 0, label: '', labelPos: 'above', style: { ...DEFAULT_STYLE } };
      commit({ ...scene, elements: [...scene.elements, el] });
      setSelection([el.id]);
    } else if (drag.kind === 'create' && drag.draft) {
      const b = bbox(drag.draft, scene);
      if (b.w > 4 || b.h > 4 || drag.draft.kind === 'line') {
        commit({ ...scene, elements: [...scene.elements, drag.draft] });
        setSelection([drag.draft.id]);
        setTool('select');
      }
    }
    setDrag(null);
  };

  const finishPending = useCallback(() => {
    if (pending.length >= 2) {
      const el: DiagramElement =
        tool === 'polygon'
          ? { id: newId(), kind: 'polygon', points: pending, style: { ...DEFAULT_STYLE } }
          : { id: newId(), kind: 'path', points: pending, smooth: true, closed: false, style: { ...DEFAULT_STYLE } };
      commit({ ...sceneRef.current, elements: [...sceneRef.current.elements, el] });
      setSelection([el.id]);
    }
    setPending([]);
    setTool('select');
  }, [pending, tool, commit]);

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
      if (e.key === ' ') spaceDown.current = e.type === 'keydown';
      if (e.type !== 'keydown' || inField) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key === 'c') {
        clipboard.current = selected.map((el) => ({ ...el }));
      } else if (mod && e.key === 'v' && clipboard.current.length) {
        e.preventDefault();
        const pasted = clipboard.current.map((el) => ({ ...translated(el, 20, 20), id: newId() }));
        commit({ ...sceneRef.current, elements: [...sceneRef.current.elements, ...pasted] });
        setSelection(pasted.map((q) => q.id));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        commit({ ...sceneRef.current, elements: sceneRef.current.elements.filter((el) => !selection.includes(el.id)) });
        setSelection([]);
      } else if (e.key === 'Enter' && pending.length) {
        finishPending();
      } else if (e.key === 'Escape') {
        setPending([]);
        setSelection([]);
      } else if (e.key.startsWith('Arrow') && selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit({ ...sceneRef.current, elements: sceneRef.current.elements.map((el) => (selection.includes(el.id) ? translated(el, dx, dy) : el)) });
      } else if (!mod) {
        const map: Record<string, Tool> = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', a: 'arrow', p: 'path', n: 'node', t: 'text' };
        if (map[e.key]) setTool(map[e.key]!);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [selection, selected, commit, undo, redo, pending, finishPending]);

  const onWheel = (e: React.WheelEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const rect = svgRef.current!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((v) => {
        const scale = Math.min(4, Math.max(0.2, v.scale * factor));
        return { scale, tx: px - ((px - v.tx) / v.scale) * scale, ty: py - ((py - v.ty) / v.scale) * scale };
      });
    } else {
      setView((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
    }
  };

  // ── Panel mutations ──
  const updateSelected = (patch: (el: DiagramElement) => DiagramElement) => {
    commit({ ...scene, elements: scene.elements.map((el) => (selection.includes(el.id) ? patch(el) : el)) });
  };
  const updateStyle = (patch: Partial<DiagramStyle>) => updateSelected((el) => ({ ...el, style: { ...el.style, ...patch } }));
  const reorder = (dir: 1 | -1) => {
    const els = [...scene.elements];
    const idx = els.findIndex((el) => el.id === selection[0]);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= els.length) return;
    const a = els[idx]!;
    els[idx] = els[j]!;
    els[j] = a;
    commit({ ...scene, elements: els });
  };

  // ── Templates: click-to-insert at the viewport centre ──
  const insertTemplate = useCallback(
    (t: DiagramTemplate) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const cx = rect ? (rect.width / 2 - view.tx) / view.scale : 200;
      const cy = rect ? (rect.height / 2 - view.ty) / view.scale : 150;
      const s = sceneRef.current;
      const el: TemplateElement = {
        id: newId(),
        kind: 'template',
        templateId: t.id,
        x: snapTo(cx, s.grid, s.snap),
        y: snapTo(cy, s.grid, s.snap),
        params: templateDefaults(t),
        style: { ...DEFAULT_STYLE },
      };
      commit({ ...s, elements: [...s.elements, el] });
      setSelection([el.id]);
      setTool('select');
      if (t.requiredPackages.length > 0) {
        setNotice(`${t.name} needs ${t.requiredPackages.map((r) => r.replace(/^lib:/, 'tikzlibrary ')).join(', ')} — you'll be offered the exact preamble lines on export (never added silently).`);
      }
    },
    [commit, view],
  );

  // ── TikZ + preview + exports ──
  const tikz = useMemo(() => sceneToTikz(scene, path.split('/').pop()), [scene, path]);
  const reqs = useMemo(() => sceneRequirements(scene), [scene]);
  const reqBody = useMemo(
    () => ({
      ...(reqs.packages.length ? { packages: reqs.packages } : {}),
      ...(reqs.libraries.length ? { tikzLibraries: reqs.libraries } : {}),
    }),
    [reqs],
  );

  useEffect(() => {
    if (!projectId || scene.elements.length === 0) {
      setPreview({ busy: false });
      return;
    }
    const t = setTimeout(() => {
      setPreview((prev) => ({ ...prev, busy: true }));
      api
        .renderSnippet(projectId, { latex: tikz.code, kind: 'tikz', ...reqBody })
        .then((r) => setPreview({ png: `data:image/png;base64,${r.pngBase64}`, busy: false }))
        .catch((err) => setPreview({ error: err instanceof Error ? err.message : 'preview failed', busy: false }));
    }, 900);
    return () => clearTimeout(t);
  }, [tikz.code, projectId, scene.elements.length, reqBody]);

  // The preamble offer: when the diagram's templates need packages/libraries
  // the document doesn't load, show the EXACT lines and let the user accept or
  // export without them. The document is NEVER modified silently.
  const ensurePreamble = useCallback(
    async (proceed: () => void | Promise<void>) => {
      const r = sceneRequirements(sceneRef.current);
      if (r.packages.length === 0 && r.libraries.length === 0) return void proceed();
      const rootFile = projects.find((pr) => pr.id === projectId)?.rootFile ?? 'main.tex';
      const root = files.find((fl) => fl.path === rootFile);
      if (!root) return void proceed();
      const current = useEditorStore.getState().contents[root.id] ?? (await api.getFile(root.id)).content;
      const missing = missingPreambleLines(current, r);
      if (missing.length === 0) return void proceed();
      setPreambleOffer({
        lines: missing,
        rootName: rootFile,
        accept: () => {
          setContent(root.id, patchPreamble(current, missing));
          setPreambleOffer(null);
          void proceed();
        },
        skip: () => {
          setPreambleOffer(null);
          void proceed();
        },
      });
    },
    [projects, projectId, files, setContent],
  );

  const writeProjectFile = useCallback(
    async (relPath: string, body: string, encoding: 'utf8' | 'base64' = 'utf8') => {
      if (!projectId) return;
      const existing = files.find((fl) => fl.path === relPath);
      if (existing) await api.updateFile(existing.id, { content: body });
      else await api.createFile(projectId, relPath, body, encoding);
      await useEditorStore.getState().refreshFiles(); // surface the export in the Files tab
    },
    [projectId, files],
  );

  const exportTikz = useCallback(
    () =>
      void ensurePreamble(async () => {
        await writeProjectFile(tikzExportPath(path), tikz.code);
        setNotice(`Exported ${tikzExportPath(path)} — reference it with ${inputSnippet(path)}`);
      }),
    [ensurePreamble, writeProjectFile, path, tikz.code],
  );

  const exportAndInsert = useCallback(
    () =>
      void ensurePreamble(async () => {
        await writeProjectFile(tikzExportPath(path), tikz.code);
        const rootFile = projects.find((pr) => pr.id === projectId)?.rootFile ?? 'main.tex';
        const root = files.find((fl) => fl.path === rootFile);
        if (!root) {
          setNotice('Exported, but the root file was not found to insert into.');
          return;
        }
        // Fresh from the store — an accepted preamble patch must not be lost.
        const current = useEditorStore.getState().contents[root.id] ?? (await api.getFile(root.id)).content;
        const line = `${inputSnippet(path)}\n`;
        const next = current.includes(line.trim())
          ? current
          : current.includes('\\end{document}')
            ? current.replace('\\end{document}', `${line}\\end{document}`)
            : `${current}\n${line}`;
        setContent(root.id, next);
        setNotice(`Exported and inserted ${inputSnippet(path)} into ${rootFile}.`);
      }),
    [ensurePreamble, writeProjectFile, path, tikz.code, projects, projectId, files, setContent],
  );

  const exportPdf = useCallback(async () => {
    if (!projectId) return;
    setNotice('Compiling frozen PDF export…');
    try {
      const base = tikzExportPath(path).replace(/\.tikz$/, '');
      const r = await api.diagramPdf(projectId, { tikz: tikz.code, outPath: `${base}.pdf`, ...reqBody });
      setNotice(`Compiled ${r.path} — use \\includegraphics{${r.path}}. (TikZ export recompiles with the document; PDF is frozen vector art.)`);
    } catch (err) {
      setNotice(`PDF export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [projectId, path, tikz.code, reqBody]);

  // Render the diagram to a PNG and add it to the project's files (figures/), so
  // it shows in the Files tab and is usable from LaTeX via \includegraphics —
  // without leaving the .diagram.json source as the only artefact.
  const exportPng = useCallback(
    () =>
      void ensurePreamble(async () => {
        if (!projectId) return;
        if (scene.elements.length === 0) {
          setNotice('Nothing to export — draw something first.');
          return;
        }
        setNotice('Rendering image…');
        try {
          const r = await api.renderSnippet(projectId, { latex: tikz.code, kind: 'tikz', ...reqBody });
          const base = (path.split('/').pop() ?? 'diagram').replace(/\.diagram\.json$/i, '') || 'diagram';
          const out = `figures/${base}.png`;
          await writeProjectFile(out, r.pngBase64, 'base64');
          setNotice(`Exported ${out} to your files — include it with \\includegraphics{${out}}`);
        } catch (err) {
          setNotice(`Image export failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    [ensurePreamble, projectId, scene.elements.length, tikz.code, reqBody, path, writeProjectFile],
  );

  // ── GNUplot (sandboxed) ──
  const runPlots = useCallback(async () => {
    if (!projectId) return;
    const plots = sceneRef.current.elements.filter((el): el is PlotElement => el.kind === 'plot');
    if (plots.length === 0) {
      setNotice('No plot elements in this diagram.');
      return;
    }
    setPlotOut('Running GNUplot (sandboxed)…');
    let log = '';
    const updated = new Map<string, Partial<PlotElement>>();
    for (const pl of plots) {
      try {
        const r = await api.runGnuplot(projectId, {
          source: pl.source,
          settings: pl.settings,
          style: { stroke: pl.style.stroke, strokeWidth: pl.style.strokeWidth, dash: pl.style.dash },
          widthCm: Math.max(4, pl.w / 40),
          heightCm: Math.max(3, pl.h / 40),
          base: pl.generatedBase ?? `plot-${pl.id}`,
        });
        log += `── ${pl.source.type === 'function' ? pl.source.expr : 'data plot'} ──\n${r.stdout || ''}${r.stderr || ''}${r.ok ? `✓ generated diagrams/plots/${r.base}.tex + .pdf\n` : '✗ failed\n'}`;
        if (r.ok) updated.set(pl.id, { generatedBase: r.base, ...(r.previewPng ? { previewPng: `data:image/png;base64,${r.previewPng}` } : {}) });
      } catch (err) {
        log += `✗ ${err instanceof Error ? err.message : String(err)}\n`;
      }
    }
    setPlotOut(log.trim());
    if (updated.size > 0) {
      commit({ ...sceneRef.current, elements: sceneRef.current.elements.map((el) => (updated.has(el.id) ? ({ ...el, ...updated.get(el.id) } as DiagramElement) : el)) });
    }
  }, [projectId, commit]);

  // ── Render ──
  const gridStep = scene.grid * view.scale;
  return (
    <div className="flex h-full min-h-0 bg-[var(--ls-surface)]" data-testid="tikz-diagram-editor">
      <div className="flex w-11 flex-none flex-col items-center gap-1 overflow-y-auto border-r border-[var(--ls-line)] bg-[var(--ls-editor-bg)] py-2">
        <button
          type="button"
          title="Template objects — axes, vectors, solids, curves, sets (click to insert)"
          data-testid="dtool-template"
          aria-pressed={paletteOpen}
          onClick={() => setPaletteOpen((o) => !o)}
          className={`rounded-md p-1.5 transition-colors ${paletteOpen ? 'bg-[#4e68f5] text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:text-[#98a2bb] dark:hover:bg-[#131b30]'}`}
        >
          <Shapes className="h-4 w-4" />
        </button>
        <div className="my-1 h-px w-6 bg-[var(--ls-line)]" />
        {TOOLS.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            type="button"
            title={label}
            data-testid={`dtool-${key}`}
            aria-pressed={tool === key}
            onClick={() => {
              setPending([]);
              setTool(key);
            }}
            className={`rounded-md p-1.5 transition-colors ${tool === key ? 'bg-[#4e68f5] text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:text-[#98a2bb] dark:hover:bg-[#131b30]'}`}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <div className="my-1 h-px w-6 bg-[var(--ls-line)]" />
        <button type="button" title="Undo (⌘Z)" data-testid="dundo" onClick={undo} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-[#98a2bb] dark:hover:bg-[#131b30]">
          <Undo2 className="h-4 w-4" />
        </button>
        <button type="button" title="Redo (⇧⌘Z)" onClick={redo} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-[#98a2bb] dark:hover:bg-[#131b30]">
          <Redo2 className="h-4 w-4" />
        </button>
      </div>

      {paletteOpen && <TemplatePalette scene={scene} onInsert={insertTemplate} />}

      <div className="relative min-w-0 flex-1">
        <svg
          ref={svgRef}
          data-testid="diagram-canvas"
          className="h-full w-full touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={() => pending.length && finishPending()}
          onWheel={onWheel}
          style={{ background: 'var(--ls-bg)', cursor: tool === 'select' ? 'default' : 'crosshair' }}
        >
          <defs>
            <pattern id="dgrid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse" x={view.tx % gridStep} y={view.ty % gridStep}>
              <circle cx="0.7" cy="0.7" r="0.7" fill="currentColor" className="text-zinc-300 dark:text-[#243049]" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dgrid)" />
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}>
            {scene.elements.map((el) => (
              <ElementView key={el.id} el={el} scene={scene} selected={selection.includes(el.id)} />
            ))}
            {drag?.kind === 'create' && drag.draft && <ElementView el={drag.draft} scene={scene} selected={false} draft />}
            {pending.length > 0 && (
              <polyline points={pending.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#4e68f5" strokeDasharray="4 3" strokeWidth={1.5 / view.scale} />
            )}
            {drag?.kind === 'edge' && drag.cur && (
              <line x1={drag.startX} y1={drag.startY} x2={drag.cur.x} y2={drag.cur.y} stroke="#4e68f5" strokeDasharray="4 3" strokeWidth={1.5 / view.scale} />
            )}
            {drag?.kind === 'marquee' && drag.cur && (
              <rect
                x={Math.min(drag.startX, drag.cur.x)}
                y={Math.min(drag.startY, drag.cur.y)}
                width={Math.abs(drag.cur.x - drag.startX)}
                height={Math.abs(drag.cur.y - drag.startY)}
                fill="rgba(78,104,245,0.08)"
                stroke="#4e68f5"
                strokeWidth={1 / view.scale}
              />
            )}
            {guides.map((gd, i) =>
              gd.x !== undefined ? (
                <line key={i} x1={gd.x} y1={-5000} x2={gd.x} y2={5000} stroke="#e8a33d" strokeWidth={1 / view.scale} />
              ) : (
                <line key={i} x1={-5000} y1={gd.y!} x2={5000} y2={gd.y!} stroke="#e8a33d" strokeWidth={1 / view.scale} />
              ),
            )}
            {single && (
              <SelectionHandles
                el={single}
                scene={scene}
                scale={view.scale}
                onStart={(handle, ev) => {
                  ev.stopPropagation();
                  setDrag({ kind: 'resize', startX: 0, startY: 0, base: sceneRef.current, handle });
                }}
              />
            )}
          </g>
        </svg>
        {notice && (
          <div data-testid="diagram-notice" className="absolute bottom-2 left-2 right-2 rounded-md border border-[var(--ls-line)] bg-[var(--ls-surface)] px-3 py-1.5 text-xs text-[var(--ls-muted)]">
            {notice}
            <button type="button" className="ml-2 text-[#4e68f5]" onClick={() => setNotice(null)}>
              dismiss
            </button>
          </div>
        )}
      </div>

      <SidePanel
        {...(embedded && projectId ? { fullPageHref: `/math-diagram?project=${projectId}&file=${encodeURIComponent(path)}` } : {})}
        scene={scene}
        selection={selection}
        single={single}
        tikz={tikz.code}
        preview={preview}
        plotOut={plotOut}
        commit={commit}
        setSelection={setSelection}
        updateSelected={updateSelected}
        updateStyle={updateStyle}
        reorder={reorder}
        exportTikz={exportTikz}
        exportAndInsert={exportAndInsert}
        exportPdf={exportPdf}
        exportPng={exportPng}
        runPlots={runPlots}
      />

      {preambleOffer && (
        <div data-testid="dpreamble-offer" className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
          <div className="w-full max-w-md rounded-xl border border-[var(--ls-line-strong)] bg-[var(--ls-surface)] p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-[var(--ls-text)]">Add required packages to {preambleOffer.rootName}?</h3>
            <p className="mt-1 text-xs text-[var(--ls-muted)]">
              The template objects in this diagram need preamble lines the document doesn't have yet. Accept to add exactly these lines — nothing is ever changed silently:
            </p>
            <pre data-testid="dpreamble-lines" className="mt-2 max-h-40 overflow-auto rounded-md bg-[var(--ls-editor-bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--ls-text)]">
              {preambleOffer.lines.join('\n')}
            </pre>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                data-testid="dpreamble-skip"
                onClick={preambleOffer.skip}
                className="rounded-md border border-[var(--ls-line-strong)] px-3 py-1 text-xs text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]"
              >
                Export without
              </button>
              <button
                type="button"
                data-testid="dpreamble-accept"
                onClick={preambleOffer.accept}
                className="rounded-md bg-[#4e68f5] px-3 py-1 text-xs font-semibold text-white hover:bg-[#5f78f8]"
              >
                Add &amp; export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preamble diffing for template requirements ───────────────────────────────

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The exact preamble lines the document is missing for `reqs` — empty when
 *  everything is already loaded. */
export function missingPreambleLines(rootContent: string, reqs: { packages: string[]; libraries: string[] }): string[] {
  const lines: string[] = [];
  for (const p of reqs.packages) {
    const loaded = new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{[^}]*\\b${escRe(p)}\\b[^}]*\\}`).test(rootContent);
    if (!loaded) lines.push(`\\usepackage{${p}}`);
    if (p === 'pgfplots' && !/\\pgfplotsset\s*\{[^}]*compat/.test(rootContent)) lines.push('\\pgfplotsset{compat=newest}');
  }
  const loadedLibs = [...rootContent.matchAll(/\\usetikzlibrary\s*\{([^}]*)\}/g)].flatMap((m) => (m[1] ?? '').split(',').map((s) => s.trim()));
  // fillbetween & co. only load correctly via \usepgfplotslibrary — offer that
  // form, and recognise it as already loaded.
  const loadedPlotLibs = [...rootContent.matchAll(/\\usepgfplotslibrary\s*\{([^}]*)\}/g)].flatMap((m) => (m[1] ?? '').split(',').map((s) => s.trim()));
  const missingLibs = reqs.libraries.filter((l) => !PGFPLOTS_TIKZ_LIBS.has(l) && !loadedLibs.includes(l));
  const missingPlotLibs = reqs.libraries.filter((l) => PGFPLOTS_TIKZ_LIBS.has(l) && !loadedPlotLibs.includes(l));
  if (missingLibs.length > 0) lines.push(`\\usetikzlibrary{${missingLibs.join(',')}}`);
  if (missingPlotLibs.length > 0) lines.push(`\\usepgfplotslibrary{${missingPlotLibs.join(',')}}`);
  return lines;
}

/** Insert preamble lines after the last \usepackage (or the \documentclass). */
export function patchPreamble(content: string, lines: string[]): string {
  const insertion = lines.join('\n');
  const pkgMatches = [...content.matchAll(/^[^\n%]*\\usepackage[^\n]*$/gm)];
  const last = pkgMatches[pkgMatches.length - 1];
  if (last && last.index !== undefined) {
    const at = last.index + last[0].length;
    return `${content.slice(0, at)}\n${insertion}${content.slice(at)}`;
  }
  const dc = /\\documentclass[^\n]*\n/.exec(content);
  if (dc) {
    const at = dc.index + dc[0].length;
    return `${content.slice(0, at)}${insertion}\n${content.slice(at)}`;
  }
  return `${insertion}\n${content}`;
}

function resizeTo(el: DiagramElement, b: { x: number; y: number; w: number; h: number }): DiagramElement {
  switch (el.kind) {
    case 'rect':
    case 'raw-tikz':
    case 'plot':
      return { ...el, x: b.x, y: b.y, w: b.w, h: b.h };
    case 'node':
      return { ...el, x: b.x + b.w / 2, y: b.y + b.h / 2, w: b.w, h: b.h };
    case 'ellipse':
      return { ...el, cx: b.x + b.w / 2, cy: b.y + b.h / 2, rx: b.w / 2, ry: b.h / 2 };
    case 'line':
      return { ...el, x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h };
    default:
      return el;
  }
}

// ── Element rendering ────────────────────────────────────────────────────────

function svgDash(d: DiagramStyle['dash']): string | undefined {
  return d === 'dashed' ? '6 4' : d === 'dotted' ? '1.5 3' : undefined;
}

function ArrowTip({ x, y, angle, color, size = 9 }: { x: number; y: number; angle: number; color: string; size?: number }) {
  const a1 = angle + Math.PI * 0.85;
  const a2 = angle - Math.PI * 0.85;
  return (
    <path
      d={`M${x + Math.cos(a1) * size},${y + Math.sin(a1) * size} L${x},${y} L${x + Math.cos(a2) * size},${y + Math.sin(a2) * size}`}
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
    />
  );
}

function Label({ x, y, label, fontSize }: { x: number; y: number; label: string; fontSize?: number | undefined }) {
  if (!label) return null;
  return (
    <foreignObject x={x - 100} y={y - 14} width={200} height={28} style={{ pointerEvents: 'none', overflow: 'visible' }}>
      <div
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', fontSize: fontSize ?? 13 }}
        className="text-zinc-800 dark:text-[#eef1f8]"
        dangerouslySetInnerHTML={{ __html: labelHtml(label) }}
      />
    </foreignObject>
  );
}

function ElementView({ el, scene, selected, draft }: { el: DiagramElement; scene: DiagramScene; selected: boolean; draft?: boolean }) {
  const s = el.style;
  const stroke = s.stroke || 'transparent';
  const common = {
    stroke,
    strokeWidth: s.strokeWidth,
    strokeDasharray: svgDash(s.dash),
    fill: s.fill || 'none',
    opacity: draft ? 0.6 : s.opacity,
  } as const;
  const sel = selected ? { filter: 'drop-shadow(0 0 2px #4e68f5)' } : undefined;
  const c = bboxCentre(el, scene);
  const rot = el.rotation ? `rotate(${el.rotation} ${c.x} ${c.y})` : undefined;

  switch (el.kind) {
    case 'rect':
      return <rect transform={rot} style={sel} x={el.x} y={el.y} width={el.w} height={el.h} {...common} />;
    case 'ellipse':
      return <ellipse transform={rot} style={sel} cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...common} />;
    case 'polygon':
      return <polygon transform={rot} style={sel} points={el.points.map((p) => `${p.x},${p.y}`).join(' ')} {...common} />;
    case 'path': {
      const d = el.smooth ? smoothPath(el.points, el.closed) : `M${el.points.map((p) => `${p.x},${p.y}`).join(' L')}${el.closed ? ' Z' : ''}`;
      return <path transform={rot} style={sel} d={d} {...common} />;
    }
    case 'line': {
      const angle = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
      return (
        <g style={sel}>
          <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...common} fill="none" />
          {el.arrowHead !== 'none' && <ArrowTip x={el.x2} y={el.y2} angle={angle} color={stroke} />}
        </g>
      );
    }
    case 'node':
      return (
        <g style={sel} transform={rot} data-testid="dnode">
          {el.shape === 'rect' ? (
            <rect x={el.x - el.w / 2} y={el.y - el.h / 2} width={el.w} height={el.h} rx={2} {...common} fill={s.fill || 'var(--ls-surface)'} />
          ) : (
            <ellipse cx={el.x} cy={el.y} rx={el.w / 2} ry={el.shape === 'circle' ? el.w / 2 : el.h / 2} {...common} fill={s.fill || 'var(--ls-surface)'} />
          )}
          <Label x={el.x} y={el.y} label={el.label} fontSize={s.fontSize} />
        </g>
      );
    case 'edge': {
      const { a, b } = edgeEnds(scene, el);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const k = (Math.tan((el.bend * Math.PI) / 360) * len) / 1.5;
      const cx = mx + nx * k;
      const cy = my + ny * k;
      const angle = Math.atan2(b.y - cy, b.x - cx);
      return (
        <g style={sel} data-testid="dedge">
          <path d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`} stroke={stroke} strokeWidth={s.strokeWidth} strokeDasharray={svgDash(s.dash)} fill="none" opacity={s.opacity} />
          {el.arrowHead !== 'none' && <ArrowTip x={b.x} y={b.y} angle={angle} color={stroke} />}
          {el.label && <Label x={cx} y={cy - 12} label={el.label} fontSize={s.fontSize} />}
        </g>
      );
    }
    case 'text':
      return (
        <g style={sel}>
          <foreignObject x={el.x} y={el.y - 10} width={300} height={24} style={{ pointerEvents: 'none', overflow: 'visible' }}>
            <div style={{ fontSize: el.style.fontSize ?? 13, color: el.style.stroke || undefined }} className="text-zinc-800 dark:text-[#eef1f8]" dangerouslySetInnerHTML={{ __html: labelHtml(el.label) }} />
          </foreignObject>
        </g>
      );
    case 'raw-tikz':
      return (
        <g style={sel}>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="rgba(78,104,245,0.06)" stroke="#4e68f5" strokeDasharray="5 4" strokeWidth={1} />
          <text x={el.x + 6} y={el.y + 16} fontSize={11} className="fill-zinc-500 dark:fill-[#8fa3ff]" style={{ fontFamily: 'var(--ls-mono)' }}>
            raw TikZ (exported verbatim)
          </text>
        </g>
      );
    case 'plot':
      return (
        <g style={sel}>
          {el.previewPng ? (
            <image href={el.previewPng} x={el.x} y={el.y} width={el.w} height={el.h} preserveAspectRatio="xMidYMid meet" />
          ) : (
            <>
              <rect x={el.x} y={el.y} width={el.w} height={el.h} fill="rgba(69,184,158,0.06)" stroke="#45b89e" strokeDasharray="5 4" strokeWidth={1} />
              <text x={el.x + 6} y={el.y + 16} fontSize={11} className="fill-zinc-500 dark:fill-[#7fd8c4]">
                plot: {el.source.type === 'function' ? el.source.expr : 'data'} — Run plots to generate
              </text>
            </>
          )}
        </g>
      );
    case 'template': {
      const t = getTemplate(el.templateId);
      const ctx: TemplateCtx = { view3d: scene.view3d, scale: 40 };
      return (
        <g style={sel} data-testid="dtemplate" transform={`translate(${el.x},${el.y})`} opacity={draft ? 0.6 : s.opacity}>
          {t ? (
            t.renderCanvas(el.params, ctx)
          ) : (
            <text fontSize={11} className="fill-red-400">
              unknown template “{el.templateId}”
            </text>
          )}
        </g>
      );
    }
  }
}

function bboxCentre(el: DiagramElement, scene: DiagramScene): { x: number; y: number } {
  const b = bbox(el, scene);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function smoothPath(pts: Array<{ x: number; y: number }>, closed: boolean): string {
  if (pts.length < 3) return `M${pts.map((p) => `${p.x},${p.y}`).join(' L')}`;
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i]!.x + pts[i + 1]!.x) / 2;
    const my = (pts[i]!.y + pts[i + 1]!.y) / 2;
    d += ` Q${pts[i]!.x},${pts[i]!.y} ${mx},${my}`;
  }
  d += ` L${pts[pts.length - 1]!.x},${pts[pts.length - 1]!.y}`;
  return closed ? `${d} Z` : d;
}

function SelectionHandles({ el, scene, scale, onStart }: { el: DiagramElement; scene: DiagramScene; scale: number; onStart: (handle: number, ev: React.PointerEvent) => void }) {
  const b = bbox(el, scene);
  const size = 7 / scale;
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
  const resizable = ['rect', 'ellipse', 'node', 'raw-tikz', 'plot', 'line'].includes(el.kind);
  return (
    <g data-testid="dhandles">
      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke="#4e68f5" strokeDasharray={`${4 / scale} ${3 / scale}`} strokeWidth={1 / scale} />
      {resizable &&
        corners.map((q, i) => (
          <rect key={i} x={q.x - size / 2} y={q.y - size / 2} width={size} height={size} fill="#4e68f5" style={{ cursor: i % 2 === 0 ? 'nwse-resize' : 'nesw-resize' }} onPointerDown={(ev) => onStart(i, ev)} />
        ))}
    </g>
  );
}

// ── Side panel (style · inspector · layers · params · TikZ · preview · plots) ─

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--ls-muted)]">
      {label}
      {children}
    </label>
  );
}

const numInput = 'w-16 rounded border border-[var(--ls-line)] bg-transparent px-1 py-0.5 text-right text-[11px] text-[var(--ls-text)] outline-none focus:border-[#4e68f5]';
const textInput = 'w-full rounded border border-[var(--ls-line)] bg-transparent px-1.5 py-0.5 text-[12px] text-[var(--ls-text)] outline-none focus:border-[#4e68f5]';

interface SidePanelProps {
  fullPageHref?: string;
  scene: DiagramScene;
  selection: string[];
  single: DiagramElement | undefined;
  tikz: string;
  preview: { png?: string; error?: string; busy: boolean };
  plotOut: string | null;
  commit: (s: DiagramScene) => void;
  setSelection: (ids: string[]) => void;
  updateSelected: (patch: (el: DiagramElement) => DiagramElement) => void;
  updateStyle: (patch: Partial<DiagramStyle>) => void;
  reorder: (dir: 1 | -1) => void;
  exportTikz: () => void;
  exportAndInsert: () => void;
  exportPdf: () => void;
  exportPng: () => void;
  runPlots: () => void;
}

function SidePanel(props: SidePanelProps) {
  const { scene, selection, single, tikz, preview, plotOut, commit, setSelection, updateSelected, updateStyle, reorder } = props;
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const s = single?.style;
  const setNum = (k: string, v: number) => updateSelected((el) => ({ ...el, [k]: v }) as DiagramElement);

  return (
    <div className="flex w-72 flex-none flex-col gap-3 overflow-y-auto border-l border-[var(--ls-line)] bg-[var(--ls-editor-bg)] p-3 text-sm">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" data-testid="dexport-tikz" onClick={props.exportTikz} className="rounded-md bg-[#4e68f5] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#5f78f8]">
          Export TikZ
        </button>
        <button type="button" data-testid="dexport-insert" onClick={props.exportAndInsert} className="rounded-md border border-[var(--ls-line-strong)] px-2.5 py-1 text-xs text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]">
          Export + insert \input
        </button>
        <button
          type="button"
          data-testid="dexport-pdf"
          title="Frozen vector PDF for \includegraphics — for art that should NOT recompile with the document"
          onClick={props.exportPdf}
          className="rounded-md border border-[var(--ls-line-strong)] px-2.5 py-1 text-xs text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]"
        >
          Export PDF
        </button>
        <button
          type="button"
          data-testid="dexport-png"
          title="Render the diagram to a PNG in figures/ — shows in the Files tab, use it with \includegraphics"
          onClick={props.exportPng}
          className="rounded-md border border-[var(--ls-line-strong)] px-2.5 py-1 text-xs text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]"
        >
          Export image → files
        </button>
        <button type="button" data-testid="drun-plots" onClick={props.runPlots} className="rounded-md border border-[#45b89e]/50 px-2.5 py-1 text-xs text-[#2f9c84] hover:bg-[#45b89e]/10 dark:text-[#7fd8c4]">
          <Play className="mr-1 inline h-3 w-3" />
          Run plots
        </button>
        {props.fullPageHref && (
          <a
            href={props.fullPageHref}
            data-testid="dopen-full"
            className="rounded-md border border-[var(--ls-line-strong)] px-2.5 py-1 text-xs text-[var(--ls-text)] hover:bg-[var(--ls-surface-muted)]"
            title="Open this diagram on its own full-size page"
          >
            Open full page ↗
          </a>
        )}
      </div>

      {single?.kind === 'template' && <TemplateFields el={single} updateSelected={updateSelected} />}

      {has3dTemplate(scene) && (
        <section className="space-y-1.5 rounded-lg border border-[var(--ls-line)] p-2" data-testid="dview3d">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">3D view (shared by every 3D object)</h3>
          <Field label="θ tilt from z">
            <input
              data-testid="dview-theta"
              type="number"
              min={0}
              max={180}
              step={5}
              value={scene.view3d.theta}
              onChange={(e) => commit({ ...scene, view3d: { ...scene.view3d, theta: Number(e.target.value) } })}
              className={numInput}
            />
          </Field>
          <Field label="φ rotation">
            <input
              data-testid="dview-phi"
              type="number"
              min={-360}
              max={360}
              step={5}
              value={scene.view3d.phi}
              onChange={(e) => commit({ ...scene, view3d: { ...scene.view3d, phi: Number(e.target.value) } })}
              className={numInput}
            />
          </Field>
          <p className="text-[10px] text-[var(--ls-muted)]">Exported once as \tdplotsetmaincoords — solids and axes stay on one frame.</p>
        </section>
      )}

      {single && s && (
        <section className="space-y-1.5 rounded-lg border border-[var(--ls-line)] p-2" data-testid="dstyle">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">Style</h3>
          <Field label="Stroke">
            <input type="color" value={s.stroke || '#000000'} onChange={(e) => updateStyle({ stroke: e.target.value })} className="h-5 w-8" />
          </Field>
          <Field label="Width">
            <input type="number" step={0.2} min={0.2} value={s.strokeWidth} onChange={(e) => updateStyle({ strokeWidth: Number(e.target.value) })} className={numInput} />
          </Field>
          <Field label="Dash">
            <select value={s.dash} data-testid="dstyle-dash" onChange={(e) => updateStyle({ dash: e.target.value as DiagramStyle['dash'] })} className={`${numInput} w-20`}>
              <option value="solid">solid</option>
              <option value="dashed">dashed</option>
              <option value="dotted">dotted</option>
            </select>
          </Field>
          <Field label="Fill">
            <span className="flex items-center gap-1">
              <input type="color" value={s.fill || '#ffffff'} onChange={(e) => updateStyle({ fill: e.target.value })} className="h-5 w-8" />
              <button type="button" className="text-[10px] text-[var(--ls-muted)] underline" onClick={() => updateStyle({ fill: '' })}>
                none
              </button>
            </span>
          </Field>
          <Field label="Opacity">
            <input type="number" step={0.1} min={0} max={1} value={s.opacity} onChange={(e) => updateStyle({ opacity: Number(e.target.value) })} className={numInput} />
          </Field>
          <Field label="Font size">
            <input type="number" min={4} value={s.fontSize ?? 10} onChange={(e) => updateStyle({ fontSize: Number(e.target.value) })} className={numInput} />
          </Field>
          {(single.kind === 'line' || single.kind === 'edge') && (
            <Field label="Arrowhead">
              <select value={single.arrowHead} data-testid="dstyle-arrow" onChange={(e) => updateSelected((el) => ({ ...el, arrowHead: e.target.value }) as DiagramElement)} className={`${numInput} w-20`}>
                <option value="none">none</option>
                <option value="arrow">arrow</option>
                <option value="stealth">stealth</option>
                <option value="latex">latex</option>
              </select>
            </Field>
          )}
          {single.kind === 'edge' && (
            <>
              <Field label="Bend">
                <input type="number" step={5} min={-90} max={90} value={single.bend} data-testid="dedge-bend" onChange={(e) => updateSelected((el) => ({ ...el, bend: Number(e.target.value) }) as DiagramElement)} className={numInput} />
              </Field>
              <Field label="Label pos">
                <select value={single.labelPos} onChange={(e) => updateSelected((el) => ({ ...el, labelPos: e.target.value }) as DiagramElement)} className={`${numInput} w-20`}>
                  {['above', 'below', 'left', 'right', 'midway'].map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {single.kind === 'node' && (
            <Field label="Shape">
              <select value={single.shape} onChange={(e) => updateSelected((el) => ({ ...el, shape: e.target.value }) as DiagramElement)} className={`${numInput} w-20`}>
                <option value="rect">rect</option>
                <option value="circle">circle</option>
                <option value="ellipse">ellipse</option>
              </select>
            </Field>
          )}
          {(single.kind === 'node' || single.kind === 'edge' || single.kind === 'text') && (
            <div>
              <span className="text-[11px] text-[var(--ls-muted)]">Label (LaTeX — $…$ for maths)</span>
              <input
                value={single.label}
                data-testid="dlabel-input"
                onChange={(e) => updateSelected((el) => ({ ...el, label: e.target.value }) as DiagramElement)}
                className={textInput}
                placeholder="$A \otimes B$"
              />
            </div>
          )}
          {single.kind === 'raw-tikz' && (
            <div>
              <span className="text-[11px] text-[var(--ls-muted)]">TikZ code (verbatim in export — never parsed back onto the canvas)</span>
              <textarea
                value={single.code}
                data-testid="draw-tikz-code"
                onChange={(e) => updateSelected((el) => ({ ...el, code: e.target.value }) as DiagramElement)}
                rows={4}
                className={`${textInput} resize-y font-mono text-[11px]`}
              />
            </div>
          )}
          {single.kind === 'plot' && <PlotFields el={single} updateSelected={updateSelected} />}
        </section>
      )}

      {single && (
        <section className="space-y-1.5 rounded-lg border border-[var(--ls-line)] p-2" data-testid="dinspector">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">Position & size (px · 40px = 1cm)</h3>
          {'x' in single && typeof (single as { x?: unknown }).x === 'number' && (
            <Field label="x">
              <input data-testid="dinspect-x" type="number" value={Math.round((single as { x: number }).x)} onChange={(e) => setNum('x', Number(e.target.value))} className={numInput} />
            </Field>
          )}
          {'y' in single && typeof (single as { y?: unknown }).y === 'number' && (
            <Field label="y">
              <input data-testid="dinspect-y" type="number" value={Math.round((single as { y: number }).y)} onChange={(e) => setNum('y', Number(e.target.value))} className={numInput} />
            </Field>
          )}
          {'w' in single && (
            <Field label="w">
              <input type="number" value={Math.round((single as { w: number }).w)} onChange={(e) => setNum('w', Number(e.target.value))} className={numInput} />
            </Field>
          )}
          {'h' in single && (
            <Field label="h">
              <input type="number" value={Math.round((single as { h: number }).h)} onChange={(e) => setNum('h', Number(e.target.value))} className={numInput} />
            </Field>
          )}
          <Field label="Rotate °">
            <input type="number" value={single.rotation ?? 0} onChange={(e) => updateSelected((el) => ({ ...el, rotation: Number(e.target.value) }))} className={numInput} />
          </Field>
          <div className="flex gap-1 pt-1">
            <button type="button" title="Raise" onClick={() => reorder(1)} className="rounded border border-[var(--ls-line)] p-1 text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]">
              <MoveUp className="h-3 w-3" />
            </button>
            <button type="button" title="Lower" onClick={() => reorder(-1)} className="rounded border border-[var(--ls-line)] p-1 text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]">
              <MoveDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              title="Delete"
              onClick={() => {
                commit({ ...scene, elements: scene.elements.filter((el) => !selection.includes(el.id)) });
                setSelection([]);
              }}
              className="rounded border border-red-300 p-1 text-red-500 hover:bg-red-50 dark:border-red-500/40 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-[var(--ls-line)] p-2" data-testid="dlayers">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">Layers (top first)</h3>
        <ul className="max-h-36 space-y-px overflow-y-auto">
          {[...scene.elements].reverse().map((el) => (
            <li key={el.id}>
              <button
                type="button"
                onClick={() => setSelection([el.id])}
                className={`w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] ${selection.includes(el.id) ? 'bg-[#4e68f5]/15 text-[var(--ls-text)]' : 'text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]'}`}
              >
                {el.kind === 'template' ? `template · ${getTemplate(el.templateId)?.name ?? el.templateId}` : el.kind}
                {'label' in el && el.label ? ` · ${el.label.slice(0, 22)}` : ''}
              </button>
            </li>
          ))}
          {scene.elements.length === 0 && <li className="px-1.5 text-[11px] text-[var(--ls-muted)]">empty — pick a tool and draw</li>}
        </ul>
      </section>

      <ParamsSection scene={scene} commit={commit} />

      <details className="rounded-lg border border-[var(--ls-line)] p-2" data-testid="dtikz-panel">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">Generated TikZ</summary>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] leading-snug text-[var(--ls-text)]" data-testid="dtikz-code">
          {tikz}
        </pre>
        <button type="button" className="mt-1 rounded border border-[var(--ls-line)] px-2 py-0.5 text-[11px] text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]" onClick={() => void navigator.clipboard.writeText(tikz)}>
          Copy
        </button>
      </details>

      <section className="rounded-lg border border-[var(--ls-line)] p-2" data-testid="dpreview">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">
          Typeset preview {preview.busy ? '· compiling…' : ''}
          {preview.png && <span className="ml-1 font-normal normal-case tracking-normal">— click to enlarge</span>}
        </h3>
        {preview.png ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL from the local snippet compiler
          <img
            src={preview.png}
            alt="typeset diagram"
            data-testid="dpreview-img"
            onClick={() => setPreviewExpanded(true)}
            className="mx-auto max-h-96 w-full cursor-zoom-in rounded bg-white object-contain p-1"
          />
        ) : preview.error ? (
          <p className="text-[11px] text-red-500">{preview.error}</p>
        ) : (
          <p className="text-[11px] text-[var(--ls-muted)]">Draw something — the export compiles through the real TeX engine.</p>
        )}
      </section>
      {previewExpanded && preview.png && (
        <div
          data-testid="dpreview-overlay"
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/70 p-8"
          onClick={() => setPreviewExpanded(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL from the local snippet compiler */}
          <img src={preview.png} alt="typeset diagram (enlarged)" className="max-h-[92vh] max-w-[94vw] rounded-lg bg-white p-4 shadow-2xl" />
        </div>
      )}

      {plotOut && (
        <section className="rounded-lg border border-[var(--ls-line)] p-2" data-testid="dplot-output">
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">GNUplot output (sandboxed)</h3>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10.5px] text-[var(--ls-text)]">{plotOut}</pre>
        </section>
      )}
    </div>
  );
}

/** Any template on the scene that draws against the shared 3D frame? */
function has3dTemplate(scene: DiagramScene): boolean {
  return scene.elements.some((el) => {
    if (el.kind !== 'template') return false;
    const t = getTemplate(el.templateId);
    return !!t && (t.requiredPackages.includes('tikz-3dplot') || /3d/i.test(t.category));
  });
}

/** Parameter inspector for a template element — edits re-render the canvas
 *  approximation AND the export/preview live (everything reads the scene). */
function TemplateFields({ el, updateSelected }: { el: TemplateElement; updateSelected: (patch: (e: DiagramElement) => DiagramElement) => void }) {
  const t = getTemplate(el.templateId);
  if (!t) return null;
  const set = (key: string, v: number | string | boolean) =>
    updateSelected((e) => ({ ...e, params: { ...(e as TemplateElement).params, [key]: v } }) as DiagramElement);
  const control = (p: TemplateParam) => {
    const v = el.params[p.key] ?? p.default;
    switch (p.type) {
      case 'number':
        return (
          <input
            type="number"
            data-testid={`dtemplate-param-${p.key}`}
            value={Number(v)}
            {...(p.min !== undefined ? { min: p.min } : {})}
            {...(p.max !== undefined ? { max: p.max } : {})}
            {...(p.step !== undefined ? { step: p.step } : {})}
            onChange={(e) => set(p.key, Number(e.target.value))}
            className={numInput}
          />
        );
      case 'boolean':
        return <input type="checkbox" data-testid={`dtemplate-param-${p.key}`} checked={Boolean(v)} onChange={(e) => set(p.key, e.target.checked)} />;
      case 'select':
        return (
          <select data-testid={`dtemplate-param-${p.key}`} value={String(v)} onChange={(e) => set(p.key, e.target.value)} className={`${numInput} w-24`}>
            {(p.options ?? []).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      default:
        return <input data-testid={`dtemplate-param-${p.key}`} value={String(v)} onChange={(e) => set(p.key, e.target.value)} className={`${numInput} w-28 text-left`} />;
    }
  };
  return (
    <section className="space-y-1.5 rounded-lg border border-[var(--ls-line)] p-2" data-testid="dtemplate-fields">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">{t.name}</h3>
      <p className="text-[10.5px] text-[var(--ls-muted)]">{t.description}</p>
      {t.params.map((p) => (
        <Field key={p.key} label={p.label}>
          {control(p)}
        </Field>
      ))}
      {t.requiredPackages.length > 0 && (
        <p className="text-[10px] text-[var(--ls-muted)]">
          Needs: {t.requiredPackages.map((r) => r.replace(/^lib:/, '\\usetikzlibrary ')).join(', ')} — offered for the preamble on export.
        </p>
      )}
    </section>
  );
}

function PlotFields({ el, updateSelected }: { el: PlotElement; updateSelected: (patch: (e: DiagramElement) => DiagramElement) => void }) {
  const setSrc = (src: PlotElement['source']) => updateSelected((e) => ({ ...e, source: src }) as DiagramElement);
  const setSet = (patch: Partial<PlotElement['settings']>) => updateSelected((e) => ({ ...e, settings: { ...(e as PlotElement).settings, ...patch } }) as DiagramElement);
  return (
    <div className="space-y-1.5 border-t border-[var(--ls-line)] pt-1.5" data-testid="dplot-fields">
      <Field label="Source">
        <select
          value={el.source.type}
          onChange={(e) => setSrc(e.target.value === 'function' ? { type: 'function', expr: 'sin(x)/x' } : { type: 'data', data: '0 0\n1 1\n2 4\n' })}
          className={`${numInput} w-20`}
        >
          <option value="function">function</option>
          <option value="data">data</option>
        </select>
      </Field>
      {el.source.type === 'function' ? (
        <input data-testid="dplot-expr" value={el.source.expr} onChange={(e) => setSrc({ type: 'function', expr: e.target.value })} className={`${textInput} font-mono text-[11px]`} placeholder="sin(x)/x" />
      ) : (
        <textarea value={el.source.data} onChange={(e) => setSrc({ type: 'data', data: e.target.value })} rows={3} className={`${textInput} resize-y font-mono text-[11px]`} placeholder="x y per line" />
      )}
      <Field label="x range">
        <input value={el.settings.xrange} onChange={(e) => setSet({ xrange: e.target.value })} className={`${numInput} w-24 text-left`} placeholder="[-10:10]" />
      </Field>
      <Field label="y range">
        <input value={el.settings.yrange} onChange={(e) => setSet({ yrange: e.target.value })} className={`${numInput} w-24 text-left`} placeholder="[] = auto" />
      </Field>
      <Field label="x label">
        <input value={el.settings.xlabel} onChange={(e) => setSet({ xlabel: e.target.value })} className={`${numInput} w-24 text-left`} />
      </Field>
      <Field label="y label">
        <input value={el.settings.ylabel} onChange={(e) => setSet({ ylabel: e.target.value })} className={`${numInput} w-24 text-left`} />
      </Field>
      <Field label="Style">
        <select value={el.settings.plotStyle} onChange={(e) => setSet({ plotStyle: e.target.value as PlotElement['settings']['plotStyle'] })} className={`${numInput} w-24`}>
          <option value="lines">lines</option>
          <option value="points">points</option>
          <option value="linespoints">linespoints</option>
        </select>
      </Field>
    </div>
  );
}

function ParamsSection({ scene, commit }: { scene: DiagramScene; commit: (s: DiagramScene) => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('1');
  const entries = Object.entries(scene.params);
  return (
    <details className="rounded-lg border border-[var(--ls-line)] p-2" data-testid="dparams">
      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-[var(--ls-muted)]">Parameters ({entries.length})</summary>
      <p className="mt-1 text-[10.5px] text-[var(--ls-muted)]">Named values exported as \def — reuse them from raw TikZ snippets.</p>
      {entries.map(([k, v]) => (
        <Field key={k} label={`\\${k}`}>
          <span className="flex items-center gap-1">
            <input type="number" step={0.1} value={v} onChange={(e) => commit({ ...scene, params: { ...scene.params, [k]: Number(e.target.value) } })} className={numInput} />
            <button
              type="button"
              className="text-[10px] text-red-400"
              onClick={() => {
                const next = { ...scene.params };
                delete next[k];
                commit({ ...scene, params: next });
              }}
            >
              ×
            </button>
          </span>
        </Field>
      ))}
      <div className="mt-1 flex gap-1">
        <input value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z]/g, ''))} placeholder="name" className={`${textInput} w-20`} />
        <input value={value} onChange={(e) => setValue(e.target.value)} className={numInput} />
        <button
          type="button"
          className="rounded border border-[var(--ls-line)] px-1.5 text-[11px] text-[var(--ls-muted)] hover:bg-[var(--ls-surface-muted)]"
          onClick={() => name && commit({ ...scene, params: { ...scene.params, [name]: Number(value) || 0 } })}
        >
          add
        </button>
      </div>
    </details>
  );
}
