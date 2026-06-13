import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Deterministic quick-fix: using \begin{align} without \usepackage{amsmath}
 * gives an "Environment align undefined" error (+ misplaced-& cascade). The
 * Problems panel shows a one-click "Add amsmath" button that inserts the package
 * into the root preamble and recompiles clean — no LLM, no manual edit.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const DOC_NO_AMS = ['\\documentclass{article}', '\\begin{document}', '\\begin{align}', 'q &= (x+1)^2 \\\\', 'q &= x^2 + 2x + 1', '\\end{align}', '\\end{document}'].join('\n');

const ENV_ERROR = {
  severity: 'error',
  category: 'undefined-environment',
  message: 'LaTeX Error: Environment align undefined.',
  file: 'main.tex',
  line: 3,
  rawExcerpt: 'LaTeX Error: Environment align undefined.\nl.3 \\begin{align}',
  quickFix: { kind: 'add-package', package: 'amsmath', label: 'Add amsmath' },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page, cap: { content: string; compiles: number }) {
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: cap.content });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'PATCH' && path === '/files/f1') {
      cap.content = (JSON.parse(route.request().postData() ?? '{}') as { content: string }).content;
      return json(route, { content: '' });
    }
    if (method === 'POST' && path === '/projects/p1/compile') {
      cap.compiles += 1;
      const hasAms = /\\usepackage(?:\[[^\]]*\])?\{[^}]*amsmath[^}]*\}/.test(cap.content);
      return hasAms
        ? json(route, { status: 'success', diagnostics: [], durationMs: 400, log: 'ok', pdfUrl: '/projects/p1/pdf' })
        : json(route, {
            status: 'error',
            diagnostics: [ENV_ERROR, { severity: 'error', category: 'misplaced-alignment', message: 'Misplaced alignment tab character &.', file: 'main.tex', line: 4, quickFix: ENV_ERROR.quickFix }],
            durationMs: 500,
            log: 'RAW',
          });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('Add amsmath quick-fix: one click inserts the package and recompiles clean', async ({ page }) => {
  const cap = { content: DOC_NO_AMS, compiles: 0 };
  await mockApi(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+Enter'); // compile
  await page.getByTestId('tab-problems').click();
  await expect(page.getByTestId('diag-error').first()).toBeVisible();

  // The deterministic quick-fix button is offered (not just "Fix with Claude").
  const fix = page.getByTestId('diag-quick-fix').first();
  await expect(fix).toContainText('Add amsmath');

  await fix.click();
  // The root file gained \usepackage{amsmath}, and a clean recompile followed.
  await expect.poll(() => /\\usepackage\{amsmath\}/.test(cap.content), { timeout: 5000 }).toBe(true);
  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'success');
  await expect(page.getByTestId('diag-error')).toHaveCount(0);
});
