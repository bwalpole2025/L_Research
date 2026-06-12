import { describe, expect, it } from 'vitest';
import {
  emptyScene,
  newId,
  borderPoint,
  edgeEnds,
  translated,
  type DiagramScene,
  type NodeElement,
  type EdgeElement,
  DEFAULT_STYLE,
} from '../lib/diagram/model';
import { sceneToTikz, tikzExportPath, inputSnippet } from '../lib/diagram/tikz';

const node = (id: string, x: number, y: number, label = '', shape: NodeElement['shape'] = 'rect'): NodeElement => ({
  id, kind: 'node', x, y, w: 80, h: 40, shape, label, style: { ...DEFAULT_STYLE },
});

describe('scene → TikZ export', () => {
  it('a flowchart: named nodes with maths labels and an anchored arrow between them', () => {
    const s: DiagramScene = { ...emptyScene(), elements: [
      node('a', 40, 40, '$A$'),
      node('b', 240, 40, '$B \\otimes C$', 'circle'),
      { id: 'e', kind: 'edge', from: { node: 'a' }, to: { node: 'b' }, arrowHead: 'stealth', bend: 0, label: '$f$', labelPos: 'above', style: { ...DEFAULT_STYLE } } as EdgeElement,
    ]};
    const { code, picture } = sceneToTikz(s, 'flow.diagram.json');
    expect(picture).toContain('\\node');
    expect(picture).toContain('(n1) at (1,-1) {$A$}');             // 40px → 1cm, y flipped
    expect(picture).toContain('circle');
    expect(picture).toContain('(n2) at (6,-1) {$B \\otimes C$}');
    expect(picture).toContain('\\draw[-stealth');
    expect(picture).toContain('(n1) -- (n2)');                      // edges by NAME → TikZ reflows
    expect(picture).toContain('node[midway, above] {$f$}');
    expect(code).toContain('source of truth');                      // documented regeneration
  });

  it('styles map to TikZ options: dash, width, fill colour (definecolor), opacity, bend', () => {
    const s: DiagramScene = { ...emptyScene(), elements: [
      { id: 'r', kind: 'rect', x: 0, y: 0, w: 80, h: 40, style: { stroke: '#1a2b3c', strokeWidth: 2, dash: 'dashed', fill: '#aabbcc', opacity: 0.5 } },
      node('a', 0, 100), node('b', 200, 100),
      { id: 'e', kind: 'edge', from: { node: 'a' }, to: { node: 'b' }, arrowHead: 'arrow', bend: 30, label: '', labelPos: 'above', style: { ...DEFAULT_STYLE, dash: 'dotted' } } as EdgeElement,
    ]};
    const { code } = sceneToTikz(s);
    expect(code).toContain('{HTML}{1A2B3C}');
    expect(code).toContain('{HTML}{AABBCC}');
    expect(code).toMatch(/fill=lsColor\d/);
    expect(code).toContain('dashed');
    expect(code).toContain('line width=2pt');
        expect(code).toContain('opacity=0.5');
    expect(code).toContain('to[bend left=30]');
    expect(code).toContain('dotted');
    expect(code).toContain('rectangle');
  });

  it('paths, polygons, text and free-point edges export with cm coordinates', () => {
    const s: DiagramScene = { ...emptyScene(), elements: [
      { id: 'p', kind: 'path', points: [{ x: 0, y: 0 }, { x: 40, y: -40 }, { x: 80, y: 0 }], smooth: true, closed: false, style: { ...DEFAULT_STYLE } },
      { id: 'g', kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: -80 }], style: { ...DEFAULT_STYLE } },
      { id: 't', kind: 'text', x: 40, y: 80, label: '$\\eta(x,t)$', style: { ...DEFAULT_STYLE } },
      { id: 'e', kind: 'edge', from: { x: 0, y: 0 }, to: { x: 80, y: 80 }, arrowHead: 'latex', bend: 0, label: '', labelPos: 'above', style: { ...DEFAULT_STYLE } } as EdgeElement,
    ]};
    const { picture } = sceneToTikz(s);
    expect(picture).toContain('plot[smooth] coordinates {(0,0) (1,1) (2,0)}');
    expect(picture).toContain('(0,0) -- (2,0) -- (1,2) -- cycle');
    expect(picture).toContain('{$\\eta(x,t)$}');
    expect(picture).toMatch(/\\draw\[-latex[^\]]*\] \(0,0\) -- \(2,-2\);/);
  });

  it('raw-tikz passes through VERBATIM and params export as \\def', () => {
    const s: DiagramScene = { ...emptyScene(), params: { gap: 1.5 }, elements: [
      { id: 'raw', kind: 'raw-tikz', x: 0, y: 0, w: 100, h: 60, code: '\\draw[red!50] (0,0) circle (\\gap);', style: { ...DEFAULT_STYLE } },
    ]};
    const { picture } = sceneToTikz(s);
    expect(picture).toContain('\\def\\gap{1.5}');
    expect(picture).toContain('\\draw[red!50] (0,0) circle (\\gap);');
    expect(picture).toContain('opaque');
  });

  it('export path + \\input snippet', () => {
    expect(tikzExportPath('figs/wave.diagram.json')).toBe('diagrams/wave.tikz');
    expect(inputSnippet('wave.diagram.json')).toBe('\\input{diagrams/wave.tikz}');
  });
});

describe('edge anchoring (canvas mirror of TikZ behaviour)', () => {
  it('edges attach to node borders and REFLOW when a node moves', () => {
    const a = node('a', 0, 0);
    const b = node('b', 200, 0);
    const s: DiagramScene = { ...emptyScene(), elements: [a, b,
      { id: 'e', kind: 'edge', from: { node: 'a' }, to: { node: 'b' }, arrowHead: 'arrow', bend: 0, label: '', labelPos: 'above', style: { ...DEFAULT_STYLE } } as EdgeElement,
    ]};
    const before = edgeEnds(s, s.elements[2] as EdgeElement);
    expect(before.a.x).toBe(40);  // right border of a (w=80 → half-width 40)
    expect(before.b.x).toBe(160); // left border of b

    // Move node b down — the edge endpoints follow the borders.
    const moved = { ...s, elements: [a, translated(b, 0, 150), s.elements[2]!] };
    const after = edgeEnds(moved as DiagramScene, s.elements[2] as EdgeElement);
    expect(after.b.y).toBeGreaterThan(before.b.y); // reflowed
    expect(after.a.y).toBeGreaterThan(0);          // departure angle changed too
  });

  it('circle borders use the ellipse intersection', () => {
    const c = node('c', 0, 0, '', 'circle');
    const p = borderPoint(c, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(40);
    expect(p.y).toBeCloseTo(0);
  });

  it('ids are unique', () => {
    expect(newId()).not.toBe(newId());
  });
});
