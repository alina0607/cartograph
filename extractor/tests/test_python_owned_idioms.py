"""Two more ways a class builds what it holds: a chained ``.to()``, and ``super().__init__``."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

SOURCE = '''
class Net:
    pass


class Config:
    pass


class Builder:
    pass


class Moved:
    def fit(self, device):
        self.net = Net().to(device).eval()


class Built:
    def __init__(self):
        self.thing = Builder().build()


class Base:
    def __init__(self, config=None):
        self.config = config


class HandsUp(Base):
    def __init__(self, config=None):
        super().__init__(config or Config())


class HandsUpByKeyword(Base):
    def __init__(self, config=None):
        super().__init__(config=Config() if config is None else config)


class PassesThrough(Base):
    def __init__(self, config: Config):
        super().__init__(config)


class CallsAnotherMethod(Base):
    def __init__(self):
        super().setup(Config())
'''


def _edges(tmp_path: Path) -> set[tuple[str, str, str]]:
    (tmp_path / "m.py").write_text(SOURCE, encoding="utf-8")
    seed = build_seed(tmp_path)
    return {(r.src, r.dst, r.kind) for r in seed.relations}


def _kinds(edges: set[tuple[str, str, str]], src: str, dst: str) -> set[str]:
    return {kind for s, d, kind in edges if s == f"m.py#{src}" and d == f"m.py#{dst}"}


def test_construction_moved_with_to_and_eval_is_composition(tmp_path: Path) -> None:
    assert _kinds(_edges(tmp_path), "Moved", "Net") == {"composition"}


def test_other_chained_calls_are_not_seen_through(tmp_path: Path) -> None:
    # build() may return anything; the Builder itself is only used, not stored.
    assert _kinds(_edges(tmp_path), "Built", "Builder") == {"dependency"}


def test_default_built_and_handed_to_super_init_is_composition(tmp_path: Path) -> None:
    edges = _edges(tmp_path)
    assert _kinds(edges, "HandsUp", "Config") == {"composition"}
    assert _kinds(edges, "HandsUpByKeyword", "Config") == {"composition"}


def test_passing_the_callers_object_up_is_not_composition(tmp_path: Path) -> None:
    # Handed in by the caller: not built here, so no ownership edge.
    assert "composition" not in _kinds(_edges(tmp_path), "PassesThrough", "Config")


def test_only_super_init_counts(tmp_path: Path) -> None:
    assert "composition" not in _kinds(_edges(tmp_path), "CallsAnotherMethod", "Config")
