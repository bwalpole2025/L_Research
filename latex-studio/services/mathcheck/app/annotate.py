"""Annotate a COPY of a compiled PDF with review findings (PyMuPDF / fitz).

The clean original is never touched — the caller passes the PDF bytes and gets a
new annotated PDF back. We add colour-coded highlights with popups, an appended
legend page (the honesty contract), and an index page whose rows are internal
links to each highlight, plus a back-link from every highlight to the index.

PyMuPDF is AGPL-3.0; acceptable for this single-user, locally-hosted tool. See
docs/decisions.md ADR-009.
"""

from __future__ import annotations

import base64
from typing import Any

import fitz  # PyMuPDF

A4 = (595.0, 842.0)
AXIS_ORDER = ["maths", "literature", "background", "prose"]
SEV_ORDER = {"error": 0, "warning": 1, "info": 2}

LEGEND_ROWS = [
    ((0.53, 0.94, 0.67), "light green", "Wrong equation — SymPy-verified algebra error (machine-checked)."),
    ((0.94, 0.27, 0.27), "red", "Broken cross-reference / \\cite — deterministic (machine-checked)."),
    ((0.94, 0.27, 0.27), "red underline", "Wrong grammar/spelling — deterministic en-GB check (reliable)."),
    ((0.98, 0.45, 0.09), "orange", "RAG discrepancy — a retrieved library passage conflicts (quoted in popup); confirm vs source."),
    ((0.99, 0.90, 0.54), "light yellow", "Wrong statement — LLM judgement; verify against the source (may be wrong)."),
    ((0.61, 0.64, 0.69), "grey", "Unverified note (unknown maths / no library source) — NOT an error, NOT a pass."),
]

HONESTY = [
    "GREEN (algebra) and RED (referencing, spelling) are machine-verified. ORANGE discrepancies are",
    "grounded in a passage RETRIEVED from your local library — the evidence is quoted in the popup;",
    "confirm against the source. YELLOW is LLM judgement that may be wrong either way.",
    "",
    "The model may NOT assert a physics or citation discrepancy without a retrieved passage:",
    "'no source in library' is reported as such — never as an error, never as a silent pass.",
    "A clean check means SymPy found no algebra error in what it could parse and nothing in the",
    "library contradicts the prose checked — NOT that the document is correct. Retrieval is over",
    "the local library only; no web is consulted, and reference text never reaches SymPy.",
]


def _rect(values: list[float]) -> fitz.Rect | None:
    try:
        r = fitz.Rect(values[0], values[1], values[2], values[3])
    except Exception:  # noqa: BLE001
        return None
    if r.is_empty or r.is_infinite or r.width <= 0 or r.height <= 0:
        return None
    return r


def _legend_page(doc: fitz.Document) -> int:
    page = doc.new_page(-1, width=A4[0], height=A4[1])
    page.insert_text((40, 56), "Document Review — legend", fontsize=18)
    y = 92
    for rgb, name, desc in LEGEND_ROWS:
        page.draw_rect(fitz.Rect(40, y - 9, 60, y + 3), color=rgb, fill=rgb)
        page.insert_text((70, y), f"{name}", fontsize=10, color=(0, 0, 0))
        page.insert_text((170, y), desc, fontsize=9, color=(0.15, 0.15, 0.15))
        y += 26
    y += 10
    for line in HONESTY:
        page.insert_text((40, y), line, fontsize=9, color=(0.1, 0.1, 0.1))
        y += 14
    return page.number


def _index_pages(doc: fitz.Document, findings: list[dict[str, Any]], targets: dict[str, tuple[int, fitz.Point]]) -> int:
    page = doc.new_page(-1, width=A4[0], height=A4[1])
    first_index = page.number
    page.insert_text((40, 56), "Document Review — index", fontsize=18)
    y = 92
    ordered = sorted(
        findings,
        key=lambda f: (AXIS_ORDER.index(f["axis"]) if f["axis"] in AXIS_ORDER else 9, SEV_ORDER.get(f["severity"], 3)),
    )
    current_axis = None
    for f in ordered:
        if y > 800:
            page = doc.new_page(-1, width=A4[0], height=A4[1])
            y = 56
            current_axis = None
        if f["axis"] != current_axis:
            current_axis = f["axis"]
            page.insert_text((40, y), current_axis.upper(), fontsize=12, color=(0.2, 0.2, 0.2))
            y += 18
        label = f.get("indexLabel", f.get("message", ""))[:96]
        page.insert_text((54, y), f"• {label}", fontsize=9, color=(0.1, 0.1, 0.1))
        tgt = targets.get(f["id"])
        if tgt is not None:
            tpno, tpt = tgt
            page.insert_link({"kind": fitz.LINK_GOTO, "from": fitz.Rect(50, y - 9, 555, y + 3), "page": tpno, "to": tpt})
        y += 15
    return first_index


