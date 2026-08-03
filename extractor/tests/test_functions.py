"""Standalone functions become nodes and their calls to other local functions become
``calls`` edges (the module/function graph, distinct from the class relations)."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURES = Path(__file__).parent / "fixtures"


def test_functions_are_nodes() -> None:
    seed = build_seed(FIXTURES / "py_funcs")
    fns = {n.name: n.kind for n in seed.nodes}
    assert fns == {"helper": "function", "main": "function"}


def test_calls_edge() -> None:
    seed = build_seed(FIXTURES / "py_funcs")
    edges = {(r.src.split("#")[1], r.dst.split("#")[1], r.kind) for r in seed.relations}
    assert ("main", "helper", "calls") in edges
    # a function calling itself or a builtin is not an edge
    assert not any(r.kind == "calls" and r.src == r.dst for r in seed.relations)


def test_typescript_functions_and_calls() -> None:
    seed = build_seed(FIXTURES / "ts_funcs")
    assert {n.name: n.kind for n in seed.nodes} == {"helper": "function", "run": "function"}
    edges = {(r.src.split("#")[1], r.dst.split("#")[1], r.kind) for r in seed.relations}
    assert edges == {("run", "helper", "calls")}


def test_go_functions_and_calls() -> None:
    seed = build_seed(FIXTURES / "go_funcs")
    assert {n.name: n.kind for n in seed.nodes} == {"helper": "function", "run": "function"}
    edges = {(r.src.split("#")[1], r.dst.split("#")[1], r.kind) for r in seed.relations}
    assert edges == {("run", "helper", "calls")}
