import { inflateRawSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createZip } from '../src/lib/zip.js';

/** Minimal sequential local-header reader → { name: Buffer }. Proves the archive
 *  is structurally valid and round-trips without an external unzip. */
function readZip(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extraLen;
    const comp = buf.subarray(start, start + compSize);
    out[name] = method === 8 ? inflateRawSync(comp) : Buffer.from(comp);
    i = start + compSize;
  }
  return out;
}

describe('createZip', () => {
  it('round-trips text + binary entries and ends with a valid EOCD', () => {
    const big = Buffer.from('compress me '.repeat(500)); // deflate path
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]); // tiny binary
    const zip = createZip([
      { name: 'main.tex', data: Buffer.from('\\documentclass{article}\n') },
      { name: 'chapters/intro.tex', data: big },
      { name: 'figures/a.png', data: png },
    ]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50); // EOCD signature
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(3); // total entries
    const files = readZip(zip);
    expect(files['main.tex']!.toString()).toContain('documentclass');
    expect(files['chapters/intro.tex']!.equals(big)).toBe(true);
    expect(files['figures/a.png']!.equals(png)).toBe(true);
  });
});

const TOKEN = 'test-token';
const auth = { authorization: `Bearer ${TOKEN}` };

describe('project export (live route)', () => {
  let app: FastifyInstance;
  let projectId: string;
  let mainId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false, config: { bearerToken: TOKEN } });
    await app.ready();
    const p = await app.inject({ method: 'POST', url: '/projects', headers: auth, payload: { name: `Export Me ${Date.now()}` } });
    projectId = p.json().id;
    const files = await app.inject({ method: 'GET', url: `/projects/${projectId}/files`, headers: auth });
    mainId = (files.json() as Array<{ id: string; path: string }>).find((f) => f.path === 'main.tex')!.id;
    await app.inject({ method: 'PATCH', url: `/files/${mainId}`, headers: auth, payload: { content: '\\documentclass{article}\n\\begin{document}\nHello $x^2$.\n\\end{document}\n' } });
    await app.inject({ method: 'POST', url: `/projects/${projectId}/files`, headers: auth, payload: { path: 'refs.bib', content: '@article{a,title={T}}\n' } });
  });
  afterAll(async () => {
    if (projectId) await app.prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await app.close();
  });

  it('exports the source tree as an openable .zip', async () => {
    const r = await app.inject({ method: 'GET', url: `/projects/${projectId}/export`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/zip');
    expect(String(r.headers['content-disposition'])).toContain('.zip');
    const files = readZip(r.rawPayload);
    expect(Object.keys(files)).toContain('main.tex');
    expect(Object.keys(files)).toContain('refs.bib');
    expect(files['main.tex']!.toString()).toContain('Hello');
  }, 60000);

  it('?pdf=1 includes the compiled PDF once it exists', async () => {
    await app.inject({ method: 'POST', url: `/projects/${projectId}/compile`, headers: auth }); // produce main.pdf
    const r = await app.inject({ method: 'GET', url: `/projects/${projectId}/export?pdf=1`, headers: auth });
    const files = readZip(r.rawPayload);
    expect(Object.keys(files)).toContain('main.pdf');
    expect(files['main.pdf']!.subarray(0, 5).toString()).toContain('%PDF');
  }, 120000);
});
