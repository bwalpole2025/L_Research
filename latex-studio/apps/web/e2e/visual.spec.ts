import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Code ⇄ Visual toggle: the same document edited in two views. Visual renders
 * headings/prose/maths (KaTeX) and IS AN EDITOR — typing in a paragraph writes
 * LaTeX back to the source (chips preserved verbatim); equations edit in place.
 */

const NOW = '2024-01-01T00:00:00.000Z';
const PROJECT = { id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: NOW, updatedAt: NOW, model: 'claude-sonnet-4-6', aiInstructions: '' };
const FILE_META = { id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: NOW };
const BIB_META = { id: 'f2', projectId: 'p1', path: 'refs.bib', updatedAt: NOW };
const BIB = '@article{cornish2018,\n  author = {Cornish, A.},\n  title = {Multiple scales},\n  year = {2018}\n}';
const MAIN = [
  '\\documentclass{article}',
  '\\begin{document}',
  '\\section{Setup}',
  'Prose with maths $a^2+b^2$ and a cite \\citep{basset1888} here.',
  '',
  '\\begin{equation}',
  'e^{i\\pi} = -1',
  '\\end{equation}',
  '\\end{document}',
].join('\n');

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const GHOST = 'GHOST_VISUAL_SUGGESTION';

async function mockApi(page: Page, state: { patches: string[] }) {
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (method === 'GET' && path === '/projects') return json(route, [PROJECT]);
    if (method === 'GET' && path === '/projects/p1/files') return json(route, [FILE_META, BIB_META]);
    if (method === 'GET' && path === '/projects/p1/snapshots') return json(route, []);
    if (method === 'GET' && path === '/files/f1') return json(route, { ...FILE_META, content: MAIN });
    if (method === 'GET' && path === '/files/f2') return json(route, { ...BIB_META, content: BIB });
    if (method === 'GET' && path === '/ai/status') return json(route, { available: true });
    if (method === 'POST' && path === '/projects/p1/complete') {
      return json(route, { completion: ` ${GHOST}`, latencyMs: 5, variant: 'warm', provider: 'mock', model: 'm' });
    }
    if (method === 'PATCH' && path === '/files/f1') {
      state.patches.push(JSON.parse(route.request().postData() ?? '{}').content ?? '');
      return json(route, { content: '' });
    }
    return json(route, { error: `unmocked ${method} ${path}` }, 404);
  });
}

test('the toggle switches between Code and Visual; Visual renders the document', async ({ page }) => {
  await mockApi(page, { patches: [] });
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();

  // Toggle exists; Code is active by default.
  await expect(page.getByTestId('view-code')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('view-visual').click();
  const visual = page.getByTestId('visual-view');
  await expect(visual).toBeVisible();
  await expect(page.locator('.cm-content')).toHaveCount(0); // code hidden

  // Rendered: heading text, typeset maths (block + inline chip), cite badge.
  await expect(page.getByTestId('vv-heading')).toContainText('Setup');
  await expect(page.getByTestId('vv-math').locator('.katex')).toBeVisible();
  await expect(page.getByTestId('vv-para').locator('.vv-badge')).toContainText('basset1888');

  // Back to Code.
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await expect(page.getByTestId('visual-view')).toHaveCount(0);
});

test('editing prose in Visual writes LaTeX back — maths and cite chips preserved verbatim', async ({ page }) => {
  const state = { patches: [] as string[] };
  await mockApi(page, state);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  // Place the caret at the very start of the paragraph's text and type.
  const para = page.getByTestId('vv-para');
  await para.evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.type('EDITED ');
  await page.getByTestId('vv-heading').click(); // blur the paragraph

  // The source (visible after toggling back to Code) carries the edit AND the
  // untouched LaTeX constructs.
  await page.getByTestId('view-code').click();
  const code = page.locator('.cm-content');
  await expect(code).toContainText('EDITED Prose with maths');
  await expect(code).toContainText('$a^2+b^2$'); // chip survived verbatim
  await expect(code).toContainText('\\citep{basset1888}'); // chip survived verbatim

  // And it autosaves through the normal path.
  await expect.poll(() => state.patches.length, { timeout: 5000 }).toBeGreaterThan(0);
  expect(state.patches.at(-1)).toContain('EDITED Prose');
});

test('an equation edits in place with a live preview and writes back into its environment', async ({ page }) => {
  const state = { patches: [] as string[] };
  await mockApi(page, state);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  await page.getByTestId('vv-math').click();
  const input = page.getByTestId('vv-math-input');
  await expect(input).toBeVisible();
  await input.fill('e^{i\\pi} + 1 = 0');
  // No Apply button: clicking away commits, exactly like prose.
  await page.getByTestId('vv-heading').click();

  // Still rendered (updated), and the source got the new step inside the env.
  await expect(page.getByTestId('vv-math').locator('.katex')).toBeVisible();
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).toContainText('e^{i\\pi} + 1 = 0');
  await expect(page.locator('.cm-content')).toContainText('\\begin{equation}');
  await expect(page.locator('.cm-content')).toContainText('\\end{equation}');

  // Esc reverts: junk typed then Escape leaves the source untouched.
  await page.getByTestId('view-visual').click();
  await page.getByTestId('vv-math').click();
  await page.getByTestId('vv-math-input').fill('JUNK');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vv-math-input')).toHaveCount(0);
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).not.toContainText('JUNK');
  await expect(page.locator('.cm-content')).toContainText('e^{i\\pi} + 1 = 0');
});

