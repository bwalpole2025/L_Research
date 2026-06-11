import { test, expect, type Page, type Route } from '@playwright/test';

/** Hermetic Literature-library test: tree, upload-confirm, link, literature view, trash. */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Proj', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE = { id: 'f1', projectId: 'p1', path: 'main.tex', encoding: 'utf8', updatedAt: NOW };

const ITEM = {
  id: 'i1', projectId: 'p1', folderId: null, title: 'Cornish 2018 — Multiple scales', authors: 'Cornish', year: '2018',
  citeKey: null, fileName: 'cornish2018.pdf', fileSizeBytes: 21000, doi: null, abstract: null, hasText: true, extractedAt: NOW, addedAt: NOW,
};
const LIBRARY = { folders: [{ id: 'fA', projectId: 'p1', parentId: null, name: 'Topic A', createdAt: NOW }], items: [ITEM], trashCount: 1 };
const TRASH = { items: [{ id: 't1', kind: 'folder', label: 'Folder “ToDelete” (1 article(s))', deletedAt: NOW }] };

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
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE, content: 'x' });
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'GET' && path === '/projects/p1/library') return json(route, LIBRARY);
    if (method === 'GET' && path === '/projects/p1/library/cite-keys') return json(route, { keys: ['cornish2018', 'smith2021'] });
    if (method === 'GET' && path.startsWith('/projects/p1/library/search')) return json(route, { items: [ITEM] });
    if (method === 'POST' && path === '/projects/p1/library/items') return json(route, ITEM, 201);
    if (method === 'POST' && path === '/library/items/i1/link') return json(route, { ...ITEM, citeKey: 'cornish2018' });
    if (method === 'GET' && path === '/library/items/i1/pdf') return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4' });
    if (method === 'GET' && path === '/projects/p1/trash') return json(route, TRASH);
    if (method === 'POST' && /\/trash\/t1\/restore$/.test(path)) return json(route, { ok: true });
    if (method === 'DELETE' && path === '/projects/p1/trash') return json(route, { removed: 1 });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('library: tree, upload-confirm, cite-key link, literature view, trash restore + 2-step empty', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('left-tab-literature').click();
  await expect(page.getByTestId('library-panel')).toBeVisible();
  await expect(page.getByText('Cornish 2018 — Multiple scales')).toBeVisible();
  await expect(page.getByText('Topic A')).toBeVisible();
  await expect(page.getByText('unlinked')).toBeVisible();

  // Upload → confirm dialog shows name + size.
  await page.getByTestId('lib-file-input').setInputFiles({ name: 'paper.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 hello') });
  await expect(page.getByText('Add 1 PDF(s) to the library?')).toBeVisible();
  await expect(page.getByText('paper.pdf')).toBeVisible();
  await page.getByTestId('upload-confirm').click();
  await expect(page.getByText('Add 1 PDF(s) to the library?')).toHaveCount(0);

  // Open the metadata editor and link to a cite key.
  await page.getByText('Cornish 2018 — Multiple scales').hover();
  await page.getByRole('button', { name: 'Edit metadata' }).first().click();
  await page.getByTestId('link-citekey').selectOption('cornish2018');

  // Click the article → Literature view in the PDF pane.
  await page.getByText('Cornish 2018 — Multiple scales').click();
  await expect(page.getByTestId('pdf-back-clean')).toBeVisible();

  // Trash: restore an entry, then empty requires a second confirm.
  await page.getByTestId('lib-trash').click();
  await expect(page.getByText('Folder “ToDelete” (1 article(s))')).toBeVisible();
  await expect(page.getByTestId('trash-restore')).toBeVisible();
  await page.getByTestId('trash-empty').click();
  await expect(page.getByTestId('trash-empty-confirm')).toBeVisible(); // second confirm
  await page.getByTestId('trash-empty-confirm').click();
});
