/**
 * Static data for the deterministic LaTeX autocomplete (offline, no model).
 *
 * ── HOW TO EXTEND ─────────────────────────────────────────────────────────────
 * · Add a command: append to COMMANDS — { name (no backslash), detail (one-line),
 *   info? (longer doc string), snippet? (insertion template; `${}` marks a tab
 *   stop — Tab/Shift-Tab cycle stops, the first is selected on insert) }.
 *   Commands with a snippet insert the template, not just the name.
 * · Tab stops are EMPTY (`${}`) by convention: any text inside `${…}` is typed
 *   into the document and left behind when the user tabs past, so never use
 *   descriptive words (num, key, caption, …). Pre-fill a stop only with a real
 *   default worth keeping as-is — e.g. `${htbp}`, `${0.8}` — and the test suite
 *   enforces an allowlist of those.
 * · Add a snippet (word-triggered template): append to WORD_SNIPPETS with the
 *   same template syntax.
 * · Add an environment / package / class: append to the lists below; each entry
 *   may carry a description shown in the dropdown's info panel.
 * · Map a package to extra commands: extend PACKAGE_COMMANDS.
 */

export interface CommandEntry {
  name: string;
  detail: string;
  info?: string;
  /** When set, accepting inserts this snippet (with tab stops) instead of the bare command. */
  snippet?: string;
}

