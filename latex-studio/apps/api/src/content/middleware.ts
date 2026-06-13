import type { Prisma, PrismaClient } from '@prisma/client';
import { decryptContent, encryptContent, isEncrypted } from './crypto.js';

/**
 * TRANSPARENT ENCRYPTION-AT-REST for TexFile.content and Snapshot.files.
 *
 * A Prisma `$use` middleware so EVERY call site (compile staging, autosave,
 * docmodel, snapshots, export, …) is covered without change — a raw DB dump
 * shows only ciphertext, while authorised API reads/writes see plaintext. Writes
 * encrypt with the row's per-project key; reads decrypt. Selects that ask for
 * `content`/`files` but omit `projectId` get it added transparently (needed to
 * derive the key) and stripped from the result so callers see no extra field.
 *
 * Snapshot.files (a JSON array) is encrypted as a whole and stored as
 * `{ _enc: "<ciphertext>" }`; reads decrypt + parse back to the array.
 */

const SNAPSHOT_ENC_KEY = '_enc';
const WRITE = new Set(['create', 'createMany', 'update', 'updateMany', 'upsert']);
const READ = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany']);
const RETURNS_ROW = new Set(['create', 'update', 'upsert', 'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany']);

function requireProjectId(pid: unknown): string {
  if (typeof pid !== 'string' || pid.length === 0) {
    // Fail closed: never persist document content without a key to encrypt it.
    throw new Error('content encryption: could not resolve a projectId for the write');
  }
  return pid;
}

/** Resolve the projectId for a TexFile write (looking it up by id if needed). */
async function resolveTexFileProjectId(prisma: PrismaClient, where: Record<string, unknown> | undefined): Promise<string> {
  if (!where) throw new Error('content encryption: TexFile write has no where clause');
  const compound = where.projectId_path as { projectId?: string } | undefined;
  if (compound?.projectId) return compound.projectId;
  if (typeof where.projectId === 'string') return where.projectId;
  if (where.id !== undefined) {
    const row = await prisma.texFile.findUnique({ where: where as { id: string }, select: { projectId: true } });
    if (!row) throw new Error('content encryption: TexFile not found while resolving projectId');
    return row.projectId;
  }
  throw new Error('content encryption: cannot resolve projectId for TexFile write');
}

function wrapSnapshot(projectId: string, files: unknown): unknown {
  if (files && typeof files === 'object' && !Array.isArray(files) && SNAPSHOT_ENC_KEY in (files as object)) return files; // already wrapped
  return { [SNAPSHOT_ENC_KEY]: encryptContent(projectId, JSON.stringify(files)) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function encryptArgs(prisma: PrismaClient, params: Prisma.MiddlewareParams): Promise<void> {
  const { model, action } = params;
  const args = params.args as any;
  if (model === 'TexFile') {
    if (action === 'create' && typeof args?.data?.content === 'string') {
      args.data.content = encryptContent(requireProjectId(args.data.projectId), args.data.content);
    } else if (action === 'createMany' && Array.isArray(args?.data)) {
      for (const d of args.data) if (typeof d?.content === 'string') d.content = encryptContent(requireProjectId(d.projectId), d.content);
    } else if (action === 'update' && typeof args?.data?.content === 'string') {
      args.data.content = encryptContent(await resolveTexFileProjectId(prisma, args.where), args.data.content);
    } else if (action === 'updateMany' && typeof args?.data?.content === 'string') {
      args.data.content = encryptContent(requireProjectId(args?.where?.projectId), args.data.content);
    } else if (action === 'upsert') {
      const pid = requireProjectId(args?.where?.projectId_path?.projectId ?? args?.create?.projectId);
      if (typeof args?.create?.content === 'string') args.create.content = encryptContent(pid, args.create.content);
      if (typeof args?.update?.content === 'string') args.update.content = encryptContent(pid, args.update.content);
    }
  } else if (model === 'Snapshot') {
    if (action === 'create' && args?.data && 'files' in args.data) {
      args.data.files = wrapSnapshot(requireProjectId(args.data.projectId), args.data.files);
    } else if (action === 'createMany' && Array.isArray(args?.data)) {
      for (const d of args.data) if (d && 'files' in d) d.files = wrapSnapshot(requireProjectId(d.projectId), d.files);
    }
    // Snapshots are immutable in this app — no update/upsert path.
  }
}

/** Ensure projectId is selected when content/files is, so we can derive the key. Returns true if it was added (strip after). */
function ensureProjectIdSelected(params: Prisma.MiddlewareParams): boolean {
  const field = params.model === 'TexFile' ? 'content' : 'files';
  const sel = (params.args as any)?.select;
  if (sel && sel[field] && !sel.projectId) {
    sel.projectId = true;
    return true;
  }
  return false;
}

function decryptResult(model: string, result: unknown, stripProjectId: boolean): void {
  if (!result || typeof result !== 'object') return;
  const rows = Array.isArray(result) ? result : [result];
  for (const row of rows as any[]) {
    if (!row || typeof row !== 'object') continue;
    if (model === 'TexFile') {
      if (typeof row.content === 'string' && isEncrypted(row.content) && typeof row.projectId === 'string') {
        row.content = decryptContent(row.projectId, row.content);
      }
    } else {
      const f = row.files;
      if (f && typeof f === 'object' && !Array.isArray(f) && typeof f[SNAPSHOT_ENC_KEY] === 'string' && typeof row.projectId === 'string') {
        row.files = JSON.parse(decryptContent(row.projectId, f[SNAPSHOT_ENC_KEY] as string));
      }
    }
    if (stripProjectId) delete row.projectId;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function contentEncryptionMiddleware(prisma: PrismaClient): Prisma.Middleware {
  return async (params, next) => {
    if (params.model !== 'TexFile' && params.model !== 'Snapshot') return next(params);
    if (WRITE.has(params.action)) await encryptArgs(prisma, params);
    const strip = (READ.has(params.action) || RETURNS_ROW.has(params.action)) ? ensureProjectIdSelected(params) : false;
    const result = await next(params);
    if (RETURNS_ROW.has(params.action)) decryptResult(params.model, result, strip);
    return result;
  };
}
