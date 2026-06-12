import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Adaptive autocomplete: items the user accepts often rank higher WITHIN their
 * match tier — local, deterministic, no model. \appendix and \approx share the
 * typed prefix `\ap` and the same source tier; by default they sort
 * alphabetically (\appendix first). Accepting \approx flips that — but a
 * non-matching command never appears however often it was accepted.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const MAIN = ['\\documentclass{article}', '\\begin{document}', 'BODY', '\\end{document}'].join('\n');

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface UsageTraffic {
  calls: string[];
  posted: Array<{ key: string; scope: string; at?: string }>;
  deleted: string[];
}

async function mockApi(page: Page, traffic: UsageTraffic) {
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    traffic.calls.push(`${method} ${path}`);
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: MAIN });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'GET' && path === '/projects/p1/usage') return json(route, { app: [], project: [] });
    if (method === 'POST' && path === '/projects/p1/usage') {
      traffic.posted.push(...(JSON.parse(route.request().postData() ?? '{}') as { events: UsageTraffic['posted'] }).events);
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'DELETE' && path === '/projects/p1/usage') {
      traffic.deleted.push(new URL(route.request().url()).searchParams.get('scope') ?? '?');
      return route.fulfill({ status: 204, body: '' });
    }
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

const dropdown = (page: Page) => page.locator('.cm-tooltip-autocomplete');
const labels = (page: Page) => dropdown(page).locator('.cm-completionLabel');

async function focusBody(page: Page) {
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByText('BODY', { exact: true }).click({ clickCount: 2 });
  await page.keyboard.press('Backspace');
}

/** Type a full command and Tab-accept its (sole) completion. */
async function accept(page: Page, cmd: string) {
  await page.keyboard.type(`\\${cmd}`);
  await expect(dropdown(page)).toBeVisible();
  await page.waitForTimeout(50);
  await page.keyboard.press('Tab');
  await expect(dropdown(page)).toHaveCount(0);
  await page.keyboard.press(' ');
}

/** Open the `\ap` dropdown and return the option labels in display order. */
async function apOptions(page: Page): Promise<string[]> {
  await page.keyboard.type('\\ap');
  await expect(dropdown(page)).toBeVisible();
  const texts = await labels(page).allTextContents();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
  return texts;
}

test('accepted commands rank higher within their tier; popularity never surfaces a non-match; reconcile is batched', async ({ page }) => {
  const traffic: UsageTraffic = { calls: [], posted: [], deleted: [] };
  await mockApi(page, traffic);
  await page.goto('/studio');
  await focusBody(page);

  // COLD START: no history → static order (alphabetical within the tier).
  const cold = await apOptions(page);
  expect(cold[0]).toBe('\\appendix');
  expect(cold).toContain('\\approx');

  // Accept \approx twice and \sum three times (the "popular" non-match).
  await accept(page, 'approx');
  await accept(page, 'approx');
  await accept(page, 'sum');
  await accept(page, 'sum');
  await accept(page, 'sum');

  // ADAPTIVE: \approx now outranks \appendix for the same query…
  const adapted = await apOptions(page);
  expect(adapted[0]).toBe('\\approx');
  expect(adapted).toContain('\\appendix');
  // …but \sum, however popular, does not match `\ap` and never appears.
  expect(adapted).not.toContain('\\sum');

  // The boosted item carries the subtle "learned" dot marker.
  await page.keyboard.type('\\ap');
  await expect(dropdown(page)).toBeVisible();
  await expect(dropdown(page).locator('li.ls-ac-used .cm-completionLabel', { hasText: '\\approx' })).toBeVisible();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');

  // RANKING IS LOCAL: exactly one usage GET (hydrate), regardless of keystrokes.
  expect(traffic.calls.filter((c) => c === 'GET /projects/p1/usage')).toHaveLength(1);

  // RECONCILE: accepts were batched to the server (debounced, app-scoped).
  await page.waitForTimeout(2000);
  const approxEvents = traffic.posted.filter((e) => e.key === 'cmd:approx');
  expect(approxEvents).toHaveLength(2);
  expect(approxEvents.every((e) => e.scope === 'app')).toBe(true);
  expect(traffic.posted.filter((e) => e.key === 'cmd:sum')).toHaveLength(3);
});

test('toggling adaptive off restores the default order; reset clears the learned usage', async ({ page }) => {
  const traffic: UsageTraffic = { calls: [], posted: [], deleted: [] };
  await mockApi(page, traffic);
  await page.goto('/studio');
  await focusBody(page);

  await accept(page, 'approx');
  await accept(page, 'approx');
  expect((await apOptions(page))[0]).toBe('\\approx');

  // Toggle "Adapt suggestions to my usage" OFF → non-adaptive order.
  await page.getByTestId('tools-menu').click();
  await page.getByLabel('Project settings').click();
  await expect(page.getByTestId('toggle-adaptive')).toBeVisible();
  await expect(page.getByTestId('usage-top')).toContainText('cmd:approx ×2'); // inspectable
  await page.getByTestId('toggle-adaptive').click();
  await page.getByLabel('Close', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  expect((await apOptions(page))[0]).toBe('\\appendix');

  // Back ON → adaptive again.
  await page.getByTestId('tools-menu').click();
  await page.getByLabel('Project settings').click();
  await page.getByTestId('toggle-adaptive').click();
  await page.getByLabel('Close', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  expect((await apOptions(page))[0]).toBe('\\approx');

  // RESET (app scope, with confirm) → defaults return, server DELETE issued.
  await page.getByTestId('tools-menu').click();
  await page.getByLabel('Project settings').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('usage-reset-app').click();
  await page.getByLabel('Close', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  expect((await apOptions(page))[0]).toBe('\\appendix');
  await expect.poll(() => traffic.deleted).toContain('app');
});