test('predictive ghost text works in the Visual editor: appears while typing, Tab accepts into the source, Escape dismisses', async ({ page }) => {
  const state = { patches: [] as string[] };
  await mockApi(page, state);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  // Type at the start of the paragraph → a dimmed ghost suggestion appears.
  const para = page.getByTestId('vv-para');
  await para.evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.keyboard.type('Typed');
  const ghost = para.locator('.vv-ghost');
  await expect(ghost).toBeVisible();
  await expect(ghost).toContainText(GHOST);

  // ESCAPE rejects: the ghost vanishes and the text never reaches the source.
  await page.keyboard.press('Escape');
  await expect(para.locator('.vv-ghost')).toHaveCount(0);

  // Type again → ghost returns; TAB accepts it as real text.
  await page.keyboard.type(' more');
  await expect(para.locator('.vv-ghost')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(para.locator('.vv-ghost')).toHaveCount(0);
  await expect(para).toContainText(GHOST);

  // The accepted text commits through the normal write-back path…
  await page.getByTestId('vv-heading').click(); // blur
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).toContainText(GHOST);
  // …and the maths/cite chips survived untouched.
  await expect(page.locator('.cm-content')).toContainText('$a^2+b^2$');
  await expect.poll(() => state.patches.length, { timeout: 5000 }).toBeGreaterThan(0);
  expect(state.patches.at(-1)).toContain(GHOST);
});

test('predictive CODING works in the Visual editor: \\ commands and \\cite keys complete from a dropdown; the ghost yields', async ({ page }) => {
  const state = { patches: [] as string[] };
  await mockApi(page, state);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  // Caret at the start of the paragraph.
  const para = page.getByTestId('vv-para');
  await para.evaluate((el) => {
    (el as HTMLElement).focus();
    const range = document.createRange();
    range.setStart(el.firstChild!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });

  // `\alp` → deterministic command dropdown; while it is open the AI ghost stays away.
  await page.keyboard.type('\\alp');
  const dropdown = page.getByTestId('vv-ac');
  await expect(dropdown).toBeVisible();
  await expect(dropdown).toContainText('\\alpha');
  await page.waitForTimeout(600); // past the ghost debounce — it must NOT appear
  await expect(para.locator('.vv-ghost')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(dropdown).toHaveCount(0);

  // `\cite{` → bib keys from the project's .bib; Enter accepts and closes the brace.
  await page.keyboard.type(' \\cite{corn');
  await expect(page.getByTestId('vv-ac')).toBeVisible();
  await expect(page.getByTestId('vv-ac')).toContainText('cornish2018');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('vv-ac')).toHaveCount(0);

  // Both completions reach the LaTeX source through the normal write-back.
  await page.getByTestId('vv-heading').click(); // blur commits
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).toContainText('\\alpha');
  await expect(page.locator('.cm-content')).toContainText('\\cite{cornish2018}');
});

