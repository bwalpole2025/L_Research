import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Hermetic ghost-text test: mocks /complete, types to trigger a suggestion, then
 * exercises Tab (accept) and Esc (dismiss).
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = {
  id: 'p1',
  name: 'Demo',
  rootFile: 'main.tex',
  createdAt: NOW,
  updatedAt: NOW,
  model: 'claude-sonnet-4-6',
  aiInstructions: '',
};
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const FILE = { ...FILE_META, content: '\\documentclass{article}\n\\begin{document}\nPLACEHOLDER\n\\end{document}\n' };
const GHOST = 'GHOST_TEXT';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, FILE);
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/complete') {
      return json(route, { completion: GHOST, latencyMs: 40, variant: 'warm', provider: 'agent-sdk', model: 'claude-haiku-4-5' });
    }
    if (method === 'PATCH' && path === '/files/f1') return json(route, { ...FILE, content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

async function triggerGhost(page: Page) {
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End'); // move to a stable position in the body
  await page.keyboard.type('a'); // one keystroke → debounced completion request
  await expect(page.locator('.cm-ghost')).toBeVisible();
}

test('Tab accepts the ghost suggestion', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await triggerGhost(page);

  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toContainText(GHOST);
});

test('Esc dismisses the ghost suggestion without inserting', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await triggerGhost(page);

  await page.keyboard.press('Escape');
  await expect(page.locator('.cm-ghost')).toHaveCount(0);
  await expect(page.locator('.cm-content')).not.toContainText(GHOST);
});

test('a wrong align step gets the amber verification underline', async ({ page }) => {
  const ALIGN =
    '\\documentclass{article}\n\\begin{document}\n\\begin{align}\nx &= 2(y+1) \\\\\nx &= CURSORHERE\n\\end{align}\n\\end{document}\n';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: ALIGN });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/complete') {
      return json(route, { completion: '2y', latencyMs: 40, variant: 'warm', provider: 'agent-sdk', model: 'h' });
    }
    if (method === 'POST' && path === '/mathcheck/equivalent') {
      return json(route, { equivalent: false, method: 'sample', counterexample: { values: { y: 1 }, lhsVal: 4, rhsVal: 2 } });
    }
    if (method === 'PATCH' && path === '/files/f1') return json(route, { ...FILE_META, content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });

  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByText('CURSORHERE').click();
  await page.keyboard.press('End'); // end of the in-progress align step (display-align mode)
  await page.keyboard.type(' ');
  await expect(page.locator('.cm-ghost')).toBeVisible();
  await page.keyboard.press('Tab'); // accept → fires the fire-and-forget math check

  await expect(page.locator('.cm-warn-underline')).toBeVisible();
});
