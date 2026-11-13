"""Cross-language contracts: scanning a folder with both Python and TypeScript links
same-named types across the boundary, while structural edges stay within a language."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURES = Path(__file__).parent / "fixtures"
SHARED = ["Canvas", "Circle", "Color", "Drawable", "Renderer", "Shape"]


def test_contract_edges_between_same_named_types() -> None:
    seed = build_seed(FIXTURES)
    contracts = {(r.src, r.dst) for r in seed.relations if r.kind == "contract"}
    for name in SHARED:
        assert (f"py_shapes/shapes.py#{name}", f"ts_shapes/shapes.ts#{name}") in contracts


def test_structural_edges_stay_within_language() -> None:
    seed = build_seed(FIXTURES)
    node = {n.key: n for n in seed.nodes}
    for r in seed.relations:
        if r.kind == "contract":
            continue
        if node[r.dst].kind in ("stdlib", "library", "ml"):
            # a class outside the scan takes the language of the class that points at it
            assert node[r.dst].lang == node[r.src].lang
            continue
        # both endpoints live under the same fixture directory (so the same language)
        assert r.src.split("/", 1)[0] == r.dst.split("/", 1)[0]
