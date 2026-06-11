"""LaTeX Studio — MathCheck microservice.

Verifies that consecutive displayed equations in a LaTeX derivation are
mathematically consistent, and checks individual identities, using SymPy.
"""

from __future__ import annotations

from typing import Any

import sympy
from fastapi import FastAPI
from pydantic import BaseModel

from .derivation import check_derivation
from .equivalence import check_equivalent
from .parsing import ParseError, parse_expression

app = FastAPI(title="LaTeX Studio MathCheck", version="0.2.0")


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "mathcheck"


@app.get("/healthz", response_model=HealthResponse)
def healthz() -> HealthResponse:
    return HealthResponse()


# ── /parse ───────────────────────────────────────────────────────────────────


class ParseRequest(BaseModel):
    latex: str
    macros: dict[str, str] | None = None


@app.post("/parse")
def parse(req: ParseRequest) -> dict[str, Any]:
    try:
        expr, parser = parse_expression(req.latex, req.macros)
    except ParseError as exc:
        return {"ok": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - never crash on bad input
        return {"ok": False, "error": f"unexpected error: {exc}"}
    return {
        "ok": True,
        "parser": parser,
        "sympySrepr": sympy.srepr(expr),
        "prettyPrinted": sympy.pretty(expr, use_unicode=True),
    }


# ── /equivalent ──────────────────────────────────────────────────────────────


class EquivalentRequest(BaseModel):
    lhs: str
    rhs: str
    assumptions: str | None = None
    macros: dict[str, str] | None = None


@app.post("/equivalent")
def equivalent(req: EquivalentRequest) -> dict[str, Any]:
    try:
        left, _ = parse_expression(req.lhs, req.macros)
        right, _ = parse_expression(req.rhs, req.macros)
    except ParseError as exc:
        return {"equivalent": "unknown", "method": "parse-error", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"equivalent": "unknown", "method": "error", "error": f"unexpected error: {exc}"}
    return check_equivalent(left, right, req.assumptions)


# ── /check-derivation ────────────────────────────────────────────────────────


class DerivationRequest(BaseModel):
    steps: list[str]
    assumptions: str | None = None
    macros: dict[str, str] | None = None


@app.post("/check-derivation")
def check_derivation_endpoint(req: DerivationRequest) -> dict[str, Any]:
    try:
        return check_derivation(req.steps, req.assumptions, req.macros)
    except Exception as exc:  # noqa: BLE001
        return {"steps": [], "transitions": [], "firstFailingPair": None, "error": f"unexpected error: {exc}"}
