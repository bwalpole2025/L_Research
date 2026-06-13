-- Project lifecycle: Archive + Trash — idempotent, one-time.
--
-- The repo syncs schema with `prisma db push`; this file is the hand-authored,
-- re-runnable record of the same change for production (`psql -f`) or audit.
-- It moves NO data: every existing project stays ACTIVE (both columns NULL).
-- Re-running is a no-op (IF NOT EXISTS guards).
--
-- A project is ACTIVE when both columns are NULL. archivedAt set ⇒ set aside
-- (hidden from the main list + editor, restorable). deletedAt set ⇒ in Trash
-- (soft-deleted; restorable until purged). The default /projects list and the
-- editor only ever see active projects.

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "deletedAt"  TIMESTAMP(3);

-- Fast filtering of the three lifecycle buckets.
CREATE INDEX IF NOT EXISTS "Project_archivedAt_idx" ON "Project" ("archivedAt");
CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx"  ON "Project" ("deletedAt");
