-- Project Folders (app-level Home organisation) — idempotent, one-time.
--
-- The repo syncs schema with `prisma db push`; this file is the hand-authored,
-- re-runnable record of the same change for production (`psql -f`) or audit.
-- It moves NO data: existing projects keep folderId NULL (root / "Unfiled").
-- Re-running is a no-op (IF NOT EXISTS / IF EXISTS guards throughout).

-- 1. App-level folder hierarchy that groups projects (no projectId).
CREATE TABLE IF NOT EXISTS "ProjectFolder" (
  "id"        TEXT NOT NULL,
  "parentId"  TEXT,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectFolder_pkey" PRIMARY KEY ("id")
);

-- Self-relation: a folder's parent (cascade so a subtree delete is atomic).
DO $$ BEGIN
  ALTER TABLE "ProjectFolder"
    ADD CONSTRAINT "ProjectFolder_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ProjectFolder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sibling-name uniqueness (root collisions, where parentId IS NULL, are also
-- enforced in-route since SQL treats NULLs as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectFolder_parentId_name_key"
  ON "ProjectFolder" ("parentId", "name");

-- 2. A project's single home folder; NULL = root. SetNull so deleting a folder
--    detaches its projects to root rather than destroying them.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "folderId" TEXT;
CREATE INDEX IF NOT EXISTS "Project_folderId_idx" ON "Project" ("folderId");

DO $$ BEGIN
  ALTER TABLE "Project"
    ADD CONSTRAINT "Project_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "ProjectFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. App-level trash entries (kind 'project-folder') aren't owned by a project,
--    so TrashEntry.projectId becomes nullable.
ALTER TABLE "TrashEntry" ALTER COLUMN "projectId" DROP NOT NULL;
