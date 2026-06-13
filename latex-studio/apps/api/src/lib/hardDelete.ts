import type { FastifyInstance } from 'fastify';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * HARD DELETE (right to erasure). Removes EVERYTHING for a project so nothing is
 * left orphaned:
 *   · DB rows — `project.delete` cascades to TexFile, Snapshot, LiteratureItem
 *     (→ LibraryChunk + its pgvector embedding), ChatThread (→ ChatMessage),
 *     CompileLog, Folder and per-project TrashEntry. AiCallLog and project-scoped
 *     UsageStat have NO foreign key to Project, so we delete them explicitly.
 *   · On-disk — the project's workspace dir `<compileWorkspace>/<projectId>`,
 *     which holds staged sources, the compiled PDF/aux/log, `.pyout`/`.gpout`
 *     scratch, figures, diagrams AND the literature PDFs.
 *
 * Content-encryption keys are DERIVED from the master key (never stored per
 * project), so there is no key material to delete. Idempotent and re-runnable.
 */
export async function hardDeleteProject(app: FastifyInstance, projectId: string): Promise<void> {
  await app.prisma.aiCallLog.deleteMany({ where: { projectId } });
  await app.prisma.usageStat.deleteMany({ where: { scope: projectId } });
  // deleteMany (not delete) so a re-run on an already-removed project is a no-op.
  await app.prisma.project.deleteMany({ where: { id: projectId } });
  await rm(join(app.config.compileWorkspace, projectId), { recursive: true, force: true });
}

/**
 * HARD DELETE every project (and thus all data) for a user — the user-level
 * erasure path. The data model is currently single-user (no `userId` column), so
 * this erases ALL projects; once per-user ownership lands, scope the `findMany`
 * by `userId` and also purge that user's connector credentials from the vault.
 */
export async function hardDeleteAllProjects(app: FastifyInstance): Promise<number> {
  const projects = await app.prisma.project.findMany({ select: { id: true } });
  for (const p of projects) await hardDeleteProject(app, p.id);
  return projects.length;
}
