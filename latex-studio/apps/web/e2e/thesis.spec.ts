import { test, expect, type Page, type Route } from '@playwright/test';

/** Hermetic Phase 7 test: outline jump across files, xref health, pre-submit. */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Thesis', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILES = [
  { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW },
  { id: 'f2', projectId: 'p1', path: 'chapters/methods.tex', updatedAt: NOW },
  { id: 'f3', projectId: 'p1', path: 'chapters/deep.tex', updatedAt: NOW },
];
const CONTENT: Record<string, string> = {
  f1: '\\documentclass{book}\n\\begin{document}\n\\chapter{Intro}\n\\end{document}\n',
  f2: '\\section{Methods}\n',
  f3: '\\subsection{Deep}\nDEEPFILEMARKER\n',
};

const OUTLINE = {
  roots: [
    {
      id: 's1', level: 1, kind: 'chapter', title: 'Intro', file: 'main.tex', line: 3, labels: [],
      children: [
        {
          id: 's2', level: 2, kind: 'section', title: 'Methods', file: 'chapters/methods.tex', line: 1, labels: [],
          children: [
            { id: 's3', level: 3, kind: 'subsection', title: 'Deep', file: 'chapters/deep.tex', line: 1, labels: [], children: [] },
          ],
        },
      ],
    },
  ],
};

const XREF = {
  diagnostics: [
    { file: 'main.tex', line: 4, severity: 'error', rule: 'undefined-ref', message: 'Reference to undefined label "eq:ghost"', key: 'eq:ghost' },
    { file: 'main.tex', line: 6, severity: 'error', rule: 'duplicate-label', message: 'Label "eq:a" is defined 2 times', key: 'eq:a', locations: [{ file: 'main.tex', line: 6 }, { file: 'chapters/methods.tex', line: 2 }] },
    { file: 'main.tex', line: 7, severity: 'error', rule: 'missing-cite', message: 'Citation "nobody2020" not found in any .bib file', key: 'nobody2020' },
  ],
  totals: { error: 3, info: 0 },
};

const SUMMARY = {
  projectName: 'Thesis', generatedAt: NOW,
  compile: { status: 'success', errors: 0, warnings: 1, durationMs: 1200 },
  maths: { failing: 0, unknown: 1, passed: 5 },
  prose: { error: 0, warning: 2, info: 1 },
  xref: { error: 3, info: 0 },
  ready: false,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, FILES);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    const fileGet = /^\/files\/(f\d)$/.exec(path);
    if (method === 'GET' && fileGet) {
      const meta = FILES.find((f) => f.id === fileGet[1])!;
      return json(route, { ...meta, content: CONTENT[fileGet[1]!] });
    }
    if (method === 'PATCH' && /^\/files\/f\d$/.test(path)) return json(route, { content: '' });
    if (method === 'POST' && path === '/projects/p1/outline') return json(route, OUTLINE);
    if (method === 'POST' && path === '/projects/p1/xref') return json(route, XREF);
    if (method === 'POST' && path === '/projects/p1/pre-submit') return json(route, SUMMARY);
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('outline reflects multi-file structure and jumps three files away', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('left-tab-outline').click();
  await expect(page.getByText('Intro')).toBeVisible();
  await expect(page.getByText('Methods')).toBeVisible();
  await expect(page.getByText('Deep')).toBeVisible();

  // Click the subsection that lives in a third file → editor jumps there.
  await page.getByText('Deep').click();
  await expect(page.locator('.cm-content')).toContainText('DEEPFILEMARKER');
});

test('cross-reference health flags undefined ref, duplicate label, and missing cite', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('tab-refs').click();
  await expect(page.getByText('Reference to undefined label "eq:ghost"')).toBeVisible();
  await expect(page.getByText('Label "eq:a" is defined 2 times')).toBeVisible();
  await expect(page.getByText('Citation "nobody2020" not found in any .bib file')).toBeVisible();
});

test('pre-submit produces the dashboard with a not-ready verdict + export', async ({ page }) => {
  await mockApi(page);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('tools-menu').click();
  await page.getByTestId('pre-submit').click();
  await expect(page.getByTestId('presubmit-ready')).toHaveAttribute('data-ready', 'false');
  await expect(page.getByText('Not ready — issues remain')).toBeVisible();
  await expect(page.getByTestId('presubmit-export')).toBeEnabled();
});
