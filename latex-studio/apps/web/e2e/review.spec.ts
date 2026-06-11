import { test, expect, type Page, type Route } from '@playwright/test';

/** Hermetic Document Review test: composed findings, honesty surfaced, in-app links. */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Proj', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE = { id: 'f1', projectId: 'p1', path: 'main.tex', encoding: 'utf8', updatedAt: NOW };
const CONTENT = '\\documentclass{article}\n\\begin{document}\n\\section{R}\nThe constant is 3.\n\\begin{align}\nx &= (y+1)^2 \\\\\nx &= y^2+2y+2\n\\end{align}\nA misspeld word.\nWe cite \\cite{ghostref}.\n\\end{document}\n';

const REVIEW = {
  findings: [
    { id: 'm1', axis: 'maths', category: 'algebra', severity: 'error', confidence: 'refuted', file: 'main.tex', lineSpan: { fromLine: 7, toLine: 7 }, message: 'Algebra error: this step is not equal to the previous one.', counterexample: { values: { y: 1 }, lhsVal: 4, rhsVal: 5 } },
    { id: 'l1', axis: 'literature', category: 'constant', severity: 'error', confidence: 'llm-judgement', file: 'main.tex', lineSpan: { fromLine: 4, toLine: 4 }, message: 'The constant 3 contradicts the cited source.', reference: 'cornish2018', quotedSpan: 'the value is 2.5' },
    { id: 'l2', axis: 'literature', category: 'attribution-unverified', severity: 'info', confidence: 'llm-judgement', file: 'main.tex', lineSpan: { fromLine: 10, toLine: 10 }, message: 'Attribution unverified: the source text for [ghostref] is not in the project.', reference: 'ghostref' },
    { id: 'b1', axis: 'background', category: 'identity', severity: 'warning', confidence: 'llm-judgement-low', file: 'main.tex', lineSpan: { fromLine: 4, toLine: 4 }, message: 'This contradicts a standard identity.' },
    { id: 's1', axis: 'prose', category: 'spelling', severity: 'warning', confidence: 'verified-typo', file: 'main.tex', lineSpan: { fromLine: 9, toLine: 9 }, message: 'Possible spelling mistake: "misspeld"', suggestion: 'misspelled', quotedSpan: 'misspeld' },
  ],
  totals: { byAxis: { maths: 1, literature: 2, background: 1, prose: 1 }, bySeverity: { error: 2, warning: 2, info: 1 }, byConfidence: {}, refutedMaths: 1 },
  annotated: true,
  reviewPdfUrl: '/projects/p1/review-pdf?rev=1',
  generatedAt: NOW,
};

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
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE, content: CONTENT });
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/review') return json(route, REVIEW);
    if (method === 'POST' && path === '/synctex/forward') return json(route, { boxes: [] });
    if (method === 'POST' && path === '/projects/p1/chat') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: meta\ndata: {"threadId":"t1"}\n\nevent: done\ndata: {"threadId":"t1","messageId":"x"}\n\n' });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('document review surfaces four-axis findings with the honesty distinction and in-app links', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.getByTestId('review').click();

  // The four axes are present.
  await expect(page.getByText('Algebra error: this step is not equal to the previous one.')).toBeVisible();
  await expect(page.getByText('The constant 3 contradicts the cited source.')).toBeVisible();
  await expect(page.getByText('This contradicts a standard identity.')).toBeVisible();
  await expect(page.getByText('Possible spelling mistake: "misspeld"')).toBeVisible();

  // Machine-verified vs LLM-judgement distinction + the counterexample + reference span.
  await expect(page.getByText('1 algebra error')).toBeVisible();
  await expect(page.getByText(/Counterexample —/)).toBeVisible();
  await expect(page.getByText(/“the value is 2.5”/)).toBeVisible();
  // Attribution unverified, not a contradiction.
  await expect(page.getByText(/Attribution unverified: the source text for \[ghostref\]/)).toBeVisible();
  // The honesty footer (recoloured scheme: green = wrong equation, red = grammar).
  await expect(page.getByText(/Green \(wrong equation, SymPy\) and red \(grammar\/spelling/)).toBeVisible();

  // Clean/Review PDF toggle appears once an annotated review exists.
  await expect(page.getByTestId('pdf-review')).toBeVisible();
  // The one-shot Compile & Check action is offered.
  await expect(page.getByTestId('compile-and-check')).toBeVisible();

  // Filter by axis.
  await page.getByRole('button', { name: 'literature 2' }).click();
  await expect(page.getByText('The constant 3 contradicts the cited source.')).toBeVisible();
  await expect(page.getByText('Algebra error: this step is not equal to the previous one.')).toHaveCount(0);
  await page.getByRole('button', { name: 'literature 2' }).click();

  // "Explain" opens the scoped chat (the in-app error → LLM link).
  await page.getByRole('button', { name: 'Explain' }).first().click();
  await expect(page.getByTestId('toggle-chat')).toHaveAttribute('aria-pressed', 'true');

  // A precise correction (spelling word + suggestion) is offered as Apply, and
  // accepting goes through the approve/reject diff — nothing changes silently.
  const apply = page.getByTestId('apply-correction');
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page.getByTestId('diff-accept')).toBeVisible();
});
