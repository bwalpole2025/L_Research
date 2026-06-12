import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

/**
 * Python "Run" plumbing — streaming, timeout, stop, figure capture, the directive
 * parser, run-target resolution, and settings. Runs in PYRUN_MODE=local (host
 * python3, stdlib only) so it exercises the manager without building the sandbox
 * image; the docker path is verified manually (ADR-013).
 */

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };
// 1x1 transparent PNG.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

interface SseEvent {
  event: string;
  data: Record<string, unknown>;
}
function parseSse(payload: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of payload.split('\n\n')) {
    const event = /event: (.*)/.exec(block)?.[1];
    const dataLine = /data: (.*)/.exec(block)?.[1];
    if (event && dataLine !== undefined) {
      try {
        out.push({ event, data: JSON.parse(dataLine) as Record<string, unknown> });
      } catch {
        /* ignore */
      }
    }
  }
  return out;
}

describe('Python Run (sandboxed execution, local mode)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let workspace: string;

  const addFile = (path: string, content: string, encoding?: 'utf8' | 'base64') =>
    app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path, content, ...(encoding ? { encoding } : {}) } });

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN, pyrunMode: 'local', pyrunTimeoutMs: 2500 } });
    await app.ready();
    workspace = app.config.compileWorkspace;
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `pyrun ${Date.now()}` } });
    projectId = p.json().id as string;
  });

  afterAll(async () => {
    if (projectId) {
      await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
      await rm(join(workspace, projectId), { recursive: true, force: true }).catch(() => undefined);
    }
    await app.close();
  });

  it('streams stdout/stderr and finishes with a success status', async () => {
    await addFile('hello.py', 'import sys\nprint("hello from python")\nprint("a warning", file=sys.stderr)\n');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: { path: 'hello.py' } });
    const events = parseSse(res.payload);

    expect(events[0]?.event).toBe('start');
    const stdout = events.filter((e) => e.event === 'stdout').map((e) => e.data.chunk).join('');
    const stderr = events.filter((e) => e.event === 'stderr').map((e) => e.data.chunk).join('');
    expect(stdout).toContain('hello from python');
    expect(stderr).toContain('a warning');

    const done = events.find((e) => e.event === 'done')!;
    expect(done.data.status).toBe('success');
    expect(done.data.exitCode).toBe(0);
    expect(typeof done.data.durationMs).toBe('number');
  });

  it('kills an infinite loop at the timeout and reports timed-out', async () => {
    await addFile('loop.py', 'import time\nwhile True:\n    time.sleep(0.05)\n');
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: { path: 'loop.py' } });
    const done = parseSse(res.payload).find((e) => e.event === 'done')!;
    expect(done.data.status).toBe('timed-out');
  }, 10000);

  it('stops a running script when asked', async () => {
    await addFile('slow.py', 'import time\nfor i in range(100):\n    print(i, flush=True)\n    time.sleep(0.05)\n');
    const runP = app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: { path: 'slow.py' } });
    await new Promise((r) => setTimeout(r, 400));
    const stop = await app.inject({ method: 'POST', url: `/projects/${projectId}/run/stop`, headers: auth });
    expect(stop.json().stopped).toBe(true);
    const done = parseSse((await runP).payload).find((e) => e.event === 'done')!;
    expect(done.data.status).toBe('stopped');
  }, 10000);

  it('captures a figure into the project and serves it as an artefact', async () => {
    await addFile('plot.py', `import base64, os\nos.makedirs("figures", exist_ok=True)\nopen("figures/out.png", "wb").write(base64.b64decode("${PNG_B64}"))\nprint("wrote figure")\n`);
    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: { path: 'plot.py' } });
    const done = parseSse(res.payload).find((e) => e.event === 'done')!;
    expect(done.data.status).toBe('success');
    const artifacts = done.data.artifacts as Array<{ path: string; kind: string; url: string }>;
    const fig = artifacts.find((a) => a.path === 'figures/out.png');
    expect(fig?.kind).toBe('figure');

    // Imported into the project (so plain Compile sees it).
    const files = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth }).then((r) => r.json() as Array<{ path: string }>);
    expect(files.some((f) => f.path === 'figures/out.png')).toBe(true);

    // Served from the workspace.
    const art = await app.inject({ method: 'GET', url: `/projects/${projectId}/run-artifact?path=figures/out.png`, headers: auth });
    expect(art.statusCode).toBe(200);
    expect(art.headers['content-type']).toBe('image/png');
  });

  it('rejects a non-.py target and path traversal', async () => {
    await addFile('main.tex', '\\documentclass{article}\\begin{document}x\\end{document}');
    const bad = await app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: { path: 'main.tex' } });
    expect(bad.statusCode).toBe(400);
    const traverse = await app.inject({ method: 'GET', url: `/projects/${projectId}/run-artifact?path=../../etc/passwd`, headers: auth });
    expect(traverse.statusCode).toBe(400);
  });

  it('parses the % !py figure-link directive', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/files/${(await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth }).then((r) => (r.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!)).id}`,
      headers: auth,
      payload: { content: 'intro\n% !py plot.py -> figures/out.png\n\\includegraphics{figures/out.png}\n' },
    });
    const links = await app.inject({ method: 'GET', url: `/projects/${projectId}/pyfigures`, headers: auth }).then((r) => r.json() as { links: Array<{ script: string; output: string }> });
    expect(links.links).toContainEqual({ script: 'plot.py', output: 'figures/out.png' });
  });

  it('runs the project run target when no file is given, and round-trips run settings', async () => {
    const patched = await app.inject({ method: 'PATCH', url: `/projects/${projectId}`, headers: auth, payload: { pythonRunTarget: 'hello.py', networkEnabled: true } });
    expect(patched.json().pythonRunTarget).toBe('hello.py');
    expect(patched.json().networkEnabled).toBe(true);

    const res = await app.inject({ method: 'POST', url: `/projects/${projectId}/run`, headers: auth, payload: {} });
    const events = parseSse(res.payload);
    expect((events.find((e) => e.event === 'start')!.data as { script: string }).script).toBe('hello.py');
    expect(events.find((e) => e.event === 'done')!.data.status).toBe('success');
  });
});
