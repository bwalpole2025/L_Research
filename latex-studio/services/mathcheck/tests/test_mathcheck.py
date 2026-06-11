"""Acceptance tests for the mathcheck service (exercised through the HTTP API)."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def equiv(lhs, rhs, **kw):
    return client.post("/equivalent", json={"lhs": lhs, "rhs": rhs, **kw}).json()


def test_polynomial_equivalent_symbolic():
    r = equiv("(x+1)^2", "x^2+2x+1")
    assert r["equivalent"] is True
    assert r["method"] != "numeric"  # established symbolically


def test_double_angle_equivalent():
    r = equiv(r"\sin(2x)", r"2 \sin x \cos x")
    assert r["equivalent"] is True  # trigsimp or numeric


def test_derivation_with_planted_error():
    # Error planted at step 3 (index 2): 3x instead of 2x.
    steps = ["(x+1)^2", "x^2 + 2x + 1", "x^2 + 3x + 1", "x^2 + 3x + 1"]
    r = client.post("/check-derivation", json={"steps": steps}).json()
    t = r["transitions"]
    assert t[0]["verdict"] == "ok"
    assert t[1]["verdict"] == "fail"  # step 2 → 3
    assert "counterexample" in t[1]
    assert set(t[1]["counterexample"]["values"]) == {"x"}
    assert t[2]["verdict"] == "ok"
    assert r["firstFailingPair"] == 1


def test_sqrt_x_squared_needs_assumption():
    r = equiv(r"\sqrt{x^2}", "x")
    assert r["equivalent"] is False
    assert "counterexample" in r

    r2 = equiv(r"\sqrt{x^2}", "x", assumptions="x >= 0")
    assert r2["equivalent"] is True


def test_custom_macro_parses_and_verifies():
    macros = {"\\sqr": "(#1)^2"}
    p = client.post("/parse", json={"latex": r"\sqr{x+1}", "macros": macros}).json()
    assert p["ok"] is True

    r = equiv(r"\sqr{x+1}", "x^2 + 2x + 1", macros=macros)
    assert r["equivalent"] is True


def test_macro_table_partial_derivative_and_constant():
    macros = {"\\Bo": "B_0", "\\pdiff": r"\frac{\partial #1}{\partial #2}"}
    p = client.post("/parse", json={"latex": r"\pdiff{f}{x}", "macros": macros}).json()
    assert p["ok"] is True
    assert "Derivative" in p["sympySrepr"]

    p2 = client.post("/parse", json={"latex": r"\Bo + 1", "macros": macros}).json()
    assert p2["ok"] is True


def test_unparseable_degrades_gracefully():
    # /parse → clear failure, no crash.
    p = client.post("/parse", json={"latex": "@@@@"}).json()
    assert p["ok"] is False
    assert p["error"]

    # /equivalent → unknown via parse-error, never a (false) verdict.
    r = equiv("@@@@", "x")
    assert r["equivalent"] == "unknown"
    assert r["method"] == "parse-error"

    # /check-derivation → an unparseable step is flagged, the rest is unaffected.
    d = client.post("/check-derivation", json={"steps": ["x + 1", "@@@@", "x + 1"]}).json()
    assert any(t["verdict"] == "unparseable" for t in d["transitions"])


def test_align_block_is_split_into_steps():
    align = r"\begin{align} f(x) &= (x+1)^2 \label{a} \\ &= x^2 + 2x + 1 \end{align}"
    d = client.post("/check-derivation", json={"steps": [align]}).json()
    assert len(d["steps"]) == 2
    assert d["transitions"][0]["verdict"] == "ok"
