"""A best-effort per-operation timeout.

SymPy has no cancellation, and the FastAPI handlers run in a worker thread (so
signal-based timeouts don't apply). We run each symbolic step in a thread pool
and abandon it after ``seconds``. A timed-out thread keeps running in the
background until it finishes — acceptable for a single-user local tool, and
bounded by the small pool size.
"""

from __future__ import annotations

import concurrent.futures
from typing import Callable, TypeVar

T = TypeVar("T")


class StepTimeout(Exception):
    pass


_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="mathstep")


def run_with_timeout(fn: Callable[[], T], seconds: float) -> T:
    future = _POOL.submit(fn)
    try:
        return future.result(timeout=seconds)
    except concurrent.futures.TimeoutError as exc:
        raise StepTimeout() from exc
