"""Extension -> frontend dispatch.

A frontend is any module with two names:

    EXTENSIONS: tuple[str, ...]                       # e.g. (".py",)
    extract(source: str, module: str)                 # -> (list[Node], list[Reference])

Keeping the registry a plain dict (not import-time magic) means the set of
supported languages is greppable and testable, and a half-finished frontend can
be added behind an optional dependency without breaking the core.
"""

from __future__ import annotations

from collections.abc import Callable

from cartograph.frontends import go_ts, python_ast, typescript_ts
from cartograph.model import Node, Reference

Extractor = Callable[[str, str], tuple[list[Node], list[Reference]]]

_REGISTRY: dict[str, Extractor] = {}


def register(extensions: tuple[str, ...], extractor: Extractor) -> None:
    for ext in extensions:
        _REGISTRY[ext] = extractor


def frontend_for(suffix: str) -> Extractor | None:
    return _REGISTRY.get(suffix)


def supported_extensions() -> frozenset[str]:
    return frozenset(_REGISTRY)


register(python_ast.EXTENSIONS, python_ast.extract)
register(typescript_ts.EXTENSIONS, typescript_ts.extract)
register(go_ts.EXTENSIONS, go_ts.extract)
