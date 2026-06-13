import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { decryptContent, setContentMasterKey } from '../src/content/crypto.js';
import { contentEncryptionMiddleware } from '../src/content/middleware.js';

/**
 * Proves encryption-at-rest: with the middleware, a RAW DB read (no middleware)
 * sees only ciphertext, while authorised reads/writes see plaintext. Runs
 * against the dev Postgres in a throwaway project that is deleted afterwards.
 */
const MASTER = 'dGVzdC1jb250ZW50LW1hc3Rlci1rZXktZm9yLXVuaXQtdGVzdHM=';
const SENTINEL = 'SENTINEL-PLAINTEXT-XYZ';
const PLAINTEXT = `\\section{Secret thesis}\nThe Bond number is $\\Bo$. ${SENTINEL}`;

describe('content encryption at rest', () => {
  let enc: PrismaClient; // with the encryption middleware
  let raw: PrismaClient; // without — sees what the DB actually stores
  let projectId: string;

  beforeAll(async () => {
    setContentMasterKey(MASTER);
    enc = new PrismaClient();
    enc.$use(contentEncryptionMiddleware(enc));
    raw = new PrismaClient();
    const p = await enc.project.create({ data: { name: `ztmp-enc ${Date.now()}`, rootFile: 'main.tex' } });
    projectId = p.id;
  });

  afterAll(async () => {
    if (projectId) await enc.project.delete({ where: { id: projectId } }).catch(() => undefined);
    await enc.$disconnect();
    await raw.$disconnect();
  });

  it('TexFile.content: ciphertext at rest, plaintext via the API (all select shapes)', async () => {
    const created = await enc.texFile.create({ data: { projectId, path: 'main.tex', content: PLAINTEXT } });
    expect(created.content).toBe(PLAINTEXT); // write returns decrypted

    const rawRow = await raw.texFile.findUnique({ where: { id: created.id } });
    expect(rawRow!.content.startsWith('enc:1:')).toBe(true);
    expect(rawRow!.content).not.toContain(SENTINEL);
    expect(rawRow!.content).not.toContain('Bond number');

    // Authorised reads decrypt, for every select shape the app uses.
    expect((await enc.texFile.findUnique({ where: { id: created.id } }))!.content).toBe(PLAINTEXT);
    expect((await enc.texFile.findUnique({ where: { id: created.id }, select: { content: true } }))!.content).toBe(PLAINTEXT);
    const sel = await enc.texFile.findMany({ where: { projectId }, select: { path: true, content: true, encoding: true } });
    expect(sel[0]!.content).toBe(PLAINTEXT);
    // Forced-in projectId must be stripped so callers see no surprise field.
    expect((sel[0] as Record<string, unknown>).projectId).toBeUndefined();

    // Update by id (projectId resolved via lookup) re-encrypts.
    const updated = await enc.texFile.update({ where: { id: created.id }, data: { content: `${PLAINTEXT} v2` } });
    expect(updated.content).toBe(`${PLAINTEXT} v2`);
    const rawRow2 = await raw.texFile.findUnique({ where: { id: created.id } });
    expect(rawRow2!.content.startsWith('enc:1:')).toBe(true);
    expect(rawRow2!.content).not.toContain(SENTINEL);

    // upsert path (used by run/diagram imports).
    const up = await enc.texFile.upsert({
      where: { projectId_path: { projectId, path: 'figs/a.tex' } },
      create: { projectId, path: 'figs/a.tex', content: PLAINTEXT },
      update: { content: PLAINTEXT },
    });
    expect(up.content).toBe(PLAINTEXT);
    expect((await raw.texFile.findUnique({ where: { id: up.id } }))!.content.startsWith('enc:1:')).toBe(true);
  });

  it('Snapshot.files: ciphertext at rest, plaintext via the API', async () => {
    const files = [{ id: 'x', projectId, path: 'main.tex', content: PLAINTEXT, encoding: 'utf8', updatedAt: new Date().toISOString() }];
    const snap = await enc.snapshot.create({ data: { projectId, label: 'L', files } });
    expect((snap.files as Array<{ content: string }>)[0]!.content).toBe(PLAINTEXT);

    const rawSnap = await raw.snapshot.findUnique({ where: { id: snap.id } });
    expect(JSON.stringify(rawSnap!.files)).not.toContain(SENTINEL);
    expect(JSON.stringify(rawSnap!.files)).toContain('_enc');

    const readSnap = await enc.snapshot.findUnique({ where: { id: snap.id } });
    expect((readSnap!.files as Array<{ content: string }>)[0]!.content).toBe(PLAINTEXT);
  });

  it("ciphertext is bound to its project (AAD) — cross-project decrypt fails", async () => {
    const row = await raw.texFile.findFirst({ where: { projectId } });
    expect(() => decryptContent('some-other-project-id', row!.content)).toThrow();
  });
});
