/** Allowed file extensions for project files. */
export const ALLOWED_EXTENSIONS = ['.tex', '.bib', '.sty', '.cls', '.txt'] as const;

const SEGMENT = /^[A-Za-z0-9._ -]+$/;

export interface PathValidation {
  ok: boolean;
  error?: string;
}

/**
 * Validate a project-relative POSIX file path. Rejects absolute paths, traversal
 * (`..`), unusual characters, and disallowed extensions. Keeps stored paths safe
 * to later map onto the compile workspace on disk.
 */
export function validateFilePath(path: string): PathValidation {
  if (!path || path.length > 512) {
    return { ok: false, error: 'path must be between 1 and 512 characters' };
  }
  if (path.startsWith('/') || path.includes('\\')) {
    return { ok: false, error: 'path must be relative and use forward slashes' };
  }

  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { ok: false, error: 'path may not contain empty or relative segments' };
    }
    if (!SEGMENT.test(segment)) {
      return { ok: false, error: `invalid characters in path segment "${segment}"` };
    }
  }

  const lower = path.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return {
      ok: false,
      error: `file extension must be one of: ${ALLOWED_EXTENSIONS.join(', ')}`,
    };
  }

  return { ok: true };
}
