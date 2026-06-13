import type { WordCountResult } from '@latex-studio/shared';

/**
 * Parse `texcount -inc -brief` output into a structured word count.
 *
 * Brief lines look like:
 *   `5+3+4 (1/1/0/0) File: main.tex`            ← words+headers+captions per file
 *   `8+0+0 (0/0/0/0) Included file: ./ch1.tex`  ← a \input/\include'd file
 *   `12+3+4 (1/1/0/0) File(s) total: main.tex`  ← grand total (multi-file only)
 *
 * A single-file document has no total line, so the total is the one file's
 * counts. The three numbers are: words in text, words in headers, words in
 * captions (texcount's standard split — what Overleaf surfaces).
 */
const BRIEF_LINE = /^(\d+)\+(\d+)\+(\d+)\s*\([^)]*\)\s*(File\(s\) total|Included file|File):\s*(.+?)\s*$/;

export function parseTexcount(stdout: string): WordCountResult {
  const files: WordCountResult['files'] = [];
  let total: WordCountResult['total'] | null = null;

  for (const raw of stdout.split(/\r?\n/)) {
    const m = BRIEF_LINE.exec(raw.trim());
    if (!m) continue;
    const counts = { words: Number(m[1]), headers: Number(m[2]), captions: Number(m[3]) };
    const label = m[4];
    if (label === 'File(s) total') {
      total = counts;
    } else {
      files.push({ file: (m[5] ?? '').replace(/^\.\//, ''), ...counts });
    }
  }

  // Single-file (no total line) — or a malformed run — sums the per-file counts.
  if (!total) {
    total = files.reduce(
      (a, f) => ({ words: a.words + f.words, headers: a.headers + f.headers, captions: a.captions + f.captions }),
      { words: 0, headers: 0, captions: 0 },
    );
  }
  return { total, files };
}
