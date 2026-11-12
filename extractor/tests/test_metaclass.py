"""Metaclasses: ``metaclass=M`` is an ``instanceof`` edge, and a class deriving from a
metaclass is drawn as a metaclass (not as an abstract class, even when it derives from ABCMeta)."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURE = Path(__file__).parent / "fixtures" / "py_meta"


def test_metaclass_kinds() -> None:
    kinds = {n.name: n.kind for n in build_seed(FIXTURE).nodes}
    assert kinds == {
        "PluginMeta": "metaclass",  # derives from ABCMeta: a metaclass, not "abstract"
        "StrictMeta": "metaclass",  # derives from a metaclass found in the same scan
        "Counter": "metaclass",  # derives from type
        "Plugin": "abstract",
        "Echo": "class",
        "Strict": "class",
        "Shape": "abstract",  # metaclass=ABCMeta
        # outside the scan, drawn because a scanned class inherits from them
        "ABCMeta": "stdlib",
        "type": "stdlib",
    }


def test_metaclass_relations() -> None:
    edges = {(r.src, r.dst, r.kind) for r in build_seed(FIXTURE).relations}
    m = "plugins.py#"
    assert edges == {
        (m + "Plugin", m + "PluginMeta", "instanceof"),
        (m + "Strict", m + "StrictMeta", "instanceof"),
        (m + "StrictMeta", m + "PluginMeta", "inherits"),
        (m + "Echo", m + "Plugin", "inherits"),
        (m + "PluginMeta", "abc#ABCMeta", "inherits"),
        (m + "Counter", "builtins#type", "inherits"),
        # metaclass=ABCMeta (Shape) draws no edge: the abstract colour already says it
    }