test('the equation editor grows to fit its content — no inner scrolling in any direction', async ({ page }) => {
  await mockApi(page, { patches: [] });
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  await page.getByTestId('vv-math').click();
  const input = page.getByTestId('vv-math-input');
  await expect(input).toBeVisible();

  // Many rows plus one very long wrapped line — the box must fit all of it.
  const long = [
    ...Array.from({ length: 8 }, (_, i) => `x_{${i}} &= y_{${i}} + z_{${i}} \\\\`),
    `w &= ${Array.from({ length: 30 }, (_, i) => `\\alpha_{${i}}`).join(' + ')}`,
  ].join('\n');
  await input.fill(long);

  const fits = await input.evaluate(
    (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
  );
  expect(fits).toBe(true);
  await page.keyboard.press('Escape');
});

test('an INLINE equation chip edits in place: click → input, Enter commits, Escape reverts', async ({ page }) => {
  const state = { patches: [] as string[] };
  await mockApi(page, state);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  // Click the inline maths chip → an in-place input holding its raw LaTeX.
  await page.getByTestId('vv-para').locator('.vv-math').click();
  const input = page.getByTestId('vv-chip-input');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('a^2+b^2');
  await input.fill('a^2+b^2+c^2');
  await page.keyboard.press('Enter');

  // The chip re-renders as maths and the edit reached the LaTeX source.
  await expect(page.getByTestId('vv-para').locator('.vv-math .katex')).toBeVisible();
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).toContainText('$a^2+b^2+c^2$');

  // Escape reverts without touching the source.
  await page.getByTestId('view-visual').click();
  await page.getByTestId('vv-para').locator('.vv-math').click();
  await page.getByTestId('vv-chip-input').fill('JUNK');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vv-chip-input')).toHaveCount(0);
  await page.getByTestId('view-code').click();
  await expect(page.locator('.cm-content')).not.toContainText('JUNK');
  await expect(page.locator('.cm-content')).toContainText('$a^2+b^2+c^2$');
});

