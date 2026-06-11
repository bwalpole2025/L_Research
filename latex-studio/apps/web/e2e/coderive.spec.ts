import { test, expect, type Page, type Route } from '@playwright/test';

/** Hermetic co-derive UI test: SymPy verdicts gate insertion; honesty surfaced. */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Proj', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE = { id: 'f1', projectId: 'p1', path: 'main.tex', encoding: 'utf8', updatedAt: NOW };

const RESULT = {
  intent: 'next-step',
  candidates: [
    { latex: 'x^2 + 2x + 1', status: 'verified', method: 'symbolic', technique: 'expand', groundedIn: ['cornish2018'], rationale: 'expand the square', claimedEqualTo: '(x+1)^2', retriesUsed: 0, attributionUnverified: false },
    { latex: 'x^2 + 2x + 2', status: 'unverified', method: 'sample', counterexample: { values: { x: 1 }, lhsVal: 4, rhsVal: 5 }, technique: 'expand', groundedIn: ['ghostref'], rationale: 'wrong', claimedEqualTo: '(x+1)^2', retriesUsed: 0, attributionUnverified: true },
  ],
  context: {
    macroCount: 3,
    assumptions: 'x>0',
    documentWindowChars: 120,
    windowPreview: 'We expand the square here.',
    references: [
      { key: 'cornish2018', provenance: 'full-text', sourceFile: 'refs/cornish2018.pdf', passageCount: 2 },
      { key: 'ghostref', provenance: 'metadata-only', passageCount: 0 },
    ],
  },
  skipped: [{ latex: 'author = {Basset, AB},', reason: 'bibtex-field' }],
  rounds: [{ round: 1, proposalCount: 3, skippedCount: 1, verdicts: [{ latex: 'x^2 + 2x + 1', status: 'verified', method: 'symbolic' }, { latex: 'x^2 + 2x + 2', status: 'unverified', method: 'sample' }] }],
  anchors: { from: '(x+1)^2' },
};

const SSE =
  `event: round\ndata: ${JSON.stringify(RESULT.rounds[0])}\n\n` +
  `event: result\ndata: ${JSON.stringify(RESULT)}\n\n`;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function mockApi(page: Page) {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE, content: '\\documentclass{article}\n\\begin{document}\ny = (x+1)^2\n\\end{document}\n' });
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/coderive') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: SSE });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('SymPy verdicts gate insertion; counterexample + attribution + provenance are surfaced', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.locator('.cm-content').click(); // give the editor a cursor

  await page.getByTestId('coderive').click();
  await page.getByTestId('intent-next-step').click();
  await page.getByTestId('coderive-run').click();

  // Verified candidate is shown ✓ and is insertable; wrong one is ✗ with a counterexample.
  await expect(page.getByText('✓ verified (SymPy)')).toBeVisible();
  await expect(page.getByText('✗ unverified')).toBeVisible();
  await expect(page.getByText(/SymPy counterexample/)).toBeVisible();
  await expect(page.getByText('Insert anyway (unverified)')).toBeVisible();
  // The wrong one cited a non-full-text key → attribution unverified.
  await expect(page.getByText(/attribution unverified/)).toBeVisible();

  // A guard-skipped non-math proposal is disclosed but NOT insertable: it sits in
  // the skipped section with the reason, and offers no button of any kind.
  const skipped = page.getByTestId('coderive-skipped');
  await expect(skipped).toBeVisible();
  await expect(skipped).toContainText('not a maths expression — skipped');
  await expect(skipped).toContainText('bibtex-field');
  await expect(skipped).toContainText('author = {Basset, AB},');
  await expect(skipped.locator('button')).toHaveCount(0);

  // "context used" discloses reference provenance.
  await page.getByText(/context used/).click();
  await expect(page.getByText('full-text')).toBeVisible();

  // Inserting a verified candidate goes through the diff-and-accept flow.
  await page.getByText('Insert (diff)').click();
  await expect(page.getByTestId('diff-accept')).toBeVisible();
});
