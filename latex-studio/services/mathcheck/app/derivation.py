"""Check that a sequence of derivation steps stays mathematically consistent."""

from __future__ import annotations

from typing import Any

import sympy

from .equivalence import check_equivalent
from .normalize import comparable_expression, prepare_steps
from .parsing import ParseError, parse_expression


def _parse_step(equation: str) -> dict[str, Any]:
    rhs = comparable_expression(equation)
    try:
        expr, parser = parse_expression(rhs)
        return {"latex": equation, "expr": expr, "parser": parser, "error": None}
    except ParseError as exc:
        return {"latex": equation, "expr": None, "parser": None, "error": str(exc)}


def check_derivation(
    steps: list[str], assumptions: str | None = None, macros: dict[str, str] | None = None
) -> dict[str, Any]:
    equations = prepare_steps(steps, macros)
    parsed = [_parse_step(eq) for eq in equations]

    transitions: list[dict[str, Any]] = []
    first_failing: int | None = None

    for i in range(len(parsed) - 1):
        a, b = parsed[i], parsed[i + 1]
        if a["expr"] is None or b["expr"] is None:
            transition: dict[str, Any] = {
                "from": i,
                "to": i + 1,
                "verdict": "unparseable",
                "error": a["error"] or b["error"],
            }
        else:
            result = check_equivalent(a["expr"], b["expr"], assumptions)
            equivalent = result["equivalent"]
            verdict = "ok" if equivalent is True else "fail" if equivalent is False else "unknown"
            transition = {"from": i, "to": i + 1, "verdict": verdict, "method": result.get("method")}
            if result.get("counterexample"):
                transition["counterexample"] = result["counterexample"]
            if verdict != "ok":
                try:
                    transition["difference"] = str(sympy.simplify(a["expr"] - b["expr"]))
                except Exception:  # noqa: BLE001
                    pass

        if transition["verdict"] != "ok" and first_failing is None:
            first_failing = i
        transitions.append(transition)

    return {
        "steps": [
            {
                "index": i,
                "latex": p["latex"],
                "parser": p["parser"],
                "parsed": sympy.srepr(p["expr"]) if p["expr"] is not None else None,
                "error": p["error"],
            }
            for i, p in enumerate(parsed)
        ],
        "transitions": transitions,
        "firstFailingPair": first_failing,
    }
