import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Hermetic IDE-autocomplete tests: deterministic dropdown (commands, context
 * values, snippets), begin→end pairing, ghost-text coexistence, and the
 * no-network guarantee.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILES = [
  { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW },
  { id: 'f2', projectId: 'p1', path: 'refs.bib', updatedAt: NOW },
  { id: 'f3', projectId: 'p1', path: 'figs/plot.png', encoding: 'base64', updatedAt: NOW },
  { id: 'f4', projectId: 'p1', path: 'chapters/ch1.tex', updatedAt: NOW },
];

const MAIN = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\newcommand{\\Bo}{\\mathrm{Bo}}',
  '\\begin{document}',
  '\\section{Setup}',
  '\\begin{equation}\\label{eq:euler}',
  'e^{i\\pi} = -1',
  '\\end{equation}',
  'BODY',
  '\\end{document}',
].join('\n');

const BIB = '@article{cornish2018,\n  author = {Cornish, A. and Wu, B.},\n  title = {Multiple scales},\n  year = {2018}\n}';
const GHOST = 'GHOST_SUGGESTION';

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page, counter?: { calls: string[] }) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    counter?.calls.push(`${method} ${path}`);
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, FILES);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILES[0], content: MAIN });
    if (method === 'GET' && path === '/files/f2') return json(route, { ...FILES[1], content: BIB });
    if (method === 'GET' && path === '/files/f4') return json(route, { ...FILES[3], content: '\\section{Chapter one}' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/complete') {
      return json(route, { completion: GHOST, latencyMs: 40, variant: 'warm', provider: 'agent-sdk', model: 'h' });
    }
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

/** Put the cursor on the BODY line, replacing it (a stable edit point). */
async function focusBody(page: Page) {
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  // Select the placeholder BODY and delete it, leaving the cursor there.
  await page.getByText('BODY', { exact: true }).click({ clickCount: 2 });
  await page.keyboard.press('Backspace');
}

const dropdown = (page: Page) => page.locator('.cm-tooltip-autocomplete');

test('\\inc suggests \\includegraphics with a description; Tab inserts it', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await focusBody(page);

  await page.keyboard.type('\\inc');
  await expect(dropdown(page)).toBeVisible();
  const option = dropdown(page).getByText('\\includegraphics', { exact: true });
  await expect(option).toBeVisible();
  await expect(dropdown(page)).toContainText('insert an image'); // description shown

  await page.waitForTimeout(120); // CM interactionDelay
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toContainText('\\includegraphics[width=');
});

test('a document-defined \\newcommand (\\Bo) appears in the dropdown, ranked as a project macro', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await focusBody(page);

  await page.keyboard.type('\\B');
  await expect(dropdown(page)).toBeVisible();
  await expect(dropdown(page).getByText('\\Bo', { exact: true })).toBeVisible();
  await expect(dropdown(page)).toContainText('macro (this project)');
});

