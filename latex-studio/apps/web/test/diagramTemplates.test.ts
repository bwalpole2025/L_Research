import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE, bbox, emptyScene, type DiagramScene, type TemplateElement } from '../lib/diagram/model';
import { sceneRequirements, sceneToTikz } from '../lib/diagram/tikz';
import { TEMPLATES, collectRequirements, getTemplate, templateDefaults } from '../lib/diagram/templates/catalog';
import { buildTemplateFixtures } from '../lib/diagram/templates/fixtures';
import { missingPreambleLines, patchPreamble } from '../components/diagram/TikzDiagramEditor';
import type { TemplateCtx } from '../lib/diagram/templates/types';

const ctx: TemplateCtx = { view3d: { theta: 70, phi: 110 }, scale: 40 };

const templateEl = (templateId: string, x = 0, y = 0, params?: Record<string, number | string | boolean>): TemplateElement => {
  const t = getTemplate(templateId);
  if (!t) throw new Error(`unknown template ${templateId}`);
  return { id: `el-${templateId}`, kind: 'template', templateId, x, y, params: { ...templateDefaults(t), ...params }, style: { ...DEFAULT_STYLE } };
};

const sceneWith = (...els: TemplateElement[]): DiagramScene => ({ ...emptyScene(), elements: els });

describe('template registry', () => {
  it('ids are unique, categories non-empty, params self-consistent', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.category.length, t.id).toBeGreaterThan(0);
      expect(t.name.length, t.id).toBeGreaterThan(0);
      const keys = t.params.map((p) => p.key);
      expect(new Set(keys).size, `${t.id} param keys`).toBe(keys.length);
      for (const p of t.params) {
        const want = p.type === 'number' ? 'number' : p.type === 'boolean' ? 'boolean' : 'string';
        expect(typeof p.default, `${t.id}.${p.key} default`).toBe(want);
        if (p.type === 'select') expect(p.options, `${t.id}.${p.key} options`).toContain(p.default);
      }
    }
  });

  it('every template exports sane TikZ and a positive canvas footprint at its defaults', () => {
    for (const t of TEMPLATES) {
      const p = templateDefaults(t);
      const lines = t.exportLatex(p, ctx);
      expect(lines.length, t.id).toBeGreaterThan(0);
      const joined = lines.join('\n');
      expect(joined, t.id).not.toMatch(/NaN|undefined|\[object/);
      // Braces balance — a truncated body would abort the whole figure.
      const open = (joined.match(/\{/g) ?? []).length;
      const close = (joined.match(/\}/g) ?? []).length;
      expect(open, `${t.id} braces`).toBe(close);
      const { w, h } = t.size(p, ctx);
      expect(w, t.id).toBeGreaterThan(0);
      expect(h, t.id).toBeGreaterThan(0);
      expect(() => t.renderCanvas(p, ctx), t.id).not.toThrow();
    }
  });

  it('requirements collect + dedupe across templates, splitting lib: entries', () => {
    expect(collectRequirements(['sphere'])).toEqual({ packages: ['tikz-3dplot'], libraries: [] });
    expect(collectRequirements(['sine-wave', 'cylinder'])).toEqual({ packages: ['pgfplots'], libraries: [] });
    expect(collectRequirements(['wavy-line', 'coil'])).toEqual({ packages: [], libraries: ['decorations.pathmorphing'] });
    expect(collectRequirements(['venn-2', 'circle'])).toEqual({ packages: [], libraries: [] });
    const r = collectRequirements(['region-between-curves']);
    expect(r.packages).toContain('pgfplots');
    expect(r.libraries).toContain('fillbetween');
  });
});

