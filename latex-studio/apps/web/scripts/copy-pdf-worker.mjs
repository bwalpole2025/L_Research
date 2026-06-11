// Copy the pdf.js worker into public/ so the viewer can load it from a stable,
// offline URL (/pdf.worker.min.mjs). Runs in predev/prebuild.
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

try {
  const pkg = require.resolve('pdfjs-dist/package.json');
  const root = dirname(pkg);
  const candidates = [
    'build/pdf.worker.min.mjs',
    'build/pdf.worker.mjs',
    'build/pdf.worker.min.js',
    'build/pdf.worker.js',
  ];
  const src = candidates.map((c) => join(root, c)).find(existsSync);
  if (!src) {
    console.warn('[copy-pdf-worker] worker file not found in pdfjs-dist; skipping');
    process.exit(0);
  }
  mkdirSync('public', { recursive: true });
  copyFileSync(src, join('public', 'pdf.worker.min.mjs'));
  console.log(`[copy-pdf-worker] copied ${src} → public/pdf.worker.min.mjs`);
} catch (err) {
  console.warn('[copy-pdf-worker] skipped:', err?.message ?? err);
}
