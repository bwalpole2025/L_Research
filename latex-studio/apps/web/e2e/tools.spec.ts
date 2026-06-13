import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Toolbar tools: the compile-mode chip on the status pill, the Word count dialog
 * and the Export (.zip) dialog with its include-PDF / include-literature options.
 */
const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '', texEngine: 'xelatex', draftMode: true, haltOnError: false };
const FILE = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mock(page: Page, cap: { exportUrls: string[] }) {
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE, content: 'x' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/compile') return json(route, { status: 'success', diagnostics: [], durationMs: 100, log: 'ok', pdfUrl: null });
    if (method === 'GET' && path === '/projects/p1/wordcount')
      return json(route, { total: { words: 1234, headers: 5, captions: 2 }, files: [{ file: 'main.tex', words: 1234, headers: 5, captions: 2 }] });
    if (method === 'GET' && path === '/projects/p1/export') {
      cap.exportUrls.push(url.search);
      return route.fulfill({ status: 200, contentType: 'application/zip', body: 'PK\x03\x04zip' });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('status pill shows the active engine + draft chip after compile', async ({ page }) => {
  await mock(page, { exportUrls: [] });
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'success');
  const chip = page.getByTestId('compile-mode');
  await expect(chip).toContainText('XeLaTeX');
  await expect(chip).toContainText('draft');
});

test('Word count dialog shows the total and a per-file breakdown', async ({ page }) => {
  await mock(page, { exportUrls: [] });
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('word-count').click();
  await expect(page.getByTestId('wordcount-dialog')).toBeVisible();
  await expect(page.getByTestId('wordcount-total')).toHaveText('1,234');
  await expect(page.getByTestId('wordcount-files')).toContainText('main.tex');
});

test('Export dialog downloads a .zip and honours the include options', async ({ page }) => {
  const cap = { exportUrls: [] as string[] };
  await mock(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('export-project').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-include-pdf').check();
  await page.getByTestId('export-include-lit').check();
  await page.getByTestId('export-download').click();
  await expect.poll(() => cap.exportUrls.length).toBeGreaterThan(0);
  expect(cap.exportUrls[0]).toContain('pdf=1');
  expect(cap.exportUrls[0]).toContain('literature=1');
});