export const COMMANDS: CommandEntry[] = [
  // Structure
  { name: 'documentclass', detail: 'document class', snippet: 'documentclass{${}}' },
  { name: 'usepackage', detail: 'load a package', snippet: 'usepackage{${}}' },
  { name: 'section', detail: 'sectioning', info: 'Numbered section heading.', snippet: 'section{${}}' },
  { name: 'subsection', detail: 'sectioning', snippet: 'subsection{${}}' },
  { name: 'subsubsection', detail: 'sectioning', snippet: 'subsubsection{${}}' },
  { name: 'chapter', detail: 'sectioning (book/report)', snippet: 'chapter{${}}' },
  { name: 'paragraph', detail: 'run-in heading', snippet: 'paragraph{${}}' },
  { name: 'begin', detail: 'open an environment', snippet: 'begin{${}}' },
  { name: 'end', detail: 'close an environment', snippet: 'end{${}}' },
  { name: 'input', detail: 'include file (no page break)', snippet: 'input{${}}' },
  { name: 'include', detail: 'include file (page break)', snippet: 'include{${}}' },
  { name: 'label', detail: 'define a cross-reference target', snippet: 'label{${}}' },
  { name: 'ref', detail: 'reference a label', snippet: 'ref{${}}' },
  { name: 'eqref', detail: 'reference an equation (amsmath)', snippet: 'eqref{${}}' },
  { name: 'pageref', detail: 'page of a label', snippet: 'pageref{${}}' },
  { name: 'cite', detail: 'cite a bib entry', snippet: 'cite{${}}' },
  { name: 'citep', detail: 'parenthetical cite (natbib)', snippet: 'citep{${}}' },
  { name: 'citet', detail: 'textual cite (natbib)', snippet: 'citet{${}}' },
  { name: 'footnote', detail: 'footnote', snippet: 'footnote{${}}' },
  { name: 'caption', detail: 'float caption', snippet: 'caption{${}}' },
  { name: 'maketitle', detail: 'emit the title block' },
  { name: 'tableofcontents', detail: 'emit the ToC' },
  { name: 'appendix', detail: 'switch to appendix numbering' },
  { name: 'bibliography', detail: 'emit bibliography (BibTeX)', snippet: 'bibliography{${}}' },
  { name: 'bibliographystyle', detail: 'BibTeX style', snippet: 'bibliographystyle{${}}' },
  { name: 'item', detail: 'list item' },
  { name: 'centering', detail: 'centre the current block' },
  { name: 'noindent', detail: 'suppress paragraph indent' },
  { name: 'newcommand', detail: 'define a macro', snippet: 'newcommand{\\\\${}}{${}}' },
  { name: 'renewcommand', detail: 'redefine a macro', snippet: 'renewcommand{\\\\${}}{${}}' },
  { name: 'newenvironment', detail: 'define an environment', snippet: 'newenvironment{${}}{${}}{${}}' },
  // Text formatting
  { name: 'textbf', detail: 'bold text', snippet: 'textbf{${}}' },
  { name: 'textit', detail: 'italic text', snippet: 'textit{${}}' },
  { name: 'emph', detail: 'emphasis', snippet: 'emph{${}}' },
  { name: 'texttt', detail: 'monospace text', snippet: 'texttt{${}}' },
  { name: 'textsc', detail: 'small caps', snippet: 'textsc{${}}' },
  { name: 'underline', detail: 'underline', snippet: 'underline{${}}' },
  { name: 'mbox', detail: 'unbreakable box', snippet: 'mbox{${}}' },
  // Maths (core + amsmath)
  { name: 'frac', detail: 'fraction', info: 'Two empty arguments; Tab moves from the top to the bottom.', snippet: 'frac{${}}{${}}' },
  { name: 'dfrac', detail: 'display-style fraction (amsmath)', snippet: 'dfrac{${}}{${}}' },
  { name: 'tfrac', detail: 'text-style fraction (amsmath)', snippet: 'tfrac{${}}{${}}' },
  { name: 'sqrt', detail: 'square root', info: 'An optional [n] before the braces gives an nth root.', snippet: 'sqrt{${}}' },
  { name: 'sum', detail: 'summation', snippet: 'sum_{${}}^{${}}' },
  { name: 'prod', detail: 'product', snippet: 'prod_{${}}^{${}}' },
  { name: 'int', detail: 'integral', snippet: 'int_{${}}^{${}}' },
  { name: 'oint', detail: 'contour integral' },
  { name: 'lim', detail: 'limit', snippet: 'lim_{${}}' },
  { name: 'partial', detail: '∂ partial derivative' },
  { name: 'nabla', detail: '∇ del operator' },
  { name: 'infty', detail: '∞' },
  { name: 'alpha', detail: 'α' },
  { name: 'beta', detail: 'β' },
  { name: 'gamma', detail: 'γ' },
  { name: 'delta', detail: 'δ' },
  { name: 'epsilon', detail: 'ϵ' },
  { name: 'varepsilon', detail: 'ε' },
  { name: 'theta', detail: 'θ' },
  { name: 'lambda', detail: 'λ' },
  { name: 'mu', detail: 'μ' },
  { name: 'nu', detail: 'ν' },
  { name: 'xi', detail: 'ξ' },
  { name: 'pi', detail: 'π' },
  { name: 'rho', detail: 'ρ' },
  { name: 'sigma', detail: 'σ' },
  { name: 'tau', detail: 'τ' },
  { name: 'phi', detail: 'ϕ' },
  { name: 'varphi', detail: 'φ' },
  { name: 'chi', detail: 'χ' },
  { name: 'psi', detail: 'ψ' },
  { name: 'omega', detail: 'ω' },
  { name: 'Gamma', detail: 'Γ' },
  { name: 'Delta', detail: 'Δ' },
  { name: 'Theta', detail: 'Θ' },
  { name: 'Lambda', detail: 'Λ' },
  { name: 'Sigma', detail: 'Σ' },
  { name: 'Phi', detail: 'Φ' },
  { name: 'Psi', detail: 'Ψ' },
  { name: 'Omega', detail: 'Ω' },
  { name: 'cdot', detail: '· centred dot' },
  { name: 'times', detail: '× multiplication' },
  { name: 'pm', detail: '± plus-minus' },
  { name: 'leq', detail: '≤' },
  { name: 'geq', detail: '≥' },
  { name: 'neq', detail: '≠' },
  { name: 'approx', detail: '≈' },
  { name: 'sim', detail: '∼' },
  { name: 'propto', detail: '∝' },
  { name: 'rightarrow', detail: '→' },
  { name: 'Rightarrow', detail: '⇒' },
  { name: 'mapsto', detail: '↦' },
  { name: 'in', detail: '∈ set membership' },
  { name: 'subset', detail: '⊂' },
  { name: 'cup', detail: '∪ union' },
  { name: 'cap', detail: '∩ intersection' },
  { name: 'forall', detail: '∀' },
  { name: 'exists', detail: '∃' },
  { name: 'mathbb', detail: 'blackboard bold (amssymb)', snippet: 'mathbb{${}}' },
  { name: 'mathbf', detail: 'bold maths', snippet: 'mathbf{${}}' },
  { name: 'mathcal', detail: 'calligraphic', snippet: 'mathcal{${}}' },
  { name: 'mathrm', detail: 'upright maths', snippet: 'mathrm{${}}' },
  { name: 'boldsymbol', detail: 'bold symbol (amsmath)', snippet: 'boldsymbol{${}}' },
  { name: 'hat', detail: 'x̂ accent', snippet: 'hat{${}}' },
  { name: 'bar', detail: 'x̄ accent', snippet: 'bar{${}}' },
  { name: 'tilde', detail: 'x̃ accent', snippet: 'tilde{${}}' },
  { name: 'dot', detail: 'ẋ accent', snippet: 'dot{${}}' },
  { name: 'ddot', detail: 'ẍ accent', snippet: 'ddot{${}}' },
  { name: 'vec', detail: 'x⃗ accent', snippet: 'vec{${}}' },
  { name: 'overline', detail: 'overline', snippet: 'overline{${}}' },
  { name: 'underbrace', detail: 'underbrace with note', snippet: 'underbrace{${}}_{${}}' },
  { name: 'left', detail: 'sized opening delimiter', info: 'Pair with \\right, e.g. \\left( … \\right).' },
  { name: 'right', detail: 'sized closing delimiter' },
  { name: 'text', detail: 'text inside maths (amsmath)', snippet: 'text{${}}' },
  { name: 'operatorname', detail: 'upright operator name', snippet: 'operatorname{${}}' },
  { name: 'sin', detail: 'sine' },
  { name: 'cos', detail: 'cosine' },
  { name: 'tan', detail: 'tangent' },
  { name: 'exp', detail: 'exponential' },
  { name: 'log', detail: 'logarithm' },
  { name: 'ln', detail: 'natural log' },
  { name: 'nonumber', detail: 'suppress equation number (this row)' },
  { name: 'notag', detail: 'suppress tag (amsmath)' },
  { name: 'quad', detail: 'space (1em)' },
  { name: 'qquad', detail: 'space (2em)' },
];

