"""Golden test for the Go frontend: struct+methods -> class, interface -> interface,
embedding -> inheritance, and field types -> the has-a kinds."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURE = Path(__file__).parent / "fixtures" / "go_shapes"


def test_go_nodes() -> None:
    seed = build_seed(FIXTURE)
    kinds = {n.name: n.kind for n in seed.nodes}
    assert kinds == {
        "Drawable": "interface",
        "Shape": "struct",
        "Color": "struct",
        "Circle": "struct",
        "Canvas": "struct",
        "Renderer": "struct",
    }
    assert all(n.lang == "go" for n in seed.nodes)


def test_go_relations() -> None:
    seed = build_seed(FIXTURE)
    edges = {(r.src.split("#")[1], r.dst.split("#")[1], r.kind) for r in seed.relations}
    assert edges == {
        ("Circle", "Shape", "inherits"),  # embedding
        ("Circle", "Color", "association"),  # *Color
        ("Canvas", "Shape", "aggregation"),  # []Shape
        ("Canvas", "Color", "composition"),  # value Color
        ("Renderer", "Circle", "dependency"),  # composite literal in a method
    }


def test_go_methods_attach_to_receiver() -> None:
    seed = build_seed(FIXTURE)
    circle = next(n for n in seed.nodes if n.name == "Circle")
    assert tuple(m.name for m in circle.methods) == ("Area", "Draw")


def test_go_docstrings() -> None:
    seed = build_seed(FIXTURE)
    canvas = next(n for n in seed.nodes if n.name == "Canvas")
    assert canvas.doc == "Canvas owns shapes and paints them on a background."
    add = next(m for m in canvas.methods if m.name == "Add")
    assert add.doc == "Add appends a shape so it will be drawn."