def _summary_pages(doc: fitz.Document, summary: dict[str, Any]) -> None:
    """Append the AI's overall feedback as wrapped text page(s) — clearly labelled
    commentary, never a verdict."""
    title = str(summary.get("title", "Feedback"))
    text = str(summary.get("text", "")).strip()
    if not text:
        return
    remaining = text
    first = True
    while remaining:
        page = doc.new_page(-1, width=A4[0], height=A4[1])
        y = 56
        if first:
            page.insert_text((40, y), title, fontsize=15)
            y += 30
            first = False
        box = fitz.Rect(40, y, A4[0] - 40, A4[1] - 56)
        leftover = page.insert_textbox(box, remaining, fontsize=10, color=(0.1, 0.1, 0.1), lineheight=1.45)
        if leftover >= 0:  # everything fitted
            break
        # insert_textbox returns a negative number when text overflows; PyMuPDF
        # gives no split point, so estimate by character budget and continue.
        approx_chars = int((box.height / (10 * 1.45)) * (box.width / 5.2))
        cut = remaining.rfind(" ", 0, max(approx_chars, 200))
        if cut <= 0:
            break
        remaining = remaining[cut + 1 :]


def annotate_pdf(pdf_b64: str, findings: list[dict[str, Any]], summary: dict[str, Any] | None = None) -> dict[str, Any]:
    doc = fitz.open(stream=base64.b64decode(pdf_b64), filetype="pdf")
    n_content = doc.page_count

    targets: dict[str, tuple[int, fitz.Point]] = {}
    highlights: list[tuple[int, fitz.Rect]] = []
    annotated = 0

    for f in findings:
        pno = int(f.get("page", 0)) - 1
        if not (0 <= pno < n_content):
            continue
        page = doc[pno]
        color = f.get("color", [0.6, 0.6, 0.6])
        underline = f.get("style") == "underline"  # grammar/spelling → red underline
        for raw in f.get("rects", []):
            rect = _rect(raw)
            if rect is None:
                continue
            annot = page.add_underline_annot(rect) if underline else page.add_highlight_annot(rect)
            try:
                annot.set_colors(stroke=color)
            except Exception:  # noqa: BLE001
                pass
            annot.set_info(content=f.get("popup", ""), title=str(f.get("axis", "review")))
            annot.update()
            highlights.append((pno, rect))
            annotated += 1
            if f["id"] not in targets:
                targets[f["id"]] = (pno, fitz.Point(rect.x0, max(0.0, rect.y0 - 6)))

    _legend_page(doc)
    if summary:
        _summary_pages(doc, summary)
    first_index = _index_pages(doc, findings, targets)

    # Back-link every highlight to the top of the index.
    index_point = fitz.Point(40, 56)
    for pno, rect in highlights:
        doc[pno].insert_link({"kind": fitz.LINK_GOTO, "from": rect, "page": first_index, "to": index_point})

    out = doc.tobytes(deflate=True, garbage=3)
    doc.close()
    return {"pdf_base64": base64.b64encode(out).decode("ascii"), "annotations": annotated}


def extract_text(pdf_b64: str, max_pages: int = 400) -> dict[str, Any]:
    """Extract full text + page count + offline metadata heuristics (PyMuPDF)."""
    doc = fitz.open(stream=base64.b64decode(pdf_b64), filetype="pdf")
    parts: list[str] = []
    pages = min(doc.page_count, max_pages)
    for i in range(pages):
        parts.append(doc[i].get_text("text"))
    text = "\n".join(parts)
    # Char offset where each 1-based page begins in the concatenated text, so
    # downstream chunking can recover the source page of any passage.
    page_offsets: list[dict[str, int]] = []
    cursor = 0
    for i, part in enumerate(parts):
        page_offsets.append({"page": i + 1, "charStart": cursor})
        cursor += len(part) + 1  # +1 for the joining "\n"
    meta = doc.metadata or {}
    title = (meta.get("title") or "").strip()
    if not title:
        # First-page heuristic: the first reasonably long line.
        for line in text.splitlines():
            s = line.strip()
            if 8 <= len(s) <= 200:
                title = s
                break
    n = doc.page_count
    doc.close()
    return {
        "text": text,
        "pageCount": n,
        "pageOffsets": page_offsets,
        "title": title[:300],
        "author": (meta.get("author") or "").strip()[:300],
    }
