"""Standalone functions become nodes and their calls to other local functions become
``calls`` edges (the module/function graph, distinct from the class relations)."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURE = Path(__file__).parent / "fixtures" / "py_funcs"


def test_functions_are_nodes() -> None:
    seed = build_seed(FIXTURE)
    fns = {n.name: n.kind for n in seed.nodes}
    assert fns == {"helper": "function", "main": "function"}


def test_calls_edge() -> None:
    seed = build_seed(FIXTURE)
    edges = {(r.src.split("#")[1], r.dst.split("#")[1], r.kind) for r in seed.relations}
    assert ("main", "helper", "calls") in edges
    # a function calling itself or a builtin is not an edge
    assert not any(r.kind == "calls" and r.src == r.dst for r in seed.relations)
