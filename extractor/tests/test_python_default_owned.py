"""A class that builds its own default member owns it: ``x or Cls()`` is composition."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

SOURCE = '''
class Config:
    pass


class Other:
    pass


class OrDefault:
    def __init__(self, config=None):
        self.config = config or Config()


class IfDefault:
    def __init__(self, config=None):
        self.config = Config() if config is None else config


class Given:
    def __init__(self, config: Other):
        self.config = config or None
'''


def _edges(tmp_path: Path) -> set[tuple[str, str, str]]:
    (tmp_path / "m.py").write_text(SOURCE, encoding="utf-8")
    seed = build_seed(tmp_path)
    return {(r.src, r.dst, r.kind) for r in seed.relations}


def test_or_default_is_composition(tmp_path: Path) -> None:
    assert ("m.py#OrDefault", "m.py#Config", "composition") in _edges(tmp_path)


def test_if_default_is_composition(tmp_path: Path) -> None:
    assert ("m.py#IfDefault", "m.py#Config", "composition") in _edges(tmp_path)


def test_no_construction_is_not_composition(tmp_path: Path) -> None:
    edges = _edges(tmp_path)
    assert not any(src == "m.py#Given" and kind == "composition" for src, _, kind in edges)
