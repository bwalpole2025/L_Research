"""LaTeX normalization: macro expansion, annotation stripping, equation splitting.

Everything here is textual (pre-parse). The goal is to turn a chunk of authored
LaTeX — possibly an ``align`` block with labels, tags and custom macros — into a
clean list of individual expression strings ready for a LaTeX→SymPy parser.
"""

from __future__ import annotations

import re

# Environments whose body is (a sequence of) equations.
_ENV_NAMES = (
    "align",
    "aligned",
    "alignat",
    "gather",
    "gathered",
    "multline",
    "eqnarray",
    "equation",
    "displaymath",
    "math",
    "split",
    "flalign",
    "dmath",
)
_ENV_RE = re.compile(
    r"\\begin\{(" + "|".join(_ENV_NAMES) + r")\*?\}(?:\{[^}]*\})?(.*?)\\end\{\1\*?\}",
    re.DOTALL,
)


def _read_group(s: str, j: int) -> tuple[str, int]:
    """Given s[j] == '{', return (inner_text, index_after_matching_'}')."""
    depth = 0
    k = j
    while k < len(s):
        if s[k] == "{":
            depth += 1
        elif s[k] == "}":
            depth -= 1
            if depth == 0:
                return s[j + 1 : k], k + 1
        k += 1
    return s[j + 1 :], len(s)  # unbalanced — best effort


def _expand_one(s: str, name: str, body: str, arity: int) -> tuple[str, int]:
    """Expand every standalone occurrence of control word ``name`` in ``s``."""
    pat = re.compile(re.escape(name) + r"(?![a-zA-Z])")
    out: list[str] = []
    i = 0
    count = 0
    while i < len(s):
        m = pat.match(s, i)
        if not m:
            out.append(s[i])
            i += 1
            continue
        j = m.end()
        args: list[str] = []
        ok = True
        for _ in range(arity):
            while j < len(s) and s[j] in " \t":
                j += 1
            if j < len(s) and s[j] == "{":
                arg, j = _read_group(s, j)
                args.append(arg)
            else:
                ok = False
                break
        if not ok:
            out.append(s[i : m.end()])
            i = m.end()
            continue
        expanded = body
        for k, arg in enumerate(args, start=1):
            expanded = expanded.replace(f"#{k}", arg)
        out.append(expanded)
        i = j
        count += 1
    return "".join(out), count


def expand_macros(latex: str, macros: dict[str, str] | None, max_depth: int = 12) -> str:
    """Textually expand a user macro table. Bodies may use ``#1``…``#9`` params.

    Keys may be given with or without the leading backslash. Expansion iterates
    to a fixed point (macros may expand into other macros) up to ``max_depth``.
    """
    if not macros:
        return latex
    table: dict[str, tuple[str, int]] = {}
    for key, body in macros.items():
        name = key if key.startswith("\\") else "\\" + key
        arity = max([0] + [int(d) for d in re.findall(r"#(\d)", body)])
        table[name] = (body, arity)

    # Expand longer macro names first so \Bo doesn't shadow \Boo, etc.
    order = sorted(table.keys(), key=len, reverse=True)
    for _ in range(max_depth):
        changed = False
        for name in order:
            body, arity = table[name]
            latex, n = _expand_one(latex, name, body, arity)
            changed = changed or n > 0
        if not changed:
            break
    return latex


def _strip_math_delims(s: str) -> str:
    s = s.strip()
    for op, cl in (("\\[", "\\]"), ("$$", "$$"), ("\\(", "\\)")):
        if s.startswith(op) and s.endswith(cl) and len(s) >= len(op) + len(cl):
            return s[len(op) : len(s) - len(cl)].strip()
    if s.startswith("$") and s.endswith("$") and len(s) >= 2:
        return s[1:-1].strip()
    return s


def _strip_environments(s: str) -> str:
    prev = None
    while prev != s:
        prev = s
        m = _ENV_RE.search(s)
        if m:
            s = s[: m.start()] + m.group(2) + s[m.end() :]
    return s


def unwrap(s: str) -> str:
    """Strip surrounding math delimiters and equation environments."""
    prev = None
    while prev != s:
        prev = s
        s = _strip_math_delims(s)
        s = _strip_environments(s)
    return s.strip()


def strip_annotations(s: str) -> str:
    """Remove non-mathematical annotations and alignment markers from one line."""
    s = re.sub(r"\\label\s*\{[^}]*\}", "", s)
    s = re.sub(r"\\tag\s*\*?\s*\{[^}]*\}", "", s)
    s = re.sub(r"\\(?:nonumber|notag)\b", "", s)
    s = re.sub(r"\\(?:qquad|quad|;|,|!|:)", " ", s)  # spacing commands
    s = re.sub(r"\\(?:left|right|big|Big|bigg|Bigg)\b", "", s)
    s = re.sub(r"^\s*\[[^\]]*\]", "", s)  # leading [2ex] from a \\[2ex] break
    s = s.replace("&", " ")  # alignment columns
    return s.strip()


_LINEBREAK_RE = re.compile(r"\\\\\*?(?:\s*\[[^\]]*\])?")


def split_equations(latex: str) -> list[str]:
    """Unwrap, split on ``\\\\`` line breaks, and strip each resulting line."""
    body = unwrap(latex)
    out: list[str] = []
    for part in _LINEBREAK_RE.split(body):
        cleaned = strip_annotations(part)
        if cleaned:
            out.append(cleaned)
    return out


def normalize_expression(latex: str, macros: dict[str, str] | None = None) -> str:
    """Full pipeline for a *single* expression (no line splitting)."""
    s = expand_macros(latex, macros)
    s = unwrap(s)
    s = strip_annotations(s)
    s = _LINEBREAK_RE.sub(" ", s)
    return s.strip()


def prepare_steps(steps: list[str], macros: dict[str, str] | None) -> list[str]:
    """Expand macros then flatten each step into individual equation strings."""
    out: list[str] = []
    for step in steps:
        expanded = expand_macros(step, macros)
        out.extend(split_equations(expanded))
    return out


def split_top_level(s: str, sep: str = "=") -> list[str]:
    """Split on ``sep`` only at brace depth 0 (so ``\\frac{a}{b}=c`` splits once)."""
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    i = 0
    while i < len(s):
        c = s[i]
        if c == "{":
            depth += 1
            cur.append(c)
        elif c == "}":
            depth = max(0, depth - 1)
            cur.append(c)
        elif depth == 0 and s.startswith(sep, i):
            # Don't split relational operators like <=, >=, != , :=, ==
            prev = s[i - 1] if i > 0 else ""
            nxt = s[i + len(sep)] if i + len(sep) < len(s) else ""
            if (prev and prev in "<>=!:") or nxt == "=":
                cur.append(c)
                i += 1
                continue
            parts.append("".join(cur))
            cur = []
            i += len(sep)
            continue
        else:
            cur.append(c)
        i += 1
    parts.append("".join(cur))
    return parts


def comparable_expression(equation: str) -> str:
    """The value carried by a derivation line: the part after the last top-level '='.

    Handles ``f(x) = (x+1)^2`` (→ ``(x+1)^2``) and the common aligned form
    ``= x^2 + 2x + 1`` (leading ``=`` from ``&=`` → ``x^2 + 2x + 1``).
    """
    raw = split_top_level(equation, "=")
    if len(raw) >= 2:  # at least one top-level '='
        nonempty = [p.strip() for p in raw if p.strip()]
        if nonempty:
            return nonempty[-1]
    return equation.strip()
