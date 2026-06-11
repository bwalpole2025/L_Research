import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { ModelProvider } from '@latex-studio/shared';
import { buildApp } from '../src/app.js';
import { buildContextCard, buildDocumentModel, collectMacros, symbolGlossary } from '../src/docmodel/build.js';
import { buildCompletionUserPrompt } from '../src/ai/completion/prompts.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

const DOC = [
  '\\documentclass{article}',
  '\\newcommand{\\Bo}{\\mathrm{Bo}}',
  '\\newcommand{\\pdiff}[2]{\\frac{\\partial #1}{\\partial #2}}',
  '\\begin{document}',
  '\\begin{abstract}',
  'We study the multiple-scales expansion of a ferrofluid governed by the Bond number.',
  '\\end{abstract}',
  '\\section{Setup}\\label{sec:setup}',
  'Let $\\rho$ denote the density. Where $\\Bo$ is the Bond number.',
  '\\begin{align}\\label{eq:bo}',
  '\\Bo &= \\frac{\\rho g L^2}{\\gamma} \\\\',
  'x &= \\Bo + 1',
  '\\end{align}',
  '\\end{document}',
].join('\n');

function mockProvider(text: string): ModelProvider {
  return {
    async *chatStream() {
      yield { text };
    },
    async complete() {
      return '';
    },
    async editRegion() {
      return '';
    },
  };
}

describe('DocumentModel — notation + glossary + card', () => {
  const files = [{ path: 'main.tex', content: DOC }];

  it('collects \\newcommand/\\def macros + the project macro table', () => {
    const macros = collectMacros(files, { '\\Pe': '\\mathrm{Pe}' });
    expect(macros['\\Bo']).toBe('\\mathrm{Bo}');
    expect(macros['\\pdiff']).toContain('partial');
    expect(macros['\\Pe']).toBe('\\mathrm{Pe}');
  });

  it('builds a heuristic symbol glossary, marked low-confidence', () => {
    const g = symbolGlossary(files);
    const rho = g.find((e) => e.symbol.includes('rho'));
    const bo = g.find((e) => e.symbol.includes('Bo'));
    expect(rho?.meaning).toMatch(/density/);
    expect(bo?.meaning).toMatch(/Bond number/);
    expect(g.every((e) => e.confidence === 'low')).toBe(true);
  });

  it('distils a budgeted context card with macros, intent, outline, labels and recent steps', () => {
    const model = buildDocumentModel({ files, rootFile: 'main.tex', projectMacros: {}, cursorFile: 'main.tex', cursorLine: 13 });
    const card = buildContextCard(model);
    expect(card).toContain('\\Bo');
    expect(card).toMatch(/multiple-scales/); // abstract / intent
    expect(card).toContain('Setup'); // outline
    expect(card).toMatch(/eq:bo|sec:setup/); // labels
    expect(card).toMatch(/Recent derivation steps/);
    expect(card.length).toBeLessThanOrEqual(3400);
    expect(model.notationSymbols).toContain('\\Bo');
  });

  it('includes the card + position in the inline completion prompt', () => {
    const prompt = buildCompletionUserPrompt({ prefix: 'x ', mode: 'display-align', contextCard: 'Macros: \\Bo=\\mathrm{Bo}', position: 'mid-derivation' });
    expect(prompt).toContain('\\Bo');
    expect(prompt).toContain('mid-derivation');
  });
});

describe('routes /document-model + /predict-next', () => {
  let app: FastifyInstance;
  let projectId: string;
  let fileId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, modelProvider: mockProvider('x &= \\Bo + 2 \\\\') });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `docmodel ${Date.now()}` } });
    projectId = p.json().id;
    const main = (await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth }).then((r) => r.json() as Array<{ id: string; path: string }>)).find((f) => f.path === 'main.tex')!;
    fileId = main.id;
    await app.inject({ method: 'PATCH', url: `/files/${main.id}`, headers: auth, payload: { content: DOC } });
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('document-model returns a card reusing \\Bo and the notation symbols', async () => {
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/document-model`, headers: auth, payload: { cursorFile: 'main.tex', cursorLine: 13 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().card).toContain('\\Bo');
    expect(res.json().notationSymbols).toContain('\\Bo');
    expect(typeof res.json().builtAt).toBe('string');
  });

  it('predict-next (maths) returns a prediction + split steps for SymPy verification', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/predict-next`,
      headers: auth,
      payload: { fileId, cursorLine: 12, granularity: 'maths', card: 'Macros: \\Bo' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe('maths');
    expect((res.json().steps as string[]).length).toBeGreaterThanOrEqual(1);
    expect(res.json().prediction).toContain('\\Bo');
  });
});
