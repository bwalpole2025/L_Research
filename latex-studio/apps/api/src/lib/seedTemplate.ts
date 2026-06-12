/** The starter main.tex every new project is seeded with. Shared so the root
 *  resolver can recognise an UNTOUCHED seed and prefer a real uploaded document. */
export const DEFAULT_MAIN_TEX = `\\documentclass{article}

\\title{Untitled}
\\author{}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}

\\end{document}
`;

const norm = (s: string): string =>
  s
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();

/** True when the content is the seed template, unedited (modulo trailing whitespace). */
export function isPristineSeed(content: string): boolean {
  return norm(content) === norm(DEFAULT_MAIN_TEX);
}
