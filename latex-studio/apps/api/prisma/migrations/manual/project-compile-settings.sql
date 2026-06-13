-- Per-project compile settings — idempotent, one-time.
--
-- The repo syncs schema with `prisma db push`; this file is the hand-authored,
-- re-runnable record of the same change for production (`psql -f`) or audit.
-- It moves NO data: every existing project keeps the pdfLaTeX default.
--
-- texEngine: "pdflatex" | "xelatex" | "lualatex" → latexmk -pdf / -pdfxe / -pdflua.
-- haltOnError: stop at the first error (latexmk -halt-on-error).
-- draftMode: skip image rendering for a faster preview (graphicx draft).

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "texEngine"   TEXT    NOT NULL DEFAULT 'pdflatex';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "haltOnError" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "draftMode"   BOOLEAN NOT NULL DEFAULT false;
