"""Decide whether two SymPy expressions are equivalent.

Strategy, in order, with the winning ``method`` reported:
  1. simplify(lhs - rhs) == 0
  2. expand / trigsimp / radsimp / powsimp / cancel variants
  3. random numerical sampling over the free symbols (respecting assumptions),
     12 samples, complex-safe → "numeric" agreement or a concrete counterexample
  4. otherwise "unknown" — we never claim equivalence we didn't establish.
"""

from __future__ import annotations

import math
import random
from typing import Any

import sympy

from .assumptions import assumptions_for, parse_assumptions
from .timeoututil import StepTimeout, run_with_timeout

# Deterministic sampling so verdicts / counterexamples are reproducible.
_SEED = 0xC0FFEE

_SYMBOLIC_METHODS = (
    ("simplify", lambda d: sympy.simplify(d)),
    ("expand", lambda d: sympy.expand(d)),
    ("simplify(expand)", lambda d: sympy.simplify(sympy.expand(d))),
    ("trigsimp", lambda d: sympy.trigsimp(sympy.expand_trig(d))),
    ("radsimp", lambda d: sympy.radsimp(d)),
    ("powsimp", lambda d: sympy.powsimp(d, force=True)),
    ("cancel", lambda d: sympy.cancel(d)),
    ("factor", lambda d: sympy.factor(d)),
)


def _retype_symbols(*exprs: sympy.Expr, glob: dict, per: dict) -> list[sympy.Expr]:
    """Re-create each free symbol with its assumptions, shared across all exprs."""
    names: set[str] = set()
    for e in exprs:
        names |= {s.name for s in e.free_symbols}
    mapping: dict[sympy.Symbol, sympy.Symbol] = {}
    for name in names:
        assume = assumptions_for(name, glob, per)
        if assume:
            mapping[sympy.Symbol(name)] = sympy.Symbol(name, **assume)
    return [e.xreplace(mapping) if mapping else e for e in exprs]


def _is_zero(expr: sympy.Expr) -> bool:
    try:
        if expr == 0:
            return True
        z = expr.is_zero
        return z is True
    except Exception:  # noqa: BLE001
        return False


def check_equivalent(
    lhs: sympy.Expr,
    rhs: sympy.Expr,
    assumptions: str | None = None,
    timeout: float = 5.0,
    samples: int = 12,
) -> dict[str, Any]:
    glob, per = parse_assumptions(assumptions)
    left, right = _retype_symbols(lhs, rhs, glob=glob, per=per)
    diff = left - right

    # 1 + 2: symbolic ladder.
    for method, fn in _SYMBOLIC_METHODS:
        try:
            result = run_with_timeout(lambda f=fn: f(diff), timeout)
        except (StepTimeout, Exception):  # noqa: BLE001
            continue
        if _is_zero(result):
            return {"equivalent": True, "method": method}

    # SymPy's own structural+numeric equality is reliable for a True verdict.
    try:
        eq = run_with_timeout(lambda: left.equals(right), timeout)
        if eq is True:
            return {"equivalent": True, "method": "sympy.equals"}
    except (StepTimeout, Exception):  # noqa: BLE001
        pass

    # 3: numerical sampling (proves False with a counterexample, or gives
    # strong numeric evidence of True).
    numeric = _numeric_check(left, right, glob, per, samples=samples)
    if numeric is not None:
        return numeric

    # 4: give up honestly.
    return {"equivalent": "unknown", "method": "inconclusive"}


# ── numeric sampling ─────────────────────────────────────────────────────────


def _sample(assume: dict, rng: random.Random):
    if assume.get("integer"):
        v = rng.randint(-6, 6)
        return v if v != 0 else 1
    if assume.get("positive"):
        return round(rng.uniform(0.25, 4.5), 4)
    if assume.get("nonnegative"):
        return round(rng.uniform(0.1, 4.5), 4)
    if assume.get("negative"):
        return round(rng.uniform(-4.5, -0.25), 4)
    if assume.get("nonpositive"):
        return round(rng.uniform(-4.5, -0.1), 4)
    if assume.get("complex") and not assume.get("real"):
        return complex(round(rng.uniform(-3, 3), 4), round(rng.uniform(-3, 3), 4))
    # Default domain is real (most derivations), but evaluation is complex-safe.
    return round(rng.uniform(-4.5, 4.5), 4)


def _to_complex(value) -> complex | None:
    try:
        c = complex(value)
    except (TypeError, ValueError):
        return None
    if any(math.isnan(p) or math.isinf(p) for p in (c.real, c.imag)):
        return None
    return c


def _eval(expr: sympy.Expr, subs: dict) -> complex | None:
    try:
        return _to_complex(expr.subs(subs).evalf())
    except Exception:  # noqa: BLE001
        return None


def _tol(a: complex, b: complex) -> float:
    return max(1e-9, 1e-6 * (1.0 + abs(a) + abs(b)))


def _fmt(z) -> Any:
    if isinstance(z, bool):
        return z
    if isinstance(z, int):
        return z
    if isinstance(z, float):
        return round(z, 6)
    if isinstance(z, complex):
        if abs(z.imag) < 1e-9:
            return round(z.real, 6)
        sign = "+" if z.imag >= 0 else "-"
        return f"{round(z.real, 6)}{sign}{round(abs(z.imag), 6)}i"
    return str(z)


def _numeric_check(
    left: sympy.Expr, right: sympy.Expr, glob: dict, per: dict, samples: int
) -> dict[str, Any] | None:
    syms = sorted(left.free_symbols | right.free_symbols, key=lambda s: s.name)

    if not syms:  # both sides constant
        lv, rv = _eval(left, {}), _eval(right, {})
        if lv is None or rv is None:
            return None
        if abs(lv - rv) <= _tol(lv, rv):
            return {"equivalent": True, "method": "numeric"}
        return {
            "equivalent": False,
            "method": "numeric",
            "counterexample": {"values": {}, "lhsVal": _fmt(lv), "rhsVal": _fmt(rv)},
        }

    rng = random.Random(_SEED)
    valid = 0
    attempts = 0
    while valid < samples and attempts < samples * 8:
        attempts += 1
        subs = {s: _sample(assumptions_for(s.name, glob, per), rng) for s in syms}
        lv, rv = _eval(left, subs), _eval(right, subs)
        if lv is None or rv is None:
            continue
        valid += 1
        if abs(lv - rv) > _tol(lv, rv):
            return {
                "equivalent": False,
                "method": "numeric",
                "counterexample": {
                    "values": {s.name: _fmt(subs[s]) for s in syms},
                    "lhsVal": _fmt(lv),
                    "rhsVal": _fmt(rv),
                },
            }

    if valid >= max(3, samples // 2):
        return {"equivalent": True, "method": "numeric"}
    return None  # couldn't evaluate enough points → unknown
