import type { PrismaClient } from '@prisma/client';
import { isPristineSeed } from '../lib/seedTemplate.js';

export interface RootCandidateFile {
  path: string;
  content: string;
  encoding?: string;
}

export interface ResolvedRoot {
  rootFile: string;
  /** True when another .tex was chosen over the configured root. */
  fellBack: boolean;
  /** Why: the configured root was missing, or it was the untouched starter template. */
  reason?: 'missing' | 'pristine-seed';
}

function rankCandidates(files: RootCandidateFile[], exclude?: string) {
  return files
    .filter((f) => /\.tex$/i.test(f.path) && f.encoding !== 'base64' && f.path !== exclude)
    .map((f) => ({
      path: f.path,
      score: (/\\documentclass\b/.test(f.content) ? 2 : 0) + (/\\begin\{document\}/.test(f.content) ? 1 : 0),
      depth: f.path.split('/').length,
    }))
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.path.localeCompare(b.path));
}

/**
 * Resolve the file to compile — the user's REAL document always wins:
 *
 *  1. Configured root missing → the next available .tex document, preferring a
 *     real compilable root (\documentclass, then \begin{document}), shallower
 *     paths, then alphabetical (deterministic).
 *  2. Configured root exists but is the UNTOUCHED starter template (the seeded
 *     main.tex, never edited) while another full document (\documentclass +
 *     \begin{document}) is in the project → that document wins. This is the
 *     "uploaded my paper into a fresh project" case: the placeholder must not
 *     shadow the real manuscript. The moment the user edits main.tex, it is no
 *     longer pristine and is respected as the root.
 *  3. Otherwise the configured root is used unchanged. With no .tex at all the
 *     configured name is returned (the compile fails with the usual error).
 */
export function resolveRootFile(configured: string, files: RootCandidateFile[]): ResolvedRoot {
  const existing = files.find((f) => f.path === configured);

  if (existing) {
    if (isPristineSeed(existing.content)) {
      // Only a FULL document (score 3) may displace the seed — never a fragment.
      const best = rankCandidates(files, configured)[0];
      if (best && best.score === 3) return { rootFile: best.path, fellBack: true, reason: 'pristine-seed' };
    }
    return { rootFile: configured, fellBack: false };
  }

  const best = rankCandidates(files)[0];
  if (!best) return { rootFile: configured, fellBack: false };
  return { rootFile: best.path, fellBack: true, reason: 'missing' };
}

/**
 * Resolve the root and, when a fallback was needed, persist it as the project's
 * rootFile so every other surface (PDF serving, SyncTeX, review, verify) agrees
 * on which document is the root.
 */
export async function resolveAndPersistRoot(
  prisma: PrismaClient,
  projectId: string,
  configured: string,
  files: RootCandidateFile[],
): Promise<ResolvedRoot> {
  const resolved = resolveRootFile(configured, files);
  if (resolved.fellBack) {
    await prisma.project
      .update({ where: { id: projectId }, data: { rootFile: resolved.rootFile } })
      .catch(() => undefined);
  }
  return resolved;
}
