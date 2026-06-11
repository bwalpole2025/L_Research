# mathcheck

SymPy-based math verification microservice (FastAPI, Python 3.12). It checks
that consecutive displayed equations in a LaTeX derivation are mathematically
consistent, and verifies individual identities.

## Endpoints

| Endpoint | Body | Returns |
| --- | --- | --- |
| `GET /healthz` | — | `{status, service}` |
| `POST /parse` | `{latex, macros?}` | `{ok, sympySrepr, prettyPrinted, parser, error?}` |
| `POST /equivalent` | `{lhs, rhs, assumptions?, macros?}` | `{equivalent: true\|false\|"unknown", method, counterexample?}` |
| `POST /check-derivation` | `{steps:[latex…], assumptions?, macros?}` | per-adjacent-pair verdicts + `firstFailingPair` |
| `POST /annotate-pdf` | `{pdf_base64, findings[]}` | annotated review PDF (PyMuPDF) |
| `POST /extract-pdf` | `{pdf_base64}` | `{text, pageCount, title?, author?}` |
| `POST /embed` | `{texts:[…]}` | `{vectors:[[float…]…], model, dim}` — local sentence embeddings |
| `GET /embed/health` | — | `{available, model, dim}` |

## Embeddings (RAG document check)

`/embed` returns L2-normalised sentence embeddings used by the RAG-grounded
document check (indexing the reference library + embedding queries). It runs
**entirely locally** via `sentence-transformers` with **`BAAI/bge-small-en-v1.5`**
(384-dim) — a small, strong general English retrieval model that holds up on
scientific prose. Vectors are unit-length, so a dot product equals cosine
similarity, matching pgvector's `<=>` operator at query time.

**Runbook — one-time model download.** The model **weights download once from
Hugging Face on first use** (`POST /embed` or `GET /embed/health`). This is the
*only* network step in this service; afterwards the weights are cached on disk
(`HF_HOME=/service/.hf_cache` in the image) and nothing leaves the machine. The
Dockerfile installs a **CPU-only** build of torch. To pre-bake the weights into
the image for a fully offline first run, uncomment the `SentenceTransformer(...)`
line in the Dockerfile. Override the model with the `EMBED_MODEL` env var.

## Verification strategy (with the winning `method` reported)

1. `simplify(lhs - rhs) == 0`
2. `expand` / `trigsimp` / `radsimp` / `powsimp` / `cancel` / `factor` variants,
   then SymPy's own `expr.equals`
3. random **numerical sampling** over the free symbols (12 samples, complex-safe,
   respecting assumptions like `x>0`, `n` integer) → `"numeric"` agreement, or a
   concrete `counterexample {values, lhsVal, rhsVal}`
4. otherwise `"unknown"` — we never claim equivalence we didn't establish

Each symbolic step runs under a 5 s timeout. The default sampling domain is real
(most derivations are), but evaluation is complex-safe (e.g. `sqrt` of a negative
sample), and symbols explicitly assumed complex are sampled in ℂ.

## Macro handling

`macros` is a table of `{ "\\name": "body" }`. Bodies may take parameters with
`#1…#9`; arity is inferred from the body. Macros are **textually expanded** to a
fixed point before parsing. Examples:

```json
{ "\\Bo": "B_0", "\\pdiff": "\\frac{\\partial #1}{\\partial #2}" }
```

Before parsing we also strip `\label{…}`, `\tag{…}`, `\nonumber`/`\notag`,
spacing commands, alignment `&`, and `\\` line breaks; `align`/`gather`/… blocks
are unwrapped and split into individual equations. For a derivation line the
"value" compared is the part after the last top-level `=` (so `&= x^2+2x+1`
compares `x^2+2x+1`).

## Which parser wins on which constructs

Two LaTeX→SymPy parsers are tried in order; the one that succeeds is reported in
`parser`:

| Parser | Role | Good at | Notes |
| --- | --- | --- | --- |
| **latex2sympy2** | primary | implicit multiplication (`2x`, `\sin 2x`), `\frac`, sub/superscripts, `\partial` derivatives, `\int`, common functions — the broad real-world LaTeX of physics/calculus | bundles a parser generated for **antlr4-python3-runtime 4.7.2**, which it pins |
| **sympy `parse_latex(backend="lark")`** | fallback | inputs latex2sympy2 rejects; stricter, grammar-driven | dependency-free (Lark), no antlr |

We deliberately do **not** use SymPy's *antlr* LaTeX backend: it needs a newer
antlr runtime than latex2sympy2's 4.7.2 pin, so the two can't coexist. The Lark
backend sidesteps the conflict entirely. In practice latex2sympy2 handles almost
everything in these tests; the Lark fallback is a safety net.

## Run locally (without docker)

```bash
cd services/mathcheck
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
pytest -W ignore::DeprecationWarning
```

Normally you don't run this directly — `docker compose up` builds and starts it.
