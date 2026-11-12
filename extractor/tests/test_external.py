"""Classes outside the scan: a standard-library or third-party class is drawn where a scanned
class inherits from it, uses it as a metaclass, or owns one; its kind says where it comes from."""

from __future__ import annotations

from pathlib import Path

from cartograph.build import build_seed

FIXTURE = Path(__file__).parent / "fixtures" / "py_ext"
M = "models.py#"


def test_external_kinds() -> None:
    kinds = {n.key: n.kind for n in build_seed(FIXTURE).nodes}
    assert {k: v for k, v in kinds.items() if not k.startswith(M)} == {
        "abc#ABCMeta": "stdlib",
        "collections#Counter": "stdlib",
        "enum#Enum": "stdlib",
        "builtins#ValueError": "stdlib",
        "torch.nn#Module": "library",
        "torch.nn#Embedding": "library",
        "torch.nn#Linear": "library",
    }


def test_external_relations() -> None:
    edges = {(r.src, r.dst, r.kind) for r in build_seed(FIXTURE).relations}
    assert edges == {
        (M + "Meta", "abc#ABCMeta", "inherits"),
        (M + "Net", "torch.nn#Module", "inherits"),
        (M + "Net", "torch.nn#Embedding", "composition"),
        (M + "Net", "torch.nn#Linear", "composition"),
        (M + "Pop", "collections#Counter", "composition"),
        (M + "Pop", M + "Net", "composition"),
        (M + "Color", "enum#Enum", "inherits"),
        (M + "BadInput", "builtins#ValueError", "inherits"),
        (M + "Plain", M + "Meta", "instanceof"),
    }


def test_external_nodes_are_python() -> None:
    langs = {n.lang for n in build_seed(FIXTURE).nodes}
    assert langs == {"python"}