describe('template elements in the scene export', () => {
  it('a template is placed via a shift scope at its canvas position (cm, y flipped)', () => {
    const { picture } = sceneToTikz(sceneWith(templateEl('circle', 80, -40)));
    expect(picture).toContain('\\begin{scope}[shift={(2,1)}]');
    expect(picture).toContain('\\end{scope}');
  });

  it('\\tdplotsetmaincoords is emitted ONCE, before the picture, only when a 3D-plot template is present', () => {
    const flat = sceneToTikz(sceneWith(templateEl('venn-2'), templateEl('sine-wave', 480)));
    expect(flat.picture).not.toContain('tdplotsetmaincoords');

    const s = { ...sceneWith(templateEl('sphere'), templateEl('axes-3d', 480)), view3d: { theta: 60, phi: 130 } };
    const solid = sceneToTikz(s);
    expect(solid.picture.match(/tdplotsetmaincoords/g)).toHaveLength(1);
    expect(solid.picture.startsWith('\\tdplotsetmaincoords{60}{130}\n\\begin{tikzpicture}')).toBe(true);
  });

  it('sceneRequirements unions requirements over template elements only', () => {
    const reqs = sceneRequirements(sceneWith(templateEl('sphere'), templateEl('region-between-curves', 480), templateEl('brace', 960)));
    expect(reqs.packages.sort()).toEqual(['pgfplots', 'tikz-3dplot']);
    expect(reqs.libraries.sort()).toEqual(['decorations.pathreplacing', 'fillbetween']);
  });

  it('the export prelude documents the preamble requirements as comments (bodies cannot \\usepackage)', () => {
    const { code } = sceneToTikz(sceneWith(templateEl('cone')));
    expect(code).toContain('% requires in the preamble:');
    expect(code).toContain('%   \\usepackage{pgfplots}  +  \\pgfplotsset{compat=newest}');
  });

  it('param edits change the export (live re-render path) and bbox respects size()', () => {
    const small = sceneToTikz(sceneWith(templateEl('circle', 0, 0, { r: 1 }))).picture;
    const big = sceneToTikz(sceneWith(templateEl('circle', 0, 0, { r: 2.5 }))).picture;
    expect(small).not.toBe(big);
    expect(big).toContain('2.5');
    const b1 = bbox(templateEl('circle', 0, 0, { r: 1 }));
    const b2 = bbox(templateEl('circle', 0, 0, { r: 2.5 }));
    expect(b2.w).toBeGreaterThan(b1.w);
  });
});

describe('preamble diff-and-accept (never silent)', () => {
  const reqs = { packages: ['pgfplots', 'tikz-3dplot'], libraries: ['decorations.pathmorphing', 'fillbetween'] };

  it('reports exactly the missing lines, seeing through options and comma lists', () => {
    const doc = '\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\usepackage{amsmath,pgfplots}\n\\pgfplotsset{compat=newest}\n\\usetikzlibrary{decorations.pathmorphing}\n\\begin{document}x\\end{document}';
    // fillbetween is a pgfplots library — the \usetikzlibrary form half-loads,
    // so the offer must use \usepgfplotslibrary.
    expect(missingPreambleLines(doc, reqs)).toEqual(['\\usepackage{tikz-3dplot}', '\\usepgfplotslibrary{fillbetween}']);
  });

  it('pgfplots without a compat setting still gets \\pgfplotsset offered', () => {
    const doc = '\\documentclass{article}\n\\usepackage{pgfplots}\n\\begin{document}x\\end{document}';
    expect(missingPreambleLines(doc, { packages: ['pgfplots'], libraries: [] })).toEqual(['\\pgfplotsset{compat=newest}']);
  });

  it('nothing missing → no offer', () => {
    const doc = '\\documentclass{article}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=newest}\n\\usepackage{tikz-3dplot}\n\\usetikzlibrary{decorations.pathmorphing}\n\\usepgfplotslibrary{fillbetween}\nx';
    expect(missingPreambleLines(doc, reqs)).toEqual([]);
  });

  it('patches after the last \\usepackage, or after \\documentclass when there are none', () => {
    const doc = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}x\\end{document}';
    const patched = patchPreamble(doc, ['\\usepackage{pgfplots}', '\\pgfplotsset{compat=newest}']);
    expect(patched).toBe('\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{pgfplots}\n\\pgfplotsset{compat=newest}\n\\begin{document}x\\end{document}');

    const bare = '\\documentclass{article}\n\\begin{document}x\\end{document}';
    expect(patchPreamble(bare, ['\\usepackage{tikz-3dplot}'])).toBe('\\documentclass{article}\n\\usepackage{tikz-3dplot}\n\\begin{document}x\\end{document}');
  });
});

describe('live-compile fixtures for the api suite', () => {
  it('cover every template and stay in sync with apps/api/test/fixtures (rerun with -u after catalogue changes)', async () => {
    const fixtures = buildTemplateFixtures();
    // Every registry template appears in exactly one category fixture.
    const all = fixtures.map((f) => f.picture).join('\n');
    for (const t of TEMPLATES) expect(all, t.id).toContain(`% template: ${t.name}`);
    await expect(JSON.stringify(fixtures, null, 2)).toMatchFileSnapshot('../../api/test/fixtures/template-acceptance.json');
  });
});
