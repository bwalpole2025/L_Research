import { test, expect, type Page, type Route } from '@playwright/test';

/** Hermetic "predict next" test: document-aware multi-line ghost block + accept. */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Proj', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE = { id: 'f1', projectId: 'p1', path: 'main.tex', encoding: 'utf8', updatedAt: NOW };
const CONTENT = '\\documentclass{article}\n\\begin{document}\n\\section{Method}\nWe study a ferrofluid.\n\\end{document}\n';

const PREDICTION = 'We now turn to the multiple-scales expansion of the governing equations.';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE, content: CONTENT });
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/document-model') {
      return json(route, { card: 'Macros: \\Bo=\\mathrm{Bo}\nAbout: a ferrofluid study', notationSymbols: ['\\Bo'], outline: [{ title: 'Method', level: 2 }], builtAt: NOW });
    }
    if (method === 'POST' && path === '/projects/p1/predict-next') return json(route, { prediction: PREDICTION, kind: 'prose' });
    if (method === 'POST' && path === '/projects/p1/complete') return json(route, { completion: '', latencyMs: 5, variant: 'warm', provider: 'agent-sdk', model: 'h' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('predict next renders a distinct multi-line ghost block and Tab accepts it', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click(); // focus + cursor

  await page.getByTestId('predict-next').click();
  const ghost = page.getByTestId('predict-block');
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText('multiple-scales expansion');

  await page.keyboard.press('Tab');
  await expect(page.getByTestId('predict-block')).toHaveCount(0); // ghost dismissed on accept
  await expect(page.locator('.cm-content')).toContainText('multiple-scales expansion'); // inserted
});

test('the document-aware toggle is shown and on by default', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('toggle-docaware')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('docmodel-refreshed')).toBeVisible();
});