test('semi-compiled: a TikZ diagram renders as a compiled image; unknown-macro maths falls back to the TeX engine', async ({ page }) => {
  const PNG64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAI/AL+Xt1WqAAAAABJRU5ErkJggg==';
  const renders: string[] = [];
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const TIKZ_MAIN = [
      '\\documentclass{article}',
      '\\begin{document}',
      'Prose.',
      '\\begin{tikzpicture}',
      '\\draw (0,0) -- (1,1);',
      '\\end{tikzpicture}',
      '\\begin{equation}',
      '\\unknownjournalmacro{x} = 1',
      '\\end{equation}',
      '\\end{document}',
    ].join('\n');
    if (method === 'GET' && path === '/projects') return route.fulfill({ json: [{ id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', model: 'm', aiInstructions: '' }] });
    if (method === 'GET' && path === '/projects/p1/files') return route.fulfill({ json: [{ id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: '2024-01-01T00:00:00.000Z' }] });
    if (method === 'GET' && path === '/projects/p1/snapshots') return route.fulfill({ json: [] });
    if (method === 'GET' && path === '/files/f1') return route.fulfill({ json: { id: 'f1', path: 'main.tex', content: TIKZ_MAIN } });
    if (method === 'GET' && path === '/ai/status') return route.fulfill({ json: { available: true } });
    if (method === 'POST' && path === '/projects/p1/render-snippet') {
      renders.push((JSON.parse(route.request().postData() ?? '{}') as { kind: string }).kind);
      return route.fulfill({ json: { pngBase64: PNG64, width: 420, height: 64, cached: false } });
    }
    if (method === 'PATCH' && path === '/files/f1') return route.fulfill({ json: { content: '' } });
    return route.fulfill({ status: 404, json: { error: `unmocked ${method} ${path}` } });
  });

  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  // The TikZ block compiles to an image (semi-compiled diagram).
  const tikz = page.getByTestId('vv-tikz');
  await expect(tikz).toBeVisible();
  await expect(tikz.locator('img')).toBeVisible();

  // The equation with an unknown journal macro falls back to the TeX engine.
  await expect(page.getByTestId('vv-math')).toHaveAttribute('data-semicompiled', 'true');
  await expect(page.getByTestId('vv-math').locator('img')).toBeVisible();

  // Both kinds went through the snippet renderer.
  expect(renders.sort()).toEqual(['math', 'tikz']);
});

test('predictive coding works in the EQUATION editor: \\ commands complete inside the maths textarea', async ({ page }) => {
  const state = { patches: [] as string[] };
  await mockApi(page, state);
  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  // Open the centred equation for editing and type a command prefix.
  await page.getByTestId('vv-math').click();
  const input = page.getByTestId('vv-math-input');
  await expect(input).toBeVisible();
  await input.fill('x = ');
  await page.keyboard.type('\\fr');

  const dropdown = page.getByTestId('vv-ac');
  await expect(dropdown).toBeVisible();
  await expect(dropdown).toContainText('\\frac');
  await page.keyboard.press('Tab');
  await expect(dropdown).toHaveCount(0);
  await expect(input).toHaveValue('x = \\frac{}{}');

  // First Escape only closed nothing (dropdown already gone) — it reverts the editor.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('vv-math-input')).toHaveCount(0);
});

test('INLINE maths with a custom macro upgrades to a TeX-engine image; bare commands render as maths, not code', async ({ page }) => {
  const PNG64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAI/AL+Xt1WqAAAAABJRU5ErkJggg==';
  const bodies: Array<{ kind: string; inline?: boolean; latex: string }> = [];
  await page.addInitScript(() => window.localStorage.setItem('latex-studio:compileOnSave', 'false'));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const INLINE_MAIN = [
      '\\documentclass{article}',
      '\\begin{document}',
      'Flow has $\\unknownjournalmacro{u} = 0$ and vorticity \\omega here.',
      '\\end{document}',
    ].join('\n');
    if (method === 'GET' && path === '/projects') return route.fulfill({ json: [{ id: 'p1', name: 'Demo', rootFile: 'main.tex', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', model: 'm', aiInstructions: '' }] });
    if (method === 'GET' && path === '/projects/p1/files') return route.fulfill({ json: [{ id: 'f1', projectId: 'p1', path: 'main.tex', updatedAt: '2024-01-01T00:00:00.000Z' }] });
    if (method === 'GET' && path === '/projects/p1/snapshots') return route.fulfill({ json: [] });
    if (method === 'GET' && path === '/files/f1') return route.fulfill({ json: { id: 'f1', path: 'main.tex', content: INLINE_MAIN } });
    if (method === 'GET' && path === '/ai/status') return route.fulfill({ json: { available: true } });
    if (method === 'POST' && path === '/projects/p1/render-snippet') {
      bodies.push(JSON.parse(route.request().postData() ?? '{}') as { kind: string; inline?: boolean; latex: string });
      // The FIRST render fails (transient hiccup): the chip must retry and
      // recover — a failure is never cached for the session.
      if (bodies.length === 1) return route.fulfill({ status: 502, json: { error: 'transient' } });
      return route.fulfill({ json: { pngBase64: PNG64, width: 60, height: 38, cached: false } });
    }
    if (method === 'PATCH' && path === '/files/f1') return route.fulfill({ json: { content: '' } });
    return route.fulfill({ status: 404, json: { error: `unmocked ${method} ${path}` } });
  });

  await page.goto('/studio');
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByTestId('view-visual').click();

  const chips = page.getByTestId('vv-para').locator('span.vv-math');
  // The $…$ chip KaTeX cannot render upgrades to a real TeX-engine image —
  // surviving one failed attempt on the way (retry, not a session-poisoned cache).
  await expect(chips.nth(0).locator('img.vv-snippet')).toBeVisible({ timeout: 15000 });
  // …keeping its source verbatim for the editable round-trip.
  await expect(chips.nth(0)).toHaveAttribute('data-tex', '$\\unknownjournalmacro{u} = 0$');
  expect(bodies.length).toBeGreaterThanOrEqual(2); // failed once, retried
  expect(bodies.every((b) => b.kind === 'math' && b.inline === true && b.latex === '\\unknownjournalmacro{u} = 0')).toBe(true);
  // A bare command in prose is typeset as maths (KaTeX), not as a code chip.
  await expect(chips.nth(1).locator('.katex')).toBeVisible();
  await expect(chips.nth(1)).toHaveAttribute('data-tex', '\\omega');
});