/** Commands implied by a loaded \usepackage{...} (only offered when loaded). */
export const PACKAGE_COMMANDS: Record<string, CommandEntry[]> = {
  graphicx: [
    { name: 'includegraphics', detail: 'insert an image (graphicx)', info: 'Width pre-fills as 0.8\\textwidth; project images autocomplete inside the braces.', snippet: 'includegraphics[width=${0.8}\\textwidth]{${}}' },
    { name: 'graphicspath', detail: 'image search path (graphicx)', snippet: 'graphicspath{{${}}}' },
    { name: 'scalebox', detail: 'scale content (graphicx)', snippet: 'scalebox{${0.9}}{${}}' },
  ],
  hyperref: [
    { name: 'href', detail: 'hyperlink (hyperref)', snippet: 'href{${}}{${}}' },
    { name: 'url', detail: 'typeset a URL (hyperref)', snippet: 'url{${}}' },
    { name: 'autoref', detail: 'typed reference (hyperref)', snippet: 'autoref{${}}' },
  ],
  amsmath: [
    { name: 'DeclareMathOperator', detail: 'define an operator (amsmath)', snippet: 'DeclareMathOperator{\\\\${}}{${}}' },
    { name: 'intertext', detail: 'text between align rows (amsmath)', snippet: 'intertext{${}}' },
  ],
  natbib: [{ name: 'citeauthor', detail: 'author-only cite (natbib)', snippet: 'citeauthor{${}}' }],
  cleveref: [
    { name: 'cref', detail: 'clever reference (cleveref)', snippet: 'cref{${}}' },
    { name: 'Cref', detail: 'clever reference, capitalised', snippet: 'Cref{${}}' },
  ],
  siunitx: [
    { name: 'SI', detail: 'value with unit (siunitx)', snippet: 'SI{${}}{${}}' },
    { name: 'si', detail: 'unit only (siunitx)', snippet: 'si{${}}' },
  ],
  booktabs: [
    { name: 'toprule', detail: 'top rule (booktabs)' },
    { name: 'midrule', detail: 'mid rule (booktabs)' },
    { name: 'bottomrule', detail: 'bottom rule (booktabs)' },
  ],
};

