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


# ── /annotate-pdf — review-PDF annotation (PyMuPDF) ───────────────────────────


class AnnotateRequest(BaseModel):
    pdf_base64: str
    findings: list[dict[str, Any]]
    # Optional overall commentary appended as its own page(s): {"title", "text"}.
    summary: dict[str, Any] | None = None


@app.post("/annotate-pdf")
def annotate_pdf_endpoint(req: AnnotateRequest) -> dict[str, Any]:
    from .annotate import annotate_pdf

    try:
        return annotate_pdf(req.pdf_base64, req.findings, req.summary)
    except Exception as exc:  # noqa: BLE001 - never crash the service on a bad PDF
        return {"error": f"annotation failed: {exc}", "pdf_base64": None, "annotations": 0}


class ExtractRequest(BaseModel):
    pdf_base64: str


@app.post("/extract-pdf")
def extract_pdf_endpoint(req: ExtractRequest) -> dict[str, Any]:
    from .annotate import extract_text

    try:
        return extract_text(req.pdf_base64)
    except Exception as exc:  # noqa: BLE001
        return {"error": f"extraction failed: {exc}", "text": "", "pageCount": 0}


class PdfPngRequest(BaseModel):
    pdf_base64: str
    dpi: int = 160
    page: int = 1


@app.post("/pdf-png")
def pdf_png_endpoint(req: PdfPngRequest) -> dict[str, Any]:
    """Rasterise one PDF page to PNG (PyMuPDF) — used by the snippet renderer
    that gives the Visual editor its semi-compiled maths and TikZ diagrams."""
    import base64 as b64

    import fitz

    try:
        doc = fitz.open(stream=b64.b64decode(req.pdf_base64), filetype="pdf")
        pno = max(0, min(req.page - 1, doc.page_count - 1))
        zoom = max(36, min(req.dpi, 400)) / 72.0
        pix = doc[pno].get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=True)
        png = pix.tobytes("png")
        out = {"png_base64": b64.b64encode(png).decode("ascii"), "width": pix.width, "height": pix.height}
        doc.close()
        return out
    except Exception as exc:  # noqa: BLE001
        return {"error": f"rasterise failed: {exc}", "png_base64": "", "width": 0, "height": 0}


# ── /embed — local sentence embeddings for the RAG document check ─────────────


class EmbedRequest(BaseModel):
    texts: list[str]


@app.post("/embed")
def embed_endpoint(req: EmbedRequest) -> dict[str, Any]:
    from .embeddings import EMBED_DIM, EMBED_MODEL, embed_texts

    try:
        vectors = embed_texts(req.texts)
        return {"vectors": vectors, "model": EMBED_MODEL, "dim": EMBED_DIM}
    except Exception as exc:  # noqa: BLE001 - never crash the service if torch/model is missing
        return {"error": f"embedding failed: {exc}", "vectors": [], "model": EMBED_MODEL, "dim": EMBED_DIM}


@app.get("/embed/health")
def embed_health() -> dict[str, Any]:
    from .embeddings import EMBED_DIM, EMBED_MODEL, embedding_available

    return {"available": embedding_available(), "model": EMBED_MODEL, "dim": EMBED_DIM}
