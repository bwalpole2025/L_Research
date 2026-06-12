import type { PyFigureLink } from '@latex-studio/shared';

/**
 * Parse the figure-link directive `% !py <script> -> <output>` from .tex source.
 * It is a LaTeX comment (transparent to compilation) that tells the app which
 * script produces which figure, so "Run & Compile" knows what to regenerate.
 * Example: `% !py kdv_spectral_rk4.py -> figures/kdv.png`.
 */
const DIRECTIVE = /^[ \t]*%[ \t]*!py[ \t]+(\S+)[ \t]*->[ \t]*(\S+)[ \t]*$/gm;

export function parsePyFigureLinks(texContents: string[]): PyFigureLink[] {
  const seen = new Set<string>();
  const links: PyFigureLink[] = [];
  for (const content of texContents) {
    DIRECTIVE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECTIVE.exec(content)) !== null) {
      const script = m[1];
      const output = m[2];
      if (!script || !output) continue;
      const key = `${script}->${output}`;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ script, output });
      }
    }
  }
  return links;
}
