import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Hermetic AI compile-error fix flow: a broken \begin{align} with a mismatched
 * \end produces a compile error → "Fix with Claude" → diff → Accept applies the
 * fix and a recompile then succeeds; Reject leaves the file byte-for-byte
 * unchanged (asserted via the autosave PATCH payloads). Never auto-applied.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };

const BROKEN = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\begin{align}',
  'x &= y+1',
  '\\end{equation}',
  '\\end{document}',
].join('\n');
const FIXED_REGION_MARK = '\\end{align}';

const ERROR_DIAG = {
  severity: 'error',
  message: '\\begin{align} on input line 3 ended by \\end{equation}.',
  file: 'main.tex',
  line: 5,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/** Mock API; tracks autosave PATCH bodies + serves compile failure-then-success. */
function mockApi(page: Page, state: { patches: string[]; compiles: number }) {
  return page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();

    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: BROKEN });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'GET' && path === '/ai/models') return json(route, { default: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'], live: false });
    if (method === 'PATCH' && path === '/files/f1') {
      state.patches.push(JSON.parse(route.request().postData() ?? '{}').content ?? '');
      return json(route, { ...FILE_META, content: '' });
    }
    if (method === 'POST' && path === '/projects/p1/compile') {
      state.compiles += 1;
      // First compile fails with the planted diagnostic; after a fix it succeeds.
      return json(
        route,
        state.compiles === 1
          ? { status: 'error', diagnostics: [ERROR_DIAG], durationMs: 900, log: 'l' }
          : { status: 'success', diagnostics: [], durationMs: 900, pdfUrl: '/projects/p1/pdf?rev=2', log: 'l' },
      );
    }
    if (method === 'POST' && path === '/projects/p1/fix') {
      // The model returns ONLY the corrected replacement for the captured region.
      const body = JSON.parse(route.request().postData() ?? '{}') as { region: string };
      return json(route, { replacement: body.region.replace('\\end{equation}', FIXED_REGION_MARK) });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

/** These flows target the manual-recompile offer, which exists when
 * compile-on-save is OFF — pin that preference (the product default is ON). */
async function disableAutoCompile(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
}

async function compileAndRequestFix(page: Page) {
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+Enter'); // Compile (⌘↵)
  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'error');

  // Every ERROR diagnostic offers "Fix with Claude" (hover reveals it).
  const row = page.getByText(/ended by \\end\{equation\}/);
  await expect(row).toBeVisible();
  await page.getByTestId('fix-with-claude').click();

  // The proposal is a diff — nothing has been applied yet.
  await expect(page.getByTestId('diff-merge')).toBeVisible();
}

test('broken align → Fix with Claude → Accept applies the diff and a recompile succeeds', async ({ page }) => {
  const state = { patches: [] as string[], compiles: 0 };
  await disableAutoCompile(page);
  await mockApi(page, state);
  await page.goto('/studio');
  await compileAndRequestFix(page);

  await page.getByTestId('diff-accept').click();
  await expect(page.locator('.cm-content')).toContainText(FIXED_REGION_MARK);

  // Accepting offers a recompile (compile-on-save is off) — clicking it succeeds.
  await page.getByTestId('recompile-after-fix').click();
  await expect(page.getByTestId('compile-status')).toHaveAttribute('data-status', 'success');
  expect(state.compiles).toBe(2);

  // The applied fix eventually autosaves with EXACTLY the accepted replacement.
  await expect.poll(() => state.patches.length).toBeGreaterThan(0);
  expect(state.patches.at(-1)).toContain(FIXED_REGION_MARK);
  expect(state.patches.at(-1)).not.toContain('\\end{equation}');
});

test('Reject leaves the file byte-for-byte unchanged (no save, no edit)', async ({ page }) => {
  const state = { patches: [] as string[], compiles: 0 };
  await disableAutoCompile(page);
  await mockApi(page, state);
  await page.goto('/studio');
  await compileAndRequestFix(page);

  await page.getByTestId('diff-reject').click();
  await expect(page.getByTestId('diff-merge')).toHaveCount(0);

  // Document text is exactly the broken original — and nothing was saved.
  await expect(page.locator('.cm-content')).toContainText('\\end{equation}');
  await expect(page.locator('.cm-content')).not.toContainText(FIXED_REGION_MARK);
  await page.waitForTimeout(1200); // longer than the autosave debounce
  expect(state.patches).toEqual([]); // byte-for-byte: no PATCH ever sent
  expect(page.getByTestId('recompile-after-fix')).toHaveCount(0);
});
