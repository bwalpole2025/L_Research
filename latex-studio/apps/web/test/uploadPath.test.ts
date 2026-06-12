import { describe, expect, it } from 'vitest';
import { isAllowedPath, uploadTargetPath } from '../lib/fileKind';

describe('uploadTargetPath — preserves folder structure on upload', () => {
  it('a plain file (no relative path) lands directly under the target dir', () => {
    expect(uploadTargetPath('', 'plot.png')).toBe('plot.png');
    expect(uploadTargetPath('figures', 'plot.png')).toBe('figures/plot.png');
  });

  it('a folder upload keeps the nested webkitRelativePath', () => {
    // <input webkitdirectory> hands File.webkitRelativePath = "thesis/ch1/fig.png"
    expect(uploadTargetPath('', 'thesis/ch1/fig.png')).toBe('thesis/ch1/fig.png');
    expect(uploadTargetPath('uploads', 'thesis/ch1/fig.png')).toBe('uploads/thesis/ch1/fig.png');
  });

  it('sanitises each segment and drops empty / dotted segments', () => {
    expect(uploadTargetPath('', 'my dir/../weird:name.png')).toBe('my dir/weird-name.png');
    expect(uploadTargetPath('figs/', 'a//b/c.tex')).toBe('figs/a/b/c.tex'); // trailing slash + double slash
  });

  it('produces API-valid relative paths (forward slashes, allowed extension)', () => {
    const p = uploadTargetPath('assets', 'data/run 1/result.csv');
    expect(p).toBe('assets/data/run 1/result.csv');
    expect(p.startsWith('/')).toBe(false);
    expect(p.includes('\\')).toBe(false);
    expect(isAllowedPath(p)).toBe(true);
  });
});
