import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Hermetic Cmd+K inline-edit test: mocks /api (including POST /edit), exercises
 * the selection → prompt → diff → Accept/Reject flow. Never auto-applies.
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
const ORIGINAL = '\\documentclass{article}\n\\begin{document}\nHello world.\n\\end{document}\n';
const FILE = { ...FILE_META, content: ORIGINAL };
const REPLACEMENT = 'REPLACED BY CLAUDE';

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
    if (method === 'GET' && path === '/ai/models')
      return json(route, { default: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'], live: false });
    if (method === 'POST' && path === '/projects/p1/edit') return json(route, { replacement: REPLACEMENT });
    if (method === 'PATCH' && path === '/files/f1') return json(route, { ...FILE, content: '' });

    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

/** Select the whole doc and open the Cmd+K prompt → generate → reach the diff. */
async function openDiff(page: Page) {
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a'); // select all
  await page.keyboard.press('ControlOrMeta+k'); // inline edit

  await page.getByLabel('Edit instruction').fill('rewrite this');
  await page.getByTestId('inline-edit-generate').click();

  await expect(page.getByTestId('diff-merge')).toBeVisible();
}

test('Cmd+K → Accept applies the replacement', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await openDiff(page);

  await page.getByTestId('diff-accept').click();

  const editor = page.locator('.cm-content');
  await expect(editor).toContainText(REPLACEMENT);
  await expect(editor).not.toContainText('Hello world');
});

test('Cmd+K → Reject leaves the document unchanged', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await openDiff(page);

  await page.getByTestId('diff-reject').click();

  const editor = page.locator('.cm-content');
  await expect(page.getByTestId('diff-merge')).toHaveCount(0);
  await expect(editor).toContainText('Hello world');
  await expect(editor).not.toContainText(REPLACEMENT);
});
