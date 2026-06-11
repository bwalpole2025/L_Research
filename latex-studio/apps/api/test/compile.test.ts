import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { CompileService } from '../src/compile/service.js';
import type { TexliveRunner } from '../src/compile/runner.js';

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

const VIEW_OUTPUT = `SyncTeX result begin
Output:main.pdf
Page:1
x:155.0
y:684.0
h:142.0
v:678.0
W:329.0
H:11.0
SyncTeX result end
`;

/**
 * A mock runner that doesn't shell out to latexmk/synctex. It writes a fixture
 * log + dummy artifacts and returns canned synctex output — exercising the
 * route → service → parser → file-serving path without a TeX install.
 */
describe('compile + synctex routes (mock runner)', () => {
  let app: FastifyInstance;
  let workspace: string;
  let projectId: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ls-compile-'));
    const undefinedLog = readFileSync(
      new URL('./fixtures/undefined-control-sequence.log', import.meta.url),
      'utf8',
    );

    const runner: TexliveRunner = {
      projectDir: (id) => join(workspace, id),
      artifactPath: (id, rel) => join(workspace, id, rel),
      async writeFiles(id) {
        await mkdir(join(workspace, id), { recursive: true });
      },
      async latexmk(id) {
        const dir = join(workspace, id);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'main.log'), undefinedLog, 'utf8');
        await writeFile(join(dir, 'main.pdf'), '%PDF-1.4\n%mock\n', 'utf8');
        await writeFile(join(dir, 'main.synctex.gz'), 'mock', 'utf8');
        return { code: 1, stdout: '', stderr: '', timedOut: false };
      },
      async synctex(id, args) {
        const stdout =
          args[0] === 'view'
            ? VIEW_OUTPUT
            : `SyncTeX result begin\nOutput:main.pdf\nInput:/workspace/${id}/main.tex\nLine:42\nColumn:-1\nSyncTeX result end\n`;
        return { code: 0, stdout, stderr: '', timedOut: false };
      },
    };

    const config = { ...loadConfig(), texliveWorkspace: '/workspace', compileWorkspace: workspace };
    const compileService = new CompileService(config, runner);

    app = await buildApp({ logger: false, config: { bearerToken: TOKEN }, compileService });
    await app.ready();

    const created = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: auth,
      payload: { name: `compile ${Date.now()}` },
    });
    projectId = created.json().id;
  });

  afterAll(async () => {
    if (projectId) {
      await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await app.close();
    await rm(workspace, { recursive: true, force: true });
  });

  it('compiles, returns diagnostics + pdfUrl, and logs the run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/compile`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('error'); // fixture log contains an error
    expect(body.pdfUrl).toMatch(new RegExp(`^/projects/${projectId}/pdf\\?rev=\\d+$`));
    const error = (body.diagnostics as Array<{ severity: string; file?: string; line?: number }>).find(
      (d) => d.severity === 'error',
    );
    expect(error).toMatchObject({ file: 'main.tex', line: 7 });

    const logs = await app.prisma.compileLog.count({ where: { projectId } });
    expect(logs).toBeGreaterThanOrEqual(1);
  });

  it('serves the produced PDF', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/pdf`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.startsWith('%PDF')).toBe(true);
  });

  it('requires auth on the pdf route', async () => {
    const res = await app.inject({ method: 'GET', url: `/projects/${projectId}/pdf` });
    expect(res.statusCode).toBe(401);
  });

  it('forward search returns PDF boxes', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/synctex/forward',
      headers: auth,
      payload: { projectId, file: 'main.tex', line: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.boxes).toHaveLength(1);
    expect(body.boxes[0]).toMatchObject({ page: 1 });
  });

  it('inverse search maps a PDF point back to source file:line', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/synctex/inverse',
      headers: auth,
      payload: { projectId, page: 1, x: 100, y: 200 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ file: 'main.tex', line: 42, column: -1 });
  });
});
