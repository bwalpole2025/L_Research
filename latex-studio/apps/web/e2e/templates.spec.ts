import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Template objects acceptance (UI): open the palette, insert a sphere, tune a
 * parameter and the shared 3D view in the inspector (live re-render into the
 * TikZ panel), then export — the preamble offer lists the EXACT missing lines
 * and only patches the root file after explicit accept.
 */

test.use({ viewport: { width: 1700, height: 950 } });

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '' };
const FILES = [
  { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW },
  { id: 'f9', projectId: 'p1', path: 'wave.diagram.json', updatedAt: NOW },
];
const MAIN = '\\documentclass{article}\n\\begin{document}\nBODY\n\\end{document}';
const PNG64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAI/AL+Xt1WqAAAAABJRU5ErkJggg==';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface Captured {
  writes: Array<{ path?: string; content: string }>;
  snippetPackages: string[][];
}

async function mockApi(page: Page, cap: Captured) {
  await page.addInitScript(() => {
    window.localStorage.setItem('latex-studio:compileOnSave', 'false');
    window.localStorage.setItem('latex-studio:tour:compile', 'seen');
    window.localStorage.setItem('react-resizable-panels:latex-studio:panels', JSON.stringify({ expandToSizes: {}, layout: [12, 70, 18] }));
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, FILES);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILES[0], content: MAIN });
    if (method === 'GET' && path === '/files/f9') return json(route, { ...FILES[1], content: '' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/render-snippet') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { packages?: string[] };
      cap.snippetPackages.push(body.packages ?? []);
      return json(route, { pngBase64: PNG64, width: 200, height: 120, cached: false });
    }
    if (method === 'POST' && path === '/projects/p1/files') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { path: string; content: string };
      cap.writes.push(body);
      return json(route, { id: `new-${cap.writes.length}`, projectId: 'p1', path: body.path, updatedAt: NOW }, 201);
    }
    if (method === 'PATCH' && path.startsWith('/files/')) {
      const body = JSON.parse(route.request().postData() ?? '{}') as { content: string };
      cap.writes.push(body);
      return json(route, { content: '' });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('palette insert → param + 3D view edits re-render → export offers exact preamble lines, accept patches the root', async ({ page }) => {
  const cap: Captured = { writes: [], snippetPackages: [] };
  await mockApi(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  // The diagram opens in its own full-page editor, not as a JSON pane.
  await page.getByTestId('file-wave.diagram.json').click();
  await page.waitForURL(/\/math-diagram/);
  await expect(page.getByTestId('tikz-diagram-editor')).toBeVisible();

  // Palette: open by default on the full page; categories + search, thumbnails insert.
  await expect(page.getByTestId('dpalette')).toBeVisible();
  await page.getByTestId('dpalette-search').fill('sphere');
  await page.getByTestId('dpalette-item-sphere').click();
  await expect(page.locator('[data-testid="dtemplate"]')).toHaveCount(1);

  // Inspector: template params render; editing one re-renders the export live.
  await expect(page.getByTestId('dtemplate-fields')).toBeVisible();
  await page.getByTestId('dtikz-panel').locator('summary').click();
  const code = page.getByTestId('dtikz-code');
  await expect(code).toContainText('% template: Sphere');
  await expect(code).toContainText('\\tdplotsetmaincoords{70}{110}');
  await page.getByTestId('dtemplate-param-r').fill('2.5');
  await expect(code).toContainText('circle (2.5)');

  // Shared 3D frame: θ edits flow into the single \tdplotsetmaincoords.
  await page.getByTestId('dview-theta').fill('60');
  await expect(code).toContainText('\\tdplotsetmaincoords{60}{110}');

  // The live preview asked the engine for the template's packages.
  await expect.poll(() => cap.snippetPackages.some((p) => p.includes('tikz-3dplot')), { timeout: 8000 }).toBe(true);

  // Export: the offer lists the EXACT missing line; nothing patched before accept.
  await page.getByTestId('dexport-tikz').click();
  await expect(page.getByTestId('dpreamble-offer')).toBeVisible();
  await expect(page.getByTestId('dpreamble-lines')).toContainText('\\usepackage{tikz-3dplot}');
  await page.getByTestId('dpreamble-accept').click();
  await expect(page.getByTestId('diagram-notice')).toContainText('diagrams/wave.tikz');
  const written = cap.writes.find((w) => w.path === 'diagrams/wave.tikz');
  expect(written?.content).toContain('\\tdplotsetmaincoords{60}{110}');
  expect(written?.content).toContain('% requires in the preamble:');

  // The accepted line landed in the root file (autosaved back to main.tex).
  await expect
    .poll(() => cap.writes.some((w) => w.content?.includes('\\usepackage{tikz-3dplot}')), { timeout: 5000 })
    .toBe(true);
});

test('a template needing nothing exports with NO preamble offer', async ({ page }) => {
  const cap: Captured = { writes: [], snippetPackages: [] };
  await mockApi(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('file-wave.diagram.json').click();
  await page.waitForURL(/\/math-diagram/);
  await expect(page.getByTestId('tikz-diagram-editor')).toBeVisible();

  await expect(page.getByTestId('dpalette')).toBeVisible();
  await page.getByTestId('dpalette-search').fill('venn');
  await page.getByTestId('dpalette-item-venn-2').click();
  await expect(page.locator('[data-testid="dtemplate"]')).toHaveCount(1);

  await page.getByTestId('dexport-tikz').click();
  await expect(page.getByTestId('diagram-notice')).toContainText('diagrams/wave.tikz');
  await expect(page.getByTestId('dpreamble-offer')).toHaveCount(0);
});
