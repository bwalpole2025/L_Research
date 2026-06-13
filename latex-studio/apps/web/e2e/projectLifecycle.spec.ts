import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Dashboard Archive + Trash: a project can be archived (set aside, out of the
 * main list, restorable) or deleted to the Trash (restorable until purged). The
 * sidebar gains an "Archived" and a "Trash" view; rows get Archive + Delete.
 */

const NOW = '2024-01-01T00:00:00.000Z';
type State = 'active' | 'archived' | 'deleted';
const project = (id: string, name: string) => ({ id, name, rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, folderId: null, model: 'm', aiInstructions: '', archivedAt: null, deletedAt: null });

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  const state: Record<string, State> = { p1: 'active', p2: 'active' };
  const meta: Record<string, ReturnType<typeof project>> = { p1: project('p1', 'Alpha Paper'), p2: project('p2', 'Beta Notes') };
  const present = (id: string) => state[id] !== undefined;
  const listFor = (view: State) => Object.keys(state).filter((id) => state[id] === view).map((id) => meta[id]);

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();

    if (method === 'GET' && path === '/projects') {
      const view = (url.searchParams.get('view') as State) || 'active';
      return json(route, listFor(view));
    }
    if (method === 'GET' && path === '/project-folders') return json(route, { folders: [] });
    if (method === 'GET' && path === '/project-trash') return json(route, { items: [] });

    const m = /^\/projects\/(p\d)(\/archive|\/unarchive|\/restore|\/permanent)?$/.exec(path);
    if (m) {
      const id = m[1]!;
      const op = m[2];
      if (!present(id)) return json(route, { error: 'not found' }, 404);
      if (method === 'POST' && op === '/archive') state[id] = 'archived';
      else if (method === 'POST' && op === '/unarchive') state[id] = 'active';
      else if (method === 'POST' && op === '/restore') state[id] = 'active';
      else if (method === 'DELETE' && op === '/permanent') {
        if (state[id] !== 'deleted') return json(route, { error: 'trash first' }, 409);
        delete state[id];
        return json(route, { ok: true });
      } else if (method === 'DELETE' && !op) state[id] = 'deleted';
      return json(route, present(id) ? meta[id] : { ok: true });
    }
    if (method === 'DELETE' && path === '/projects-trash/purge') {
      let removed = 0;
      for (const id of Object.keys(state)) if (state[id] === 'deleted') { delete state[id]; removed++; }
      return json(route, { ok: true, removed });
    }
    if (method === 'GET' && /\/compile-status$/.test(path)) return json(route, { status: null });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

const row = (page: Page, name: string) => page.getByTestId('files-project').filter({ hasText: name });

test('archive a project → Archived view → unarchive brings it back', async ({ page }) => {
  await mockApi(page);
  await page.goto('/files');
  await expect(page.getByTestId('files-project')).toHaveCount(2);

  // Archive Alpha → it leaves the active list.
  await row(page, 'Alpha Paper').getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('files-project')).toHaveCount(1);
  await expect(page.getByTestId('view-archived')).toContainText('1'); // sidebar count

  // Archived view shows it; unarchive restores it to the main list.
  await page.getByTestId('view-archived').click();
  await expect(page.getByTestId('archived-project')).toHaveCount(1);
  await expect(page.getByTestId('archived-view')).toContainText('Alpha Paper');
  await page.getByTestId('unarchive-project').click();
  await expect(page.getByTestId('archived-project')).toHaveCount(0);
});

test('delete a project → Trash → restore; then delete + delete forever', async ({ page }) => {
  await mockApi(page);
  await page.goto('/files');
  await expect(page.getByTestId('files-project')).toHaveCount(2);

  // Delete Beta → confirm dialog → it moves to Trash.
  await row(page, 'Beta Notes').getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByTestId('app-dialog-confirm').click();
  await expect(page.getByTestId('files-project')).toHaveCount(1);

  // Trash view shows it; Restore brings it back to the active list.
  await page.getByTestId('view-trash').click();
  await expect(page.getByTestId('trash-project')).toHaveCount(1);
  await expect(page.getByTestId('trash-view')).toContainText('Beta Notes');
  await page.getByTestId('restore-project').click();
  await expect(page.getByTestId('trash-project')).toHaveCount(0);
});

test('purge from Trash removes the project for good', async ({ page }) => {
  await mockApi(page);
  await page.goto('/files');
  await row(page, 'Alpha Paper').getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByTestId('app-dialog-confirm').click();

  await page.getByTestId('view-trash').click();
  await expect(page.getByTestId('trash-project')).toHaveCount(1);
  await page.getByTestId('purge-project').click();
  await page.getByTestId('app-dialog-confirm').click();
  await expect(page.getByTestId('trash-project')).toHaveCount(0);
});
