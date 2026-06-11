import { test, expect, type Route } from '@playwright/test';

/**
 * Hermetic editor smoke test: mocks the /api proxy, opens the editor, types into
 * a file, and asserts the save indicator cycles dirty → saving → saved.
 */

const NOW = '2024-01-01T00:00:00.000Z';

const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const FILE = { ...FILE_META, content: '\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n' };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

test('save indicator cycles dirty → saving → saved while editing', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();

    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, FILE);

    if (method === 'PATCH' && path === '/files/f1') {
      // Delay so the "saving" state is observable.
      await new Promise((r) => setTimeout(r, 500));
      return json(route, { ...FILE, updatedAt: NOW });
    }

    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });

  await page.goto('/');

  // The app auto-opens the root file; wait for the editor to be ready.
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();

  const indicator = page.getByTestId('save-indicator');
  await expect(indicator).toHaveAttribute('data-status', 'saved');

  // Type into the document.
  await editor.click();
  await page.keyboard.type('Hello, LaTeX Studio!');

  // The indicator must pass through each state.
  await expect(indicator).toHaveAttribute('data-status', 'dirty');
  await expect(indicator).toHaveAttribute('data-status', 'saving');
  await expect(indicator).toHaveAttribute('data-status', 'saved');
});
