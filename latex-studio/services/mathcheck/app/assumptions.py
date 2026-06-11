"""Parse a free-text assumptions field into SymPy symbol assumptions.

Examples it understands (comma / ``and`` separated):
  "all symbols real"          → every symbol real
  "k > 0, n integer"          → k positive, n integer
  "x >= 0"                    → x nonnegative
  "real x, positive y"        → per-symbol
"""

from __future__ import annotations

import re

_GLOBAL_PROPS = {
    "real": {"real": True},
    "reals": {"real": True},
    "positive": {"positive": True},
    "integer": {"integer": True},
    "integers": {"integer": True},
    "complex": {},  # explicit complex = drop the real default
    "rational": {"rational": True},
}

_PROP_WORDS = (
    "real",
    "positive",
    "negative",
    "nonnegative",
    "nonpositive",
    "integer",
    "complex",
    "rational",
)


def parse_assumptions(text: str | None) -> tuple[dict, dict[str, dict]]:
    """Return (global_assumptions, per_symbol_assumptions)."""
    glob: dict = {}
    per: dict[str, dict] = {}
    if not text:
        return glob, per

    for raw in re.split(r",|;|\band\b", text):
        clause = raw.strip().lower()
        if not clause:
            continue

        # "all symbols real" / "all real" / "everything positive"
        m = re.match(r"(?:all|every|everything)(?:\s+symbols?)?\s+(?:are\s+|is\s+)?(\w+)", clause)
        if m and m.group(1) in _GLOBAL_PROPS:
            glob.update(_GLOBAL_PROPS[m.group(1)])
            continue
        if clause in _GLOBAL_PROPS:
            glob.update(_GLOBAL_PROPS[clause])
            continue

        # "k > 0", "x >= 0", "p < 0"
        m = re.match(r"([a-zA-Z]\w*)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)", clause)
        if m:
            sym, op, val = m.group(1), m.group(2), float(m.group(3))
            d = per.setdefault(sym, {})
            if val == 0:
                d.update(
                    {">": {"positive": True}, ">=": {"nonnegative": True},
                     "<": {"negative": True}, "<=": {"nonpositive": True}}[op]
                )
            else:
                d["real"] = True
            continue

        # "x real" / "n integer"  or  "real x" / "integer n"
        m = re.match(r"([a-zA-Z]\w*)\s+(\w+)", clause) or re.match(r"(\w+)\s+([a-zA-Z]\w*)", clause)
        if m:
            a, b = m.group(1), m.group(2)
            sym, prop = (a, b) if b in _PROP_WORDS else (b, a)
            if prop in _PROP_WORDS:
                per.setdefault(sym, {})[prop] = True
            continue

    return glob, per


def assumptions_for(name: str, glob: dict, per: dict[str, dict]) -> dict:
    merged = dict(glob)
    merged.update(per.get(name, {}))
    return merged
