"""Golden test for the Python frontend: the shapes fixture must extract exactly
this set of classes and relations. Locks in inheritance, Protocol->implements,
aggregation (collection field) and association (scalar field)."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURE = Path(__file__).parent / "fixtures" / "py_shapes"


def test_shapes_nodes() -> None:
    seed = build_seed(FIXTURE)
    kinds = {n.key: n.kind for n in seed.nodes}
    assert kinds == {
        "shapes.py#Drawable": "interface",
        "shapes.py#Shape": "abstract",
        "shapes.py#Circle": "class",
        "shapes.py#Color": "class",
        "shapes.py#Canvas": "class",
        "shapes.py#Renderer": "class",
    }


def test_shapes_relations() -> None:
    seed = build_seed(FIXTURE)
    edges = {(r.src, r.dst, r.kind) for r in seed.relations}
    assert edges == {
        ("shapes.py#Circle", "shapes.py#Shape", "inherits"),
        ("shapes.py#Circle", "shapes.py#Drawable", "implements"),
        ("shapes.py#Canvas", "shapes.py#Shape", "aggregation"),
        # Canvas builds its own Color() in __init__ -> ownership, not a bare reference.
        ("shapes.py#Canvas", "shapes.py#Color", "composition"),
        # Renderer builds a Circle transiently, stores nothing -> dependency.
        ("shapes.py#Renderer", "shapes.py#Circle", "dependency"),
    }


def test_deterministic() -> None:
    assert build_seed(FIXTURE).to_json() == build_seed(FIXTURE).to_json()


def test_members_captured() -> None:
    seed = build_seed(FIXTURE)
    canvas = next(n for n in seed.nodes if n.name == "Canvas")
    assert dict(canvas.attributes) == {"shapes": "list[Shape]", "background": "Color"}
    assert tuple(m.name for m in canvas.methods) == ("__init__", "add")


def test_docstrings_and_source_extracted() -> None:
    seed = build_seed(FIXTURE)
    canvas = next(n for n in seed.nodes if n.name == "Canvas")
    assert canvas.doc == "A surface that owns shapes and paints them on a background."
    add = next(m for m in canvas.methods if m.name == "add")
    assert add.doc == "Add a shape to the canvas so it will be drawn."
    assert add.source.startswith("def add(self, s: Shape)")
    assert "self.shapes.append(s)" in add.source
