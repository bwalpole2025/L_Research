import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * "Preview before it compiles":
 *  1. Live KaTeX preview of the equation at the cursor — instant, offline.
 *  2. Auto-compile defaults ON, so the PDF refreshes itself without pressing
 *     Compile.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const MAIN = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Prose line.',
  '\\begin{equation}',
  'e^{i\\pi} = -1',
  '\\end{equation}',
  '\\end{document}',
].join('\n');

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page, counter?: { compiles: number }) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: MAIN });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/compile') {
      if (counter) counter.compiles += 1;
      return json(route, { status: 'success', diagnostics: [], durationMs: 500, pdfUrl: '/projects/p1/pdf?rev=1', log: '' });
    }
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('the equation at the cursor renders instantly (KaTeX) — and prose shows no preview', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  // Cursor in prose → no preview.
  await page.getByText('Prose line.').click();
  await expect(page.getByTestId('math-preview')).toHaveCount(0);

  // Cursor inside the equation → rendered preview appears, no compile involved.
  await page.getByText('e^{i\\pi} = -1').click();
  const preview = page.getByTestId('math-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.katex')).toBeVisible(); // genuinely typeset

  // Editing updates the preview live.
  await page.keyboard.press('End');
  await page.keyboard.type(' + 0');
  await expect(preview.locator('.katex')).toBeVisible();

  // Leaving the maths hides it again.
  await page.getByText('Prose line.').click();
  await expect(page.getByTestId('math-preview')).toHaveCount(0);
});

test('auto-compile is ON by default: typing refreshes the PDF without pressing Compile', async ({ page }) => {
  const counter = { compiles: 0 };
  await mockApi(page, counter);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  // The toolbar checkbox reflects the default.
  await expect(page.getByLabel('Auto compile')).toBeChecked();

  // Type → autosave → compile fires by itself.
  await page.getByText('Prose line.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' More words.');
  await expect.poll(() => counter.compiles, { timeout: 8000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'success');
});
