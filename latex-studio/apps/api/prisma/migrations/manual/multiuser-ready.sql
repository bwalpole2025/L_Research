-- Multi-user-READY data model (latent-authz paydown; no auth provider yet).
--
-- Adds the columns that let a real user principal be introduced later as a small,
-- safe change rather than a rewrite. Both additions are non-destructive:
--   * Project."userId"  — NULLABLE owner (null = unowned/legacy, accessible to the
--                          static-bearer principal). Backfill + make NOT NULL when
--                          an identity provider lands (see docs/decisions.md).
--   * TexFile."version" — optimistic-lock counter, default 0 for existing rows.
--
-- Applied in this repo via `pnpm --filter @latex-studio/api db:push` (this project
-- syncs schema with `prisma db push`, not migration history). Kept here for audit
-- + reproducibility, alongside the other manual/*.sql notes.

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "userId" TEXT;
CREATE INDEX IF NOT EXISTS "Project_userId_idx" ON "Project" ("userId");

ALTER TABLE "TexFile" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
