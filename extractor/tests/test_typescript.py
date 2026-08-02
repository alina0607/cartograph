"""Golden test for the TypeScript frontend: the shapes fixture must extract exactly this
set of classes/interfaces and relations, mirroring the Python fixture."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURE = Path(__file__).parent / "fixtures" / "ts_shapes"


def test_ts_nodes() -> None:
    seed = build_seed(FIXTURE)
    kinds = {n.name: n.kind for n in seed.nodes}
    assert kinds == {
        "Drawable": "interface",
        "Shape": "abstract",
        "Circle": "class",
        "Color": "class",
        "Canvas": "class",
        "Renderer": "class",
    }
    assert all(n.lang == "typescript" for n in seed.nodes)


def test_ts_relations() -> None:
    seed = build_seed(FIXTURE)
    edges = {(r.src.split("#")[1], r.dst.split("#")[1], r.kind) for r in seed.relations}
    assert edges == {
        ("Circle", "Shape", "inherits"),
        ("Circle", "Drawable", "implements"),
        ("Canvas", "Shape", "aggregation"),
        ("Canvas", "Color", "composition"),
        ("Renderer", "Circle", "dependency"),
    }


def test_ts_members() -> None:
    seed = build_seed(FIXTURE)
    canvas = next(n for n in seed.nodes if n.name == "Canvas")
    assert dict(canvas.attributes) == {"shapes": "Shape[]", "background": "Color"}
    assert tuple(m.name for m in canvas.methods) == ("constructor", "add")
