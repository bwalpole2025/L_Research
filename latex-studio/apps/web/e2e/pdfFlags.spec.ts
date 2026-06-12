import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * PDF ISSUE HIGHLIGHTS — everything that isn't right in the compiled PDF gets
 * a persistent highlight: ORANGE for important warnings, YELLOW for minor
 * ones, VIOLET for equations the co-derive verified maths checker flagged.
 * Locations come from SyncTeX forward search; a toolbar toggle hides them;
 * clicking one opens the matching panel and jumps to the source line.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'm', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const MAIN = Array.from({ length: 12 }, (_, i) => (i === 0 ? '\\documentclass{article}' : i === 1 ? '\\begin{document}' : i === 11 ? '\\end{document}' : `Line ${i + 1}.`)).join('\n');

const DIAGS = [
  {
    severity: 'warning-important',
    category: 'undefined-reference',
    message: "Reference `eq:ghost' undefined",
    file: 'main.tex',
    line: 7,
    rawExcerpt: "LaTeX Warning: Reference `eq:ghost' undefined on input line 7.",
  },
  {
    severity: 'warning-minor',
    category: 'overfull-box',
    message: 'Overfull box (worst 12pt too wide) — 1 occurrence',
    file: 'main.tex',
    line: 9,
    count: 1,
    rawExcerpt: 'Overfull \\hbox (12pt too wide) in paragraph at lines 9--9',
  },
];

const AUDIT = {
  blocks: [
    {
      id: 'b1',
      file: 'main.tex',
      lineStart: 5,
      lineEnd: 5,
      verdict: 'failing',
      latex: 'E = mc^3',
      message: 'Counterexample: m=1, c=2 gives 8, expected 4.',
    },
  ],
  totals: { failing: 1, unknown: 0, passed: 0, checked: 1, cached: 0 },
  byFile: { 'main.tex': 1 },
};

/** A minimal but VALID one-page PDF (real xref offsets) so pdf.js renders it. */
function makeMinimalPdf(): Buffer {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  const add = (body: string) => {
    offsets.push(out.length);
    out += body;
  };
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n');
  const stream = 'q Q\n';
  add(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  const xrefPos = out.length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

interface Captured {
  forwardLines: number[];
}

async function mockApi(page: Page, cap: Captured) {
  const pdf = makeMinimalPdf();
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
      return json(route, { status: 'success', diagnostics: DIAGS, durationMs: 700, log: 'ok', pdfUrl: '/projects/p1/pdf' });
    }
    if (method === 'GET' && path === '/projects/p1/pdf') {
      return route.fulfill({ status: 200, contentType: 'application/pdf', body: pdf });
    }
    if (method === 'POST' && path === '/synctex/forward') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { line: number };
      cap.forwardLines.push(body.line);
      // One box per request, vertically placed by source line.
      return json(route, { boxes: [{ page: 1, x: 72, y: 60 + body.line * 40, width: 320, height: 14 }] });
    }
    if (method === 'POST' && path === '/projects/p1/audit-maths') return json(route, AUDIT);
    if (method === 'PATCH' && path === '/files/f1') return json(route, { content: '' });
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('orange + yellow highlights appear over the compiled PDF, toggle off/on, click jumps to Problems', async ({ page }) => {
  const cap: Captured = { forwardLines: [] };
  await mockApi(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+Enter'); // Compile
  await expect(page.locator('[data-testid="pdf-scroll"] canvas').first()).toBeVisible();

  // Both warnings got highlighted at their SyncTeX boxes — orange AND yellow.
  const flags = page.locator('[data-testid="pdf-flag"]');
  await expect(flags).toHaveCount(2);
  await expect(page.locator('[data-testid="pdf-flag"][data-severity="warning-important"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="pdf-flag"][data-severity="warning-minor"]')).toHaveCount(1);
  expect(cap.forwardLines.sort()).toEqual([7, 9]);

  // The tooltip carries the message and source line.
  await expect(page.locator('[data-testid="pdf-flag"][data-severity="warning-important"]')).toHaveAttribute(
    'title',
    /Reference `eq:ghost' undefined[\s\S]*main\.tex:7/,
  );

  // Toolbar toggle: hide, then show again.
  await expect(page.getByTestId('pdf-flags-count')).toHaveText('2');
  await page.getByTestId('pdf-flags-toggle').click();
  await expect(flags).toHaveCount(0);
  await page.getByTestId('pdf-flags-toggle').click();
  await expect(flags).toHaveCount(2);

  // Clicking the orange highlight opens Problems and reveals the entry.
  await page.locator('[data-testid="pdf-flag"][data-severity="warning-important"]').click();
  await expect(page.getByTestId('diag-warning-important').first()).toBeVisible();
});

test('the co-derive verified maths checker adds violet flags for failing equations', async ({ page }) => {
  const cap: Captured = { forwardLines: [] };
  await mockApi(page, cap);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('[data-testid="pdf-flag"]')).toHaveCount(2);

  // Run the audit from the Tools menu.
  await page.getByTestId('tools-menu').click();
  await page.getByTestId('audit-maths').click();

  const checker = page.locator('[data-testid="pdf-flag"][data-severity="checker"]');
  await expect(checker).toHaveCount(1);
  await expect(checker).toHaveAttribute('title', /Maths checker \(failing\)[\s\S]*Counterexample/);
  await expect(page.getByTestId('pdf-flags-count')).toHaveText('3');

  // A fresh compile clears stale checker positions (lines may have moved).
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(checker).toHaveCount(0);
  await expect(page.locator('[data-testid="pdf-flag"]')).toHaveCount(2);
});
