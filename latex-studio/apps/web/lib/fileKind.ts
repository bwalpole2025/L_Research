/** File-type helpers shared by the file tree, upload, and editor preview. */

export const TEXT_EXTENSIONS = ['.tex', '.bib', '.bst', '.sty', '.cls', '.clo', '.txt', '.md', '.csv'];
export const BINARY_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.ico', '.svg',
  '.pdf', '.eps', '.ps', '.ttf', '.otf', '.woff', '.woff2',
];
export const ALL_EXTENSIONS = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS];

const lower = (path: string): string => path.toLowerCase();

export function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : lower(path.slice(dot));
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTENSIONS.includes(extOf(path));
}

export function isAllowedPath(path: string): boolean {
  return ALL_EXTENSIONS.includes(extOf(path));
}

export function isImagePath(path: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.ico'].includes(extOf(path));
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

export function mimeForPath(path: string): string {
  return MIME[extOf(path)] ?? 'application/octet-stream';
}

/** Sanitise a filename into a single valid path segment. */
export function sanitiseSegment(name: string): string {
  return name.replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/^-+|-+$/g, '') || 'file';
}

/** Read a File as base64 (no data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma === -1 ? result : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