export interface NamedEntry {
  name: string;
  detail: string;
}

export const ENVIRONMENTS: NamedEntry[] = [
  { name: 'document', detail: 'the document body' },
  { name: 'equation', detail: 'numbered display equation' },
  { name: 'equation*', detail: 'unnumbered display equation' },
  { name: 'align', detail: 'aligned equations (amsmath)' },
  { name: 'align*', detail: 'aligned, unnumbered' },
  { name: 'gather', detail: 'centred equations (amsmath)' },
  { name: 'multline', detail: 'one long equation, split (amsmath)' },
  { name: 'cases', detail: 'piecewise definition (amsmath)' },
  { name: 'split', detail: 'split one equation (amsmath)' },
  { name: 'aligned', detail: 'aligned block inside maths' },
  { name: 'matrix', detail: 'matrix, no delimiters' },
  { name: 'pmatrix', detail: 'matrix with ( )' },
  { name: 'bmatrix', detail: 'matrix with [ ]' },
  { name: 'figure', detail: 'floating figure' },
  { name: 'table', detail: 'floating table' },
  { name: 'tabular', detail: 'table body' },
  { name: 'itemize', detail: 'bulleted list' },
  { name: 'enumerate', detail: 'numbered list' },
  { name: 'description', detail: 'description list' },
  { name: 'abstract', detail: 'abstract' },
  { name: 'center', detail: 'centred block' },
  { name: 'quote', detail: 'quotation' },
  { name: 'verbatim', detail: 'verbatim text' },
  { name: 'theorem', detail: 'theorem (amsthm)' },
  { name: 'lemma', detail: 'lemma (amsthm)' },
  { name: 'proof', detail: 'proof (amsthm)' },
  { name: 'definition', detail: 'definition (amsthm)' },
  { name: 'corollary', detail: 'corollary (amsthm)' },
  { name: 'remark', detail: 'remark (amsthm)' },
  { name: 'minipage', detail: 'box with its own width' },
  { name: 'subequations', detail: 'shared equation number (amsmath)' },
];

export const PACKAGES: NamedEntry[] = [
  { name: 'amsmath', detail: 'AMS maths environments + tools' },
  { name: 'amssymb', detail: 'AMS symbol fonts' },
  { name: 'amsthm', detail: 'theorem environments' },
  { name: 'mathtools', detail: 'amsmath extensions' },
  { name: 'graphicx', detail: 'include graphics' },
  { name: 'hyperref', detail: 'hyperlinks + PDF metadata' },
  { name: 'natbib', detail: 'author-year citations' },
  { name: 'biblatex', detail: 'modern bibliography engine' },
  { name: 'geometry', detail: 'page margins' },
  { name: 'xcolor', detail: 'colours' },
  { name: 'tikz', detail: 'drawing' },
  { name: 'pgfplots', detail: 'plots from data' },
  { name: 'siunitx', detail: 'units and numbers' },
  { name: 'booktabs', detail: 'publication-quality tables' },
  { name: 'cleveref', detail: 'smart \\cref references' },
  { name: 'caption', detail: 'caption formatting' },
  { name: 'subcaption', detail: 'sub-figures' },
  { name: 'float', detail: 'float placement (H)' },
  { name: 'enumitem', detail: 'list customisation' },
  { name: 'setspace', detail: 'line spacing' },
  { name: 'microtype', detail: 'typographic refinement' },
  { name: 'babel', detail: 'language support' },
  { name: 'fontenc', detail: 'font encoding' },
  { name: 'inputenc', detail: 'input encoding' },
  { name: 'listings', detail: 'source-code listings' },
  { name: 'physics', detail: 'derivative/bra-ket shorthands' },
  { name: 'bm', detail: 'bold maths symbols' },
  { name: 'todonotes', detail: 'margin TODOs' },
];

