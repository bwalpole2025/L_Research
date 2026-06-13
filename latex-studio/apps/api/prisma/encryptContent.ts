import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/config.js';
import { resolveMasterKey } from '../src/vault/keystore.js';
import { decryptContent, encryptContent, isEncrypted, setContentMasterKey } from '../src/content/crypto.js';

/**
 * One-time migration: encrypt existing TexFile.content + Snapshot.files in place,
 * using the SAME master key the running API uses (so the app keeps reading them).
 *
 *   pnpm db:encrypt-content            # encrypt every still-plaintext row (idempotent)
 *   pnpm db:encrypt-content -- --decrypt   # reverse (emergency rollback)
 *   pnpm db:encrypt-content -- --dry        # report only, write nothing
 *
 * Uses a RAW PrismaClient (no encryption middleware) so it reads the stored
 * bytes directly and writes the transformed bytes directly. Idempotent: rows
 * already in the target state are skipped.
 */

const SNAPSHOT_ENC_KEY = '_enc';
const BATCH = 500;

function isWrappedSnapshot(files: unknown): files is { _enc: string } {
  return !!files && typeof files === 'object' && !Array.isArray(files) && SNAPSHOT_ENC_KEY in (files as object);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const decrypt = args.has('--decrypt');
  const dry = args.has('--dry');

  const config = loadConfig();
  const { key, source } = await resolveMasterKey(config);
  setContentMasterKey(key);
  const prisma = new PrismaClient();
  const mode = decrypt ? 'DECRYPT' : 'ENCRYPT';
  console.log(`[${mode}] master key source: ${source}${dry ? ' (dry run)' : ''}`);

  let texDone = 0;
  let texSkip = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.texFile.findMany({
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true, projectId: true, content: true },
    });
    if (rows.length === 0) break;
    for (const r of rows) {
      const encrypted = isEncrypted(r.content);
      if (decrypt ? !encrypted : encrypted) {
        texSkip += 1;
        continue;
      }
      const next = decrypt ? decryptContent(r.projectId, r.content) : encryptContent(r.projectId, r.content);
      if (!dry) await prisma.texFile.update({ where: { id: r.id }, data: { content: next } });
      texDone += 1;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < BATCH) break;
  }

  let snapDone = 0;
  let snapSkip = 0;
  const snaps = await prisma.snapshot.findMany({ select: { id: true, projectId: true, files: true } });
  for (const s of snaps) {
    const wrapped = isWrappedSnapshot(s.files);
    if (decrypt ? !wrapped : wrapped) {
      snapSkip += 1;
      continue;
    }
    const nextFiles = decrypt
      ? JSON.parse(decryptContent(s.projectId, (s.files as { _enc: string })._enc))
      : { [SNAPSHOT_ENC_KEY]: encryptContent(s.projectId, JSON.stringify(s.files)) };
    if (!dry) await prisma.snapshot.update({ where: { id: s.id }, data: { files: nextFiles } });
    snapDone += 1;
  }

  console.log(`[${mode}] TexFile: ${decrypt ? 'decrypted' : 'encrypted'} ${texDone}, skipped ${texSkip}`);
  console.log(`[${mode}] Snapshot: ${decrypt ? 'decrypted' : 'encrypted'} ${snapDone}, skipped ${snapSkip}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[encrypt-content] FAILED — no partial state assumed (idempotent; re-runnable):', err);
  process.exit(1);
});
