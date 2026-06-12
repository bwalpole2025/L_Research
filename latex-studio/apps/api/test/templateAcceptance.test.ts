import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * TEMPLATE OBJECT ACCEPTANCE, live (real texlive + mathcheck): every template
 * in the diagram editor's catalogue must COMPILE at its defaults — pgfplots
 * surfaces, tikz-3dplot frames, decoration paths and all. The fixtures are
 * generated from the REAL registry + exporter by the web suite
 * (test/diagramTemplates.test.ts writes test/fixtures/template-acceptance.json),
 * so this proves the actual export, not a hand-copied imitation.
 */

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

interface Fixture {
  name: string;
  picture: string;
  packages: string[];
  libraries: string[];
}

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/template-acceptance.json', import.meta.url), 'utf8')) as Fixture[];

describe('template catalogue compiles live (texlive)', () => {
  let app: FastifyInstance;
  let projectId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `templates ${Date.now()}` } });
    projectId = p.json().id;
  });

  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('loaded the generated fixtures (web suite keeps them in sync)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
  });

  for (const fx of fixtures) {
    it(`${fx.name} → PNG`, async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/render-snippet`,
        headers: auth,
        payload: { kind: 'tikz', latex: fx.picture, packages: fx.packages, tikzLibraries: fx.libraries },
      });
      expect(res.statusCode, res.body.slice(0, 800)).toBe(200);
      expect((res.json() as { pngBase64: string }).pngBase64.length).toBeGreaterThan(500);
    }, 180000);
  }
});
