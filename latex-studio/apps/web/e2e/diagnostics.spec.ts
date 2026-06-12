import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * OVERLEAF-STYLE THREE-TIER DIAGNOSTICS — acceptance criteria:
 * red error → panel + gutter + red pill, click jumps; orange undefined ref with
 * one-click rerun; yellow minor hidden by default behind a chip; markers clear
 * on a clean recompile; raw-log toggle; Fix with Claude on red AND orange.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const MAIN = [
  '\\documentclass{article}',
  '\\begin{document}',
  'Intro text.',
  'More text.',
  '\\undefinedcmd',
  'Even more.',
  'See \\ref{eq:ghost}.',
  'Padding.',
  'A long overfull line.',
  '\\end{document}',
].join('\n');

const DIAGS = [
  {
    severity: 'error',
    category: 'undefined-control-sequence',
    message: 'Undefined control sequence \\undefinedcmd',
    file: 'main.tex',
    line: 5,
    rawExcerpt: '! Undefined control sequence.\nl.5 \\undefinedcmd',
  },
  {
    severity: 'warning-important',
    category: 'undefined-reference',
    message: "Reference `eq:ghost' on page 1 undefined",
    file: 'main.tex',
    line: 7,
    rawExcerpt: "LaTeX Warning: Reference `eq:ghost' on page 1 undefined on input line 7.",
  },
  {
    severity: 'warning-important',
    category: 'labels-changed-rerun',
    message: 'Label(s) may have changed. Rerun to get cross-references right.',
    rerunHint: true,
    rawExcerpt: 'LaTeX Warning: Label(s) may have changed.',
  },
  {
    severity: 'warning-minor',
    category: 'overfull-box',
    message: 'Overfull box (worst 0.5pt too wide) — 1 occurrence',
    file: 'main.tex',
    line: 9,
    count: 1,
    rawExcerpt: 'Overfull \\hbox (0.5pt too wide) in paragraph at lines 9--9',
  },
];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page, compiles: { count: number }) {
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: MAIN });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/compile') {
      compiles.count += 1;
      if (compiles.count === 1) {
        return json(route, { status: 'error', diagnostics: DIAGS, durationMs: 800, log: 'RAW LOG CONTENT\n! Undefined control sequence.' });
      }
      return json(route, { status: 'success', diagnostics: [], durationMs: 500, log: 'clean run', pdfUrl: null });
    }
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('red error: panel entry + gutter marker + red pill; click jumps to the line', async ({ page }) => {
  const compiles = { count: 0 };
  await mockApi(page, compiles);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter'); // Compile

  // Status pill: red, failed, with the error count.
  const pill = page.getByTestId('compile-status');
  await expect(pill).toHaveAttribute('data-status', 'error');
  await expect(pill).toContainText('Failed — 1 error');

  // Panel badges: 1 red, 2 orange, 1 yellow — yellow hidden by default.
  await page.getByTestId('tab-problems').click();
  await expect(page.getByTestId('diag-count-error')).toHaveText('1');
  await expect(page.getByTestId('diag-count-warning-important')).toHaveText('2');
  await expect(page.getByTestId('diag-count-warning-minor')).toHaveText('1');
  await expect(page.getByTestId('diag-error')).toHaveCount(1);
  await expect(page.getByTestId('diag-warning-important')).toHaveCount(2);
  await expect(page.getByTestId('diag-warning-minor')).toHaveCount(0); // collapsed by default

  // The minor chip reveals the yellow tier.
  await page.getByTestId('diag-chip-warning-minor').click();
  await expect(page.getByTestId('diag-warning-minor')).toHaveCount(1);

  // Editor markers: red gutter dot and a squiggle on the offending line.
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(1);
  await expect(page.locator('.cm-lintRange-error').first()).toBeVisible();
  await expect(page.locator('.cm-lint-marker-warning')).toHaveCount(1); // orange ref line
  await expect(page.locator('.cm-lint-marker-info')).toHaveCount(1); // yellow box line

  // Clicking the panel entry jumps to the line and flashes it.
  await page.getByTestId('diag-error').click();
  await expect(page.locator('.cm-flash-line').first()).toBeVisible();

  // Raw excerpt expander.
  await page.getByTestId('diag-error').getByLabel('Show raw log excerpt').click();
  await expect(page.getByTestId('diag-excerpt')).toContainText('! Undefined control sequence');

  // Raw log toggle shows the full .log.
  await page.getByTestId('toggle-raw-log').click();
  await expect(page.getByTestId('raw-log')).toContainText('RAW LOG CONTENT');
  await page.getByTestId('toggle-raw-log').click();
});

test('orange tier: undefined ref offers Fix with Claude; rerun-needed offers one-click recompile that clears everything', async ({ page }) => {
  const compiles = { count: 0 };
  await mockApi(page, compiles);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByTestId('tab-problems').click();
  await expect(page.getByTestId('diag-warning-important')).toHaveCount(2);

  // Fix with Claude is offered on the orange undefined-reference entry.
  const refRow = page.getByTestId('diag-warning-important').first();
  await refRow.hover();
  await expect(refRow.getByTestId('fix-with-claude')).toBeVisible();

  // The rerun-needed entry has its own one-click recompile.
  await expect(page.getByTestId('diag-rerun')).toBeVisible();
  await page.getByTestId('diag-rerun').click();

  // Second (clean) compile: green pill, zero counts, ALL editor markers cleared.
  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'success');
  await expect(page.getByTestId('compile-status')).toContainText('Compiled');
  await expect(page.getByTestId('diag-count-error')).toHaveText('0');
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0);
  await expect(page.locator('.cm-lint-marker-warning')).toHaveCount(0);
  await expect(page.locator('.cm-lint-marker-info')).toHaveCount(0);
  expect(compiles.count).toBe(2);
});

test('the status pill opens the Problems panel and jumps to the first error', async ({ page }) => {
  const compiles = { count: 0 };
  await mockApi(page, compiles);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+Enter');

  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'error');
  await page.getByTestId('compile-status').click();
  await expect(page.getByTestId('diag-error')).toBeVisible(); // panel revealed
  await expect(page.locator('.cm-flash-line').first()).toBeVisible(); // jumped to first error
});
