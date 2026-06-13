import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * TikZ diagram editor acceptance: draw nodes + edge with maths labels on the
 * canvas, see KaTeX render live, get clean editable TikZ; styling changes and
 * precise-coordinate edits reflect in the export; node moves reflow edges;
 * raw-tikz passes through; export writes diagrams/<name>.tikz; GNUplot runs
 * surface output and embed a preview.
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
  gnuplotCalls: number;
}

async function mockApi(page: Page, cap: Captured) {
  await page.addInitScript(() => {
    window.localStorage.setItem('latex-studio:compileOnSave', 'false');
    window.localStorage.setItem('latex-studio:tour:compile', 'seen'); // the one-time tour never overlays tests
    // Wide centre pane so the diagram canvas has room for the test clicks.
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
      return json(route, { pngBase64: PNG64, width: 200, height: 120, cached: false });
    }
    if (method === 'POST' && path === '/projects/p1/gnuplot') {
      cap.gnuplotCalls += 1;
      return json(route, { ok: true, base: 'plot-test', stdout: 'gnuplot ok\n', stderr: '', previewPng: PNG64 });
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

async function openDiagram(page: Page) {
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  // A .diagram.json never opens as a JSON pane — clicking it routes to the
  // full-page maths diagram editor.
  await page.getByTestId('file-wave.diagram.json').click();
  await page.waitForURL(/\/math-diagram/);
  await expect(page.getByTestId('tikz-diagram-editor')).toBeVisible();
}

test('a .diagram.json never opens as a JSON pane: clicking it routes to the full-page editor', async ({ page }) => {
  const cap: Captured = { writes: [], gnuplotCalls: 0 };
  await mockApi(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  // Clicking the diagram file navigates away from the studio pane to its own page —
  // it is never rendered as an embedded JSON pane in the studio.
  await page.getByTestId('file-wave.diagram.json').click();
  await page.waitForURL(/\/math-diagram/);
  await expect(page).toHaveURL(/file=wave\.diagram\.json/);
  await expect(page.getByTestId('tikz-diagram-editor')).toBeVisible();
});

test('if a diagram tab is active in the studio, the pane shows a card (not the embedded editor) linking to its page', async ({ page }) => {
  const cap: Captured = { writes: [], gnuplotCalls: 0 };
  await mockApi(page, cap);
  // Prime the saved layout so the diagram is the active tab when the studio loads.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'latex-studio:layout:p1',
      JSON.stringify({ openFileIds: ['f1', 'f9'], activeFileId: 'f9', cursors: {} }),
    );
  });
  await page.goto('/studio');

  // The editor pane shows the card, never the embedded TikZ editor.
  await expect(page.getByTestId('open-diagram-page')).toBeVisible();
  await expect(page.getByTestId('tikz-diagram-editor')).toHaveCount(0);

  // The card's button opens the full-page editor.
  await page.getByTestId('open-diagram-page').click();
  await page.waitForURL(/\/math-diagram/);
  await expect(page.getByTestId('tikz-diagram-editor')).toBeVisible();
});

test('flowchart: nodes with maths labels render via KaTeX, edge anchors + reflows, clean TikZ exports', async ({ page }) => {
  const cap: Captured = { writes: [], gnuplotCalls: 0 };
  await mockApi(page, cap);
  await openDiagram(page);
  const canvas = page.getByTestId('diagram-canvas');

  // Two nodes (click placement snaps to grid; view offset is +40,+40).
  await page.getByTestId('dtool-node').click();
  await canvas.click({ position: { x: 140, y: 140 } }); // world (100,100)
  await page.getByTestId('dtool-node').click();
  await canvas.click({ position: { x: 380, y: 140 } }); // world (340,100)
  await expect(page.locator('[data-testid="dnode"]')).toHaveCount(2);

  // Maths label on the second node, rendered in-canvas by KaTeX.
  await page.getByTestId('dlabel-input').fill('$B \\otimes C$');
  await expect(canvas.locator('.katex').first()).toBeVisible();

  // Edge: drag node → node; it appears and the export uses NODE NAMES.
  await page.getByTestId('dtool-edge').click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 140, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 380, box.y + 140, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-testid="dedge"]')).toHaveCount(1);

  // Generated TikZ: named nodes, edge by name, maths label exported as $…$.
  await page.getByTestId('dtikz-panel').locator('summary').click();
  const code = page.getByTestId('dtikz-code');
  await expect(code).toContainText('\\node');
  await expect(code).toContainText('(n1)');
  await expect(code).toContainText('{$B \\otimes C$}');
  await expect(code).toContainText('(n1) -- (n2)');

  // Styling: dashed + latex arrowhead reflect in the export.
  await page.getByTestId('dstyle-dash').selectOption('dashed');
  await page.getByTestId('dstyle-arrow').selectOption('latex');
  await expect(code).toContainText('dashed');
  await expect(code).toContainText('-latex');

  // Edge reflow: select node 1, move it precisely via the inspector → the
  // edge follows (export coordinates of n1 change, edge stays by-name).
  await page.getByTestId('dtool-select').click();
  await canvas.click({ position: { x: 140, y: 140 } }); // node 1
  await page.getByTestId('dinspect-y').fill('220');
  await expect(code).toContainText('at (2.5,-5.5)'); // 100px→2.5cm, 220px→-5.5cm
  await expect(code).toContainText('(n1) -- (n2)'); // still anchored by name

  // The typeset preview compiled through the (mocked) TeX engine.
  await expect(page.getByTestId('dpreview').locator('img')).toBeVisible();

  // Export writes diagrams/wave.tikz with the generated code.
  await page.getByTestId('dexport-tikz').click();
  await expect(page.getByTestId('diagram-notice')).toContainText('diagrams/wave.tikz');
  const written = cap.writes.find((w) => w.path === 'diagrams/wave.tikz');
  expect(written?.content).toContain('\\begin{tikzpicture}');
  expect(written?.content).toContain('(n1) -- (n2)');
});

test('raw-tikz passes through verbatim; undo restores; GNUplot run surfaces output + preview', async ({ page }) => {
  const cap: Captured = { writes: [], gnuplotCalls: 0 };
  await mockApi(page, cap);
  await openDiagram(page);
  const canvas = page.getByTestId('diagram-canvas');

  // Raw TikZ element (drag a placeholder box, then edit its code).
  await page.getByTestId('dtool-raw-tikz').click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 320);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 420, { steps: 3 });
  await page.mouse.up();
  await page.getByTestId('draw-tikz-code').fill('\\draw[red] (0,0) sin (1,1);');
  await page.getByTestId('dtikz-panel').locator('summary').click();
  await expect(page.getByTestId('dtikz-code')).toContainText('\\draw[red] (0,0) sin (1,1);');

  // Undo removes the raw element from the export.
  await page.getByTestId('dundo').click(); // undo code edit
  await page.getByTestId('dundo').click(); // undo creation
  await expect(page.getByTestId('dtikz-code')).not.toContainText('sin (1,1)');

  // GNUplot: place a plot, run, see output + canvas preview image.
  await page.getByTestId('dtool-plot').click();
  await page.mouse.move(box.x + 120, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 320, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId('dplot-fields')).toBeVisible();
  await page.getByTestId('drun-plots').click();
  await expect(page.getByTestId('dplot-output')).toContainText('gnuplot ok');
  expect(cap.gnuplotCalls).toBe(1);
  await expect(canvas.locator('image')).toHaveCount(1); // preview embedded on canvas
  // The export now references the generated cairolatex overlay.
  await expect(page.getByTestId('dtikz-code')).toContainText('diagrams/plots/plot-test.tex');
});
