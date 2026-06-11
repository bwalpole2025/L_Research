"""LaTeX → SymPy parsing.

Two parsers, tried in order (see README for the construct matrix):

  1. latex2sympy2  — primary. Handles the broad, real-world LaTeX of physics and
     calculus: implicit multiplication (``2x``, ``\\sin 2x``), ``\\frac``,
     subscripts/superscripts, ``\\partial`` derivatives, common functions.
  2. sympy.parsing.latex.parse_latex(backend="lark") — fallback for inputs that
     latex2sympy2 rejects. (The antlr backend is unavailable: latex2sympy2 pins
     antlr4-python3-runtime to 4.7.2, which SymPy's antlr parser can't use, so we
     use the dependency-free Lark backend instead.)
"""

from __future__ import annotations

import sympy

from .normalize import normalize_expression


class ParseError(Exception):
    pass


def _via_latex2sympy(s: str):
    from latex2sympy2 import latex2sympy

    return latex2sympy(s)


def _via_sympy_lark(s: str):
    from sympy.parsing.latex import parse_latex

    return parse_latex(s, backend="lark")


_PARSERS = (("latex2sympy2", _via_latex2sympy), ("sympy.parse_latex(lark)", _via_sympy_lark))


def parse_expression(latex: str, macros: dict[str, str] | None = None) -> tuple[sympy.Expr, str]:
    """Parse one LaTeX expression to a SymPy expression.

    Returns (expr, parser_name). Raises :class:`ParseError` if every parser fails.
    """
    s = normalize_expression(latex, macros)
    if not s:
        raise ParseError("empty expression after normalization")

    errors: list[str] = []
    for name, fn in _PARSERS:
        try:
            expr = fn(s)
        except Exception as exc:  # noqa: BLE001 - any parser failure → try the next
            errors.append(f"{name}: {type(exc).__name__}: {exc}")
            continue
        if expr is None:
            errors.append(f"{name}: returned None")
            continue
        return sympy.sympify(expr), name

    raise ParseError(f"could not parse '{s}' — " + " | ".join(errors))
