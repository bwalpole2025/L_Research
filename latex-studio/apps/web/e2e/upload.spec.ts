import { test, expect, type Page, type Route } from '@playwright/test';

/** Hermetic upload test: a text file and a binary image, with preview. */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Proj', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const MAIN = { id: 'f1', projectId: 'p1', path: 'main.tex', encoding: 'utf8', updatedAt: NOW };
// 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  const created: Array<{ id: string; path: string; content: string; encoding: string }> = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();

    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'GET' && path === '/projects/p1/files') {
      return json(route, [MAIN, ...created.map((c) => ({ id: c.id, projectId: 'p1', path: c.path, encoding: c.encoding, updatedAt: NOW }))]);
    }
    if (method === 'POST' && path === '/projects/p1/files') {
      const body = route.request().postDataJSON() as { path: string; content?: string; encoding?: string };
      const f = { id: `u${created.length + 1}`, path: body.path, content: body.content ?? '', encoding: body.encoding ?? 'utf8' };
      created.push(f);
      return json(route, { id: f.id, projectId: 'p1', path: f.path, content: f.content, encoding: f.encoding, updatedAt: NOW }, 201);
    }
    const fileGet = /^\/files\/(\w+)$/.exec(path);
    if (method === 'GET' && fileGet) {
      if (fileGet[1] === 'f1') return json(route, { ...MAIN, content: '\\documentclass{article}\n' });
      const c = created.find((x) => x.id === fileGet[1]);
      if (c) return json(route, { id: c.id, projectId: 'p1', path: c.path, content: c.content, encoding: c.encoding, updatedAt: NOW });
    }
    if (method === 'PATCH' && /^\/files\/\w+$/.test(path)) return json(route, { content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('uploads a text .bib file and it appears in the tree', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('file-upload-input').setInputFiles({
    name: 'refs.bib',
    mimeType: 'text/x-bibtex',
    buffer: Buffer.from('@article{cornish2018, title={X}}'),
  });

  await expect(page.getByTestId('file-refs.bib')).toBeVisible();
});

test('uploads a PNG and shows the binary image preview', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('file-upload-input').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_B64, 'base64'),
  });

  await expect(page.getByTestId('file-logo.png')).toBeVisible();
  // The uploaded image opens in the read-only binary preview.
  await expect(page.locator('img[alt="logo.png"]')).toBeVisible();
});