export const CLASSES: NamedEntry[] = [
  { name: 'article', detail: 'standard article' },
  { name: 'report', detail: 'report with chapters' },
  { name: 'book', detail: 'book' },
  { name: 'beamer', detail: 'presentations' },
  { name: 'letter', detail: 'letters' },
  { name: 'memoir', detail: 'flexible book/report' },
  { name: 'scrartcl', detail: 'KOMA-Script article' },
  { name: 'revtex4-2', detail: 'APS/AIP journals' },
  { name: 'elsarticle', detail: 'Elsevier journals' },
  { name: 'IEEEtran', detail: 'IEEE journals' },
  { name: 'jfm', detail: 'Journal of Fluid Mechanics' },
];

export interface WordSnippet {
  label: string;
  detail: string;
  template: string;
}

/** Word-triggered templates (Ctrl-Space, or type the word). `${…}` = tab stops. */
export const WORD_SNIPPETS: WordSnippet[] = [
  {
    label: 'figure',
    detail: 'figure environment (snippet)',
    template:
      '\\begin{figure}[${htbp}]\n\t\\centering\n\t\\includegraphics[width=${0.8}\\textwidth]{${}}\n\t\\caption{${}}\n\t\\label{fig:${}}\n\\end{figure}',
  },
  {
    label: 'table',
    detail: 'table + tabular (snippet)',
    template:
      '\\begin{table}[${htbp}]\n\t\\centering\n\t\\begin{tabular}{${lcc}}\n\t\t${} \\\\\n\t\\end{tabular}\n\t\\caption{${}}\n\t\\label{tab:${}}\n\\end{table}',
  },
  { label: 'equation', detail: 'equation environment (snippet)', template: '\\begin{equation}\n\t${}\n\t\\label{eq:${}}\n\\end{equation}' },
  { label: 'align', detail: 'align with & and \\\\ stops (snippet)', template: '\\begin{align}\n\t${} &= ${} \\\\\n\t${} &= ${}\n\\end{align}' },
  { label: 'gather', detail: 'gather environment (snippet)', template: '\\begin{gather}\n\t${}\n\\end{gather}' },
  { label: 'multline', detail: 'multline environment (snippet)', template: '\\begin{multline}\n\t${} \\\\\n\t${}\n\\end{multline}' },
  { label: 'cases', detail: 'piecewise cases (snippet)', template: '\\begin{cases}\n\t${} & ${} \\\\\n\t${} & ${}\n\\end{cases}' },
  { label: 'itemize', detail: 'bulleted list (snippet)', template: '\\begin{itemize}\n\t\\item ${}\n\\end{itemize}' },
  { label: 'enumerate', detail: 'numbered list (snippet)', template: '\\begin{enumerate}\n\t\\item ${}\n\\end{enumerate}' },
  { label: 'theorem', detail: 'theorem (snippet)', template: '\\begin{theorem}\n\t${}\n\\end{theorem}' },
  { label: 'lemma', detail: 'lemma (snippet)', template: '\\begin{lemma}\n\t${}\n\\end{lemma}' },
  { label: 'proof', detail: 'proof (snippet)', template: '\\begin{proof}\n\t${}\n\\end{proof}' },
];
