'use client';

/**
 * Python autocomplete dropdown (IntelliSense) for .py files — deterministic,
 * offline, no model. Three layers, merged into one dropdown:
 *   1. A curated scientific-library dictionary (numpy / scipy / matplotlib /
 *      math) so typing `lin` offers `linspace`, and `np.` / `plt.` / `math.`
 *      offer that module's members.
 *   2. `localCompletionSource` — identifiers defined in THIS document.
 *   3. `globalCompletion` — Python keywords + builtins.
 *
 * Coexistence with the AI ghost text mirrors latexAutocomplete: while the
 * dropdown is open it owns Tab (accept item); when closed, the ghost's Tab wins.
 */

import {
  acceptCompletion,
  autocompletion,
  completionStatus,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { globalCompletion, localCompletionSource } from '@codemirror/lang-python';
import { keymap } from '@codemirror/view';
import { Prec, type Extension } from '@codemirror/state';

const fn = (label: string, detail: string): Completion => ({ label, type: 'function', detail });
const cst = (label: string, detail: string): Completion => ({ label, type: 'constant', detail });
const ns = (label: string, detail: string): Completion => ({ label, type: 'namespace', detail });

// ── numpy ────────────────────────────────────────────────────────────────────
const NUMPY_FUNCS = [
  'array', 'asarray', 'linspace', 'arange', 'logspace', 'geomspace', 'zeros', 'ones', 'zeros_like', 'ones_like',
  'empty', 'empty_like', 'full', 'full_like', 'eye', 'identity', 'diag', 'reshape', 'ravel', 'flatten', 'transpose',
  'swapaxes', 'moveaxis', 'expand_dims', 'squeeze', 'concatenate', 'stack', 'vstack', 'hstack', 'dstack',
  'column_stack', 'split', 'array_split', 'tile', 'repeat', 'roll', 'flip', 'where', 'nonzero', 'argwhere',
  'argmin', 'argmax', 'argsort', 'sort', 'unique', 'searchsorted', 'clip', 'abs', 'absolute', 'sign', 'sqrt',
  'cbrt', 'square', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'sin', 'cos', 'tan', 'arcsin', 'arccos',
  'arctan', 'arctan2', 'sinh', 'cosh', 'tanh', 'deg2rad', 'rad2deg', 'power', 'mod', 'floor', 'ceil', 'rint',
  'round', 'trunc', 'sum', 'prod', 'cumsum', 'cumprod', 'nansum', 'nanmean', 'mean', 'average', 'median', 'std',
  'var', 'min', 'max', 'ptp', 'percentile', 'quantile', 'dot', 'vdot', 'inner', 'outer', 'cross', 'matmul',
  'kron', 'trace', 'gradient', 'diff', 'trapz', 'interp', 'convolve', 'correlate', 'meshgrid', 'real', 'imag',
  'conj', 'conjugate', 'angle', 'isnan', 'isinf', 'isfinite', 'isclose', 'allclose', 'array_equal',
  'count_nonzero', 'histogram', 'bincount', 'digitize', 'vectorize', 'apply_along_axis',
];
const NUMPY_CONSTS = ['pi', 'e', 'inf', 'nan', 'euler_gamma', 'newaxis'];
const NUMPY_SUBMODULES = ['linalg', 'fft', 'random', 'polynomial', 'ma', 'testing'];

// ── matplotlib.pyplot ──────────────────────────────────────────────────────────
const PLT_FUNCS = [
  'plot', 'scatter', 'bar', 'barh', 'hist', 'hist2d', 'boxplot', 'violinplot', 'imshow', 'matshow', 'contour',
  'contourf', 'pcolormesh', 'pcolor', 'quiver', 'streamplot', 'fill', 'fill_between', 'fill_betweenx', 'step',
  'stem', 'errorbar', 'loglog', 'semilogx', 'semilogy', 'polar', 'pie', 'axhline', 'axvline', 'axhspan',
  'axvspan', 'hlines', 'vlines', 'annotate', 'text', 'arrow', 'xlabel', 'ylabel', 'title', 'suptitle', 'legend',
  'xlim', 'ylim', 'xticks', 'yticks', 'grid', 'axis', 'xscale', 'yscale', 'colorbar', 'clim', 'figure', 'subplot',
  'subplots', 'subplots_adjust', 'tight_layout', 'gca', 'gcf', 'sca', 'cla', 'clf', 'close', 'show', 'savefig',
  'draw', 'pause', 'twinx', 'twiny', 'set_cmap', 'get_cmap', 'minorticks_on',
];

// ── math ─────────────────────────────────────────────────────────────────────
const MATH_FUNCS = [
  'sqrt', 'isqrt', 'cbrt', 'exp', 'expm1', 'exp2', 'log', 'log1p', 'log2', 'log10', 'pow', 'sin', 'cos', 'tan',
  'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'degrees', 'radians',
  'floor', 'ceil', 'trunc', 'fabs', 'factorial', 'gcd', 'lcm', 'comb', 'perm', 'hypot', 'copysign', 'fmod',
  'remainder', 'modf', 'frexp', 'ldexp', 'isnan', 'isinf', 'isfinite', 'isclose', 'gamma', 'lgamma', 'erf',
  'erfc', 'prod', 'fsum', 'dist',
];
const MATH_CONSTS = ['pi', 'e', 'tau', 'inf', 'nan'];

// ── scipy (submodules; you `from scipy import optimize`, then call into it) ──────
const SCIPY_SUBMODULES = [
  'integrate', 'optimize', 'linalg', 'sparse', 'signal', 'stats', 'interpolate', 'fft', 'fftpack', 'special',
  'ndimage', 'spatial', 'cluster', 'constants', 'io',
];

/** Bare suggestions (no `obj.` before the cursor): the numpy vocabulary, so
 *  `lin` → `linspace`. Keywords/builtins/local names come from the other sources. */
const BARE: Completion[] = [
  ...NUMPY_FUNCS.map((l) => fn(l, 'numpy')),
  ...NUMPY_CONSTS.map((l) => cst(l, 'numpy')),
];

const NP_MEMBERS: Completion[] = [
  ...NUMPY_FUNCS.map((l) => fn(l, 'numpy')),
  ...NUMPY_CONSTS.map((l) => cst(l, 'numpy')),
  ...NUMPY_SUBMODULES.map((l) => ns(l, 'numpy module')),
];
const PLT_MEMBERS: Completion[] = PLT_FUNCS.map((l) => fn(l, 'pyplot'));
const MATH_MEMBERS: Completion[] = [...MATH_FUNCS.map((l) => fn(l, 'math')), ...MATH_CONSTS.map((l) => cst(l, 'math'))];
const SCIPY_MEMBERS: Completion[] = SCIPY_SUBMODULES.map((l) => ns(l, 'scipy module'));

/** `obj.` → that module's members. Covers the usual import aliases. */
const MEMBERS: Record<string, Completion[]> = {
  np: NP_MEMBERS,
  numpy: NP_MEMBERS,
  plt: PLT_MEMBERS,
  pyplot: PLT_MEMBERS,
  math: MATH_MEMBERS,
  sp: SCIPY_MEMBERS,
  scipy: SCIPY_MEMBERS,
};

const MEMBER_RE = /([A-Za-z_]\w*)\.(\w*)$/;

/** The curated scientific-Python source (numpy/scipy/plt/math + module members). */
function scientificPython(context: CompletionContext): CompletionResult | null {
  const member = context.matchBefore(MEMBER_RE);
  if (member) {
    const m = MEMBER_RE.exec(member.text);
    if (m) {
      const list = MEMBERS[m[1]!];
      if (!list) return null; // unknown object — don't guess
      return { from: member.to - m[2]!.length, options: list, validFor: /^\w*$/ };
    }
  }
  const word = context.matchBefore(/[A-Za-z_]\w*$/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: BARE, validFor: /^\w*$/ };
}

// Tab accepts the highlighted item ONLY while the dropdown is open, so it never
// shadows the AI ghost text's Tab when the dropdown is closed (see inlineSuggest).
const tabAcceptsDropdown = Prec.highest(
  keymap.of([{ key: 'Tab', run: (view) => (completionStatus(view.state) !== null ? acceptCompletion(view) : false) }]),
);

export function pythonAutocomplete(): Extension {
  return [
    autocompletion({
      override: [scientificPython, localCompletionSource, globalCompletion],
      activateOnTyping: true,
      defaultKeymap: true, // Enter accepts, Esc closes, arrows navigate
      icons: true,
      maxRenderedOptions: 80,
      interactionDelay: 0,
    }),
    tabAcceptsDropdown,
  ];
}
