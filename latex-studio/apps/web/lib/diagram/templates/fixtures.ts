import { DEFAULT_STYLE, emptyScene, type DiagramScene, type TemplateElement } from '../model';
import { sceneRequirements, sceneToTikz } from '../tikz';
import { TEMPLATES, templateDefaults } from './catalog';

/**
 * LIVE-COMPILE FIXTURES for the template catalogue, generated from the REAL
 * registry + exporter (no hand-copied TikZ that could drift). The web unit
 * suite snapshots the output into apps/api/test/fixtures/, and the api live
 * suite compiles every fixture through the actual TeX engine — so each
 * template's exportLatex is proven against texlive, not eyeballed.
 */

export interface TemplateFixture {
  name: string;
  /** tikzpicture (with any \tdplotsetmaincoords header), as the preview compiles it. */
  picture: string;
  packages: string[];
  libraries: string[];
}

function sceneOf(ids: string[], view3d = { theta: 70, phi: 110 }): DiagramScene {
  const elements = ids.map((id, i): TemplateElement => {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t) throw new Error(`unknown template id "${id}"`);
    // Spread along x so nothing overlaps; placement never affects compilability.
    return { id: `t${i}`, kind: 'template', templateId: id, x: i * 480, y: 0, params: templateDefaults(t), style: { ...DEFAULT_STYLE } };
  });
  return { ...emptyScene(), view3d, elements };
}

function fixture(name: string, scene: DiagramScene): TemplateFixture {
  const { packages, libraries } = sceneRequirements(scene);
  return { name, picture: sceneToTikz(scene).picture, packages, libraries };
}

export function buildTemplateFixtures(): TemplateFixture[] {
  const byCategory = new Map<string, string[]>();
  for (const t of TEMPLATES) byCategory.set(t.category, [...(byCategory.get(t.category) ?? []), t.id]);
  const out: TemplateFixture[] = [];
  // One scene per category = EVERY template in the registry compiles at its defaults.
  for (const [cat, ids] of byCategory) out.push(fixture(`category: ${cat}`, sceneOf(ids)));
  // The shared-frame acceptance case: 3D axes + solids on ONE custom view angle.
  out.push(fixture('shared 3D frame: axes-3d + sphere + cone at theta=60 phi=130', sceneOf(['axes-3d', 'sphere', 'cone'], { theta: 60, phi: 130 })));
  return out;
}