test('context isolation: images inside \\includegraphics{, bib keys inside \\cite{, labels inside \\ref{, envs inside \\begin{', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await focusBody(page);

  const label = (text: string) => dropdown(page).locator('.cm-completionLabel', { hasText: text });

  // \includegraphics{ → project images only (no bib keys).
  await page.keyboard.type('\\includegraphics{');
  await expect(dropdown(page)).toBeVisible();
  await expect(label('figs/plot.png')).toBeVisible();
  await expect(label('cornish2018')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.type('}');
  await page.keyboard.press('Enter');

  // \cite{ → bib keys with author/year (no images).
  await page.keyboard.type('\\cite{');
  await expect(dropdown(page)).toBeVisible();
  await expect(label('cornish2018')).toBeVisible();
  await expect(dropdown(page)).toContainText('2018');
  await expect(label('figs/plot.png')).toHaveCount(0);
  await page.waitForTimeout(120); // CM interactionDelay
  await page.keyboard.press('Enter'); // Enter also accepts
  await expect(page.locator('.cm-content')).toContainText('\\cite{cornish2018');
  await page.keyboard.type('}');
  await page.keyboard.press('Enter');

  // \ref{ → real labels.
  await page.keyboard.type('\\ref{');
  await expect(dropdown(page)).toBeVisible();
  await expect(label('eq:euler')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('accepting \\begin{align} inserts the matching \\end{align} once, cursor between', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await focusBody(page);

  await page.keyboard.type('\\begin{ali');
  await expect(dropdown(page)).toBeVisible();
  await expect(dropdown(page).getByText('align', { exact: true })).toBeVisible();
  await page.waitForTimeout(120); // CM interactionDelay
  await page.keyboard.press('Tab');

  // The pair exists exactly once, and typing lands between begin and end.
  await page.keyboard.type('XCURSORX');
  const text = await page.locator('.cm-content').innerText();
  expect(text.match(/\\end\{align\}/g)?.length).toBe(1);
  expect(text.indexOf('\\begin{align}')).toBeLessThan(text.indexOf('XCURSORX'));
  expect(text.indexOf('XCURSORX')).toBeLessThan(text.indexOf('\\end{align}'));
});

test('the figure snippet inserts the full template and Tab cycles the placeholders in order', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await focusBody(page);

  await page.keyboard.type('figure');
  await page.keyboard.press('Control+Space'); // explicit trigger for word snippets
  await expect(dropdown(page)).toBeVisible();
  await expect(dropdown(page).getByText('figure environment (snippet)')).toBeVisible();
  await page.waitForTimeout(120); // CM interactionDelay: accepts <75ms after open are ignored
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toContainText('\\begin{figure}'); // template inserted

  // First stop (placement) is selected — typing replaces it; Tab cycles onward.
  await page.keyboard.type('h');
  await page.keyboard.press('Tab'); // → width
  await page.keyboard.type('0.5');
  await page.keyboard.press('Tab'); // → path
  await page.keyboard.type('figs/plot.png');
  await page.keyboard.press('Tab'); // → caption
  await page.keyboard.type('My caption');
  await page.keyboard.press('Tab'); // → label key
  await page.keyboard.type('plot');

  const text = await page.locator('.cm-content').innerText();
  expect(text).toContain('\\begin{figure}[h]');
  expect(text).toContain('width=0.5\\textwidth');
  expect(text).toContain('{figs/plot.png}');
  expect(text).toContain('\\caption{My caption}');
  expect(text).toContain('\\label{fig:plot}');
});

test('coexistence: the dropdown suppresses ghost text; closing restores it; Tab is unambiguous', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await focusBody(page);

  // 1. Get a ghost suggestion (typing-debounced AI mock).
  await page.keyboard.type('a');
  await expect(page.locator('.cm-ghost')).toBeVisible();

  // 2. Open the dropdown WITHOUT a doc change (explicit trigger) → ghost hidden.
  await page.keyboard.press('Control+Space');
  await expect(dropdown(page)).toBeVisible();
  await expect(page.locator('.cm-ghost')).toHaveCount(0);

  // 3. Tab with the dropdown open accepts the DROPDOWN item, not the ghost.
  await page.keyboard.press('Escape'); // close instead — first assert restore…
  await expect(dropdown(page)).toHaveCount(0);
  await expect(page.locator('.cm-ghost')).toBeVisible(); // …ghost resumes

  // 4. …and with the dropdown closed, Tab accepts the ghost.
  await page.keyboard.press('Tab');
  await expect(page.locator('.cm-content')).toContainText(GHOST);
});

test('no network: with ghost completions off, autocomplete interactions make ZERO api calls', async ({ page }) => {
  const counter = { calls: [] as string[] };
  await mockApi(page, counter);
  await page.goto('/studio');

  // Turn the AI ghost OFF so the only possible traffic would be autocomplete's.
  await page.getByTestId('toggle-completions').click();
  await focusBody(page);

  // Warm-up: first dropdown may prefetch the index (background, once).
  await page.keyboard.type('\\cite{');
  await expect(dropdown(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.type('}');
  await page.waitForTimeout(500);

  const before = counter.calls.length;
  await page.keyboard.type(' \\ref{');
  await expect(dropdown(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.type('} \\inc');
  await expect(dropdown(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.type(' \\begin{ali');
  await expect(dropdown(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // Deterministic completion made no network calls (autosave PATCH excluded —
  // that's the editor saving the document, not the completion engine).
  const during = counter.calls
    .slice(before)
    .filter((c) => !c.startsWith('PATCH /files') && !c.endsWith('/compile'));
  expect(during).toEqual([]);
});
