import { describe, expect, it } from 'vitest';
import { parseTexcount } from '../src/compile/texcount.js';

describe('parseTexcount', () => {
  it('parses a multi-file (-inc -brief) run: per-file + included + total', () => {
    const out = [
      '4+0+0 (0/0/0/0) File: main.tex',
      '8+0+0 (0/0/0/0) Included file: ./ch1.tex',
      'Sum of files: main.tex',
      '12+0+0 (0/0/0/0) File(s) total: main.tex',
    ].join('\n');
    const r = parseTexcount(out);
    expect(r.total).toEqual({ words: 12, headers: 0, captions: 0 });
    expect(r.files).toEqual([
      { file: 'main.tex', words: 4, headers: 0, captions: 0 },
      { file: 'ch1.tex', words: 8, headers: 0, captions: 0 }, // ./ prefix stripped
    ]);
  });

  it('single file (no total line) → total is that file', () => {
    const r = parseTexcount('5+3+4 (1/1/0/0) File: hc.tex\n');
    expect(r.files).toHaveLength(1);
    expect(r.total).toEqual({ words: 5, headers: 3, captions: 4 });
  });

  it('ignores noise and empty output', () => {
    expect(parseTexcount('').files).toHaveLength(0);
    expect(parseTexcount('').total).toEqual({ words: 0, headers: 0, captions: 0 });
    expect(parseTexcount('some unrelated line\n').files).toHaveLength(0);
  });
});
