import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * The app shell around the editor: landing (animated, public), login
 * (construction-phase dummy accounts), session guard, and the Files /
 * References pages.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const P1 = { id: 'p1', name: 'My Paper', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '' };
const P2 = { id: 'p2', name: 'Notes', rootFile: 'notes.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '' };
const BIB = [
  '@article{basset1888,\n  author = {Basset, A. B.},\n  title = {On the motion of a sphere},\n  year = {1888}\n}',
  '@article{cornish2018,\n  author = {Cornish, A.},\n  title = {Multiple scales},\n  year = {2018}\n}',
].join('\n');

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [P1, P2]);
    if (method === 'GET' && path === '/project-folders') return json(route, { folders: [] });
    if (method === 'GET' && path === '/project-trash') return json(route, { items: [] });
    if (method === 'GET' && path === '/projects/p1/files')
      return json(route, [
        { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW },
        { id: 'f2', projectId: 'p1', path: 'refs.bib', updatedAt: NOW },
        { id: 'f3', projectId: 'p1', path: 'figs/plot.png', encoding: 'base64', updatedAt: NOW },
      ]);
    if (method === 'GET' && path === '/projects/p2/files')
      return json(route, [{ id: 'f4', projectId: 'p2', path: 'notes.tex', updatedAt: NOW }]);
    if (method === 'GET' && path === '/files/f2') return json(route, { id: 'f2', path: 'refs.bib', encoding: 'utf8', content: BIB });
    if (method === 'GET' && path === '/projects/p1/library')
      return json(route, {
        folders: [],
        items: [
          {
            id: 'L1', projectId: 'p1', folderId: null, title: 'Wall-free liquid microchannels', authors: 'Bouret, Y.',
            year: '2016', citeKey: 'bouret2016lib', fileName: 'bouret.pdf', fileSizeBytes: 1, doi: null, abstract: null, hasText: true,
          },
        ],
        trashCount: 0,
      });
    if (method === 'GET' && path === '/projects/p2/library') return json(route, { folders: [], items: [], trashCount: 0 });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('landing: hero, travelling soliton, drifting KaTeX equations, CTAs — no login needed', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('landing-hero')).toBeVisible();
  await expect(page.getByTestId('soliton')).toBeVisible();
  await expect(page.getByTestId('cta-studio')).toBeVisible();
  await expect(page.getByTestId('landing-signin')).toBeVisible();
  // The maths is typeset (KaTeX), not raw source, and there are several of them.
  expect(await page.getByTestId('floating-eq').count()).toBeGreaterThanOrEqual(4);
  await expect(page.getByTestId('landing-hero').locator('.katex').first()).toBeVisible();
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('guarded pages redirect to /login; a demo account signs in and lands back', async ({ page }) => {
    await mockApi(page);
    await page.goto('/files');
    await page.waitForURL(/\/login\?next=%2Ffiles/);

    await page.getByTestId('demo-guest').click(); // fills email + password
    await page.getByTestId('login-submit').click();
    await page.waitForURL(/\/files/);
    await expect(page.getByTestId('nav-user')).toContainText('demo@latexstudio.local');
  });

  test('a wrong password shows an error and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill('demo@latexstudio.local');
    await page.getByTestId('login-password').fill('wrong');
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('login-error')).toBeVisible();
    expect(page.url()).toContain('/login');
  });
});

test('the dashboard lists projects only (main file in the pill, no sub-files); search filters', async ({ page }) => {
  await mockApi(page);
  await page.goto('/files');
  await expect(page.getByTestId('files-project')).toHaveCount(2);
  await expect(page.getByText('main.tex')).toBeVisible(); // the root file pill
  await expect(page.getByText('figs/plot.png')).toHaveCount(0); // sub-files are NOT listed

  await page.getByTestId('files-search').fill('Notes');
  await expect(page.getByTestId('files-project')).toHaveCount(1);
  await page.getByTestId('files-search').fill('');
  await expect(page.getByTestId('files-project')).toHaveCount(2);
});

test('references page merges .bib entries with library items; sign-out works', async ({ page }) => {
  await mockApi(page);
  await page.goto('/references');
  await expect(page.getByTestId('refs-row')).toHaveCount(3); // 2 bib entries + 1 library PDF
  await expect(page.getByText('basset1888')).toBeVisible();
  await expect(page.getByText('bouret2016lib')).toBeVisible();
  await expect(page.getByText('Library PDF')).toBeVisible();

  await page.getByTestId('refs-search').fill('cornish');
  await expect(page.getByTestId('refs-row')).toHaveCount(1);
  await page.getByTestId('refs-search').fill('');

  // Sign out returns to the landing page; the guard then blocks /references.
  await page.getByTestId('nav-signout').click();
  await page.waitForURL(/\/$/);
  await page.goto('/references');
  await page.waitForURL(/\/login/);
});