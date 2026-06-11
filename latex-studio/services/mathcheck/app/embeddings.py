"""Local sentence embeddings for the RAG-grounded document check.

Embeddings run ENTIRELY locally via sentence-transformers — consistent with the
no-external-fetch ethos of this service. The only network step is the ONE-TIME
download of the model weights from Hugging Face on first use (see README runbook);
after that the model is cached on disk and nothing leaves the machine.

Model: BAAI/bge-small-en-v1.5 (384-dim). Chosen as a strong, small, general
English retrieval model that performs well on scientific/technical prose while
keeping the image and memory footprint modest. bge models are trained for
retrieval; we L2-normalise outputs so a dot product equals cosine similarity,
matching pgvector's `<=>` (cosine distance) operator used at query time.
"""

from __future__ import annotations

import os
import threading
from typing import Any

EMBED_MODEL = os.environ.get("EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBED_DIM = 384  # bge-small-en-v1.5

_model: Any = None
_model_lock = threading.Lock()
_load_error: str | None = None


def _get_model() -> Any:
    """Lazily load the model once, thread-safe. Never loaded at import time so the
    rest of the service (SymPy, annotate) starts instantly and works without torch."""
    global _model, _load_error
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None and _load_error is None:
            try:
                from sentence_transformers import SentenceTransformer

                _model = SentenceTransformer(EMBED_MODEL)
            except Exception as exc:  # noqa: BLE001
                _load_error = f"could not load embedding model '{EMBED_MODEL}': {exc}"
        if _load_error is not None:
            raise RuntimeError(_load_error)
    return _model


def embedding_available() -> bool:
    """True if the embedding model can be loaded (deps present + weights resolvable)."""
    try:
        _get_model()
        return True
    except Exception:  # noqa: BLE001
        return False


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts → list of L2-normalised float vectors (cosine-ready)."""
    if not texts:
        return []
    model = _get_model()
    vectors = model.encode(
        texts,
        normalize_embeddings=True,  # unit vectors → dot product == cosine
        convert_to_numpy=True,
        show_progress_bar=False,
        batch_size=32,
    )
    return [[float(x) for x in row] for row in vectors]
