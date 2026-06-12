import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { RunArtifact } from '@latex-studio/shared';
import type { AppConfig } from '../config.js';
import { figuresDir, pyoutDir } from './runner.js';

/**
 * Run artefacts = image files a script writes. Figures (under `figures/`) are
 * IMPORTED into the project so plain Compile picks them up; scratch images (under
 * the run's `.pyout/<runId>/`) are shown in the output window only. New figures
 * are detected by diffing the directory's mtimes around the run.
 */

const IMAGE_EXTS = ['.png', '.pdf', '.svg', '.jpg', '.jpeg', '.gif'];
const isImage = (name: string): boolean => IMAGE_EXTS.some((e) => name.toLowerCase().endsWith(e));

/** name → mtimeMs for the files in a directory (empty if it doesn't exist). */
export type DirSnapshot = Map<string, number>;

async function snapshotDir(dir: string): Promise<DirSnapshot> {
  const out: DirSnapshot = new Map();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out; // dir not created yet
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    try {
      const s = await stat(join(dir, e.name));
      out.set(e.name, s.mtimeMs);
    } catch {
      /* vanished mid-scan */
    }
  }
  return out;
}

export function snapshotFigures(config: AppConfig, projectId: string): Promise<DirSnapshot> {
  return snapshotDir(figuresDir(config, projectId));
}

export interface CapturedFigure {
  name: string;
  /** Project-relative, e.g. "figures/kdv.png". */
  relPath: string;
  fullPath: string;
}

/** Image files in figures/ that are new or changed since `before`. */
export async function collectNewFigures(config: AppConfig, projectId: string, before: DirSnapshot): Promise<CapturedFigure[]> {
  const dir = figuresDir(config, projectId);
  const now = await snapshotDir(dir);
  const out: CapturedFigure[] = [];
  for (const [name, mtime] of now) {
    if (!isImage(name)) continue;
    const prev = before.get(name);
    if (prev === undefined || mtime > prev) out.push({ name, relPath: `figures/${name}`, fullPath: join(dir, name) });
  }
  return out;
}

/** Upsert captured figures as project files (base64) so Compile includes them. */
export async function importFigures(prisma: PrismaClient, projectId: string, figures: CapturedFigure[]): Promise<void> {
  for (const f of figures) {
    const content = (await readFile(f.fullPath)).toString('base64');
    await prisma.texFile.upsert({
      where: { projectId_path: { projectId, path: f.relPath } },
      update: { content, encoding: 'base64' },
      create: { projectId, path: f.relPath, content, encoding: 'base64' },
    });
  }
}

/** A scratch artefact: a primary file plus an optional raster preview sibling. */
export interface ScratchArtifact {
  /** Project-relative path of the file added to the project (e.g. a vector PDF). */
  path: string;
  /** Project-relative path of a raster thumbnail when the primary isn't an `<img>`. */
  previewPath?: string;
}

const RASTER_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const isRaster = (name: string): boolean => RASTER_EXTS.some((e) => name.toLowerCase().endsWith(e));
const stemOf = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
};

/**
 * Image files written to the run's scratch dir (shown in the output window only).
 * Files sharing a stem are paired — e.g. the captured `figure_01.pdf` (primary,
 * vector, what gets added to the document) + `figure_01.png` (raster thumbnail).
 * A vector file (`.pdf/.svg/.eps/.ps`) is preferred as the primary.
 */
export async function collectScratchArtifacts(config: AppConfig, projectId: string, runId: string): Promise<ScratchArtifact[]> {
  const snap = await snapshotDir(pyoutDir(config, projectId, runId));
  const names = [...snap.keys()].filter(isImage);
  const groups = new Map<string, string[]>();
  for (const name of names) {
    const key = stemOf(name);
    const g = groups.get(key);
    if (g) g.push(name);
    else groups.set(key, [name]);
  }
  const out: ScratchArtifact[] = [];
  for (const group of groups.values()) {
    const vector = group.find((n) => !isRaster(n)); // .pdf/.svg/.eps/.ps
    const raster = group.find(isRaster);
    const primary = vector ?? raster ?? group[0]!;
    const art: ScratchArtifact = { path: `.pyout/${runId}/${primary}` };
    if (vector && raster) art.previewPath = `.pyout/${runId}/${raster}`;
    out.push(art);
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Build the client-facing artefact descriptor (with cache-busting URLs). */
export function toArtifact(
  projectId: string,
  relPath: string,
  kind: RunArtifact['kind'],
  rev: number,
  previewRelPath?: string,
): RunArtifact {
  const urlFor = (p: string): string => `/projects/${projectId}/run-artifact?path=${encodeURIComponent(p)}&rev=${rev}`;
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  return {
    name,
    path: relPath,
    url: urlFor(relPath),
    kind,
    ...(previewRelPath ? { previewUrl: urlFor(previewRelPath) } : {}),
  };
}
