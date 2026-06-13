import { describe, expect, it } from 'vitest';
import { addPreamblePackage } from '../lib/store';

describe('addPreamblePackage', () => {
  it('inserts after the last \\usepackage', () => {
    const doc = '\\documentclass{article}\n\\usepackage{geometry}\n\\begin{document}\nx\n\\end{document}';
    expect(addPreamblePackage(doc, 'amsmath')).toBe('\\documentclass{article}\n\\usepackage{geometry}\n\\usepackage{amsmath}\n\\begin{document}\nx\n\\end{document}');
  });
  it('inserts after \\documentclass when there are no packages', () => {
    const doc = '\\documentclass{article}\n\\begin{document}\nx\n\\end{document}';
    expect(addPreamblePackage(doc, 'amsmath')).toBe('\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}\nx\n\\end{document}');
  });
  it('is a no-op when already loaded (own line or comma list)', () => {
    const a = '\\documentclass{article}\n\\usepackage{amsmath}\n\\begin{document}x\\end{document}';
    expect(addPreamblePackage(a, 'amsmath')).toBe(a);
    const b = '\\documentclass{article}\n\\usepackage{amsmath,amssymb}\n\\begin{document}x\\end{document}';
    expect(addPreamblePackage(b, 'amsmath')).toBe(b);
    const c = '\\documentclass{article}\n\\usepackage[fleqn]{amsmath}\n\\begin{document}x\\end{document}';
    expect(addPreamblePackage(c, 'amsmath')).toBe(c);
  });
});
