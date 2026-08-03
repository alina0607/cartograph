"""The normalized model every language frontend produces, and the seed payload.

A frontend never resolves references — it only knows the names it saw in one
file. It emits :class:`Node` (one per class-like type) and :class:`Reference`
(an unresolved edge whose target is a *name*). :mod:`cartograph.classgraph`
resolves those names to node keys across the whole scan, yielding :class:`Relation`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Relation kinds. The first six are UML; ``dependency``/``import`` are module-level
# and carry ``lazy`` when the import sits inside a function body (Python lazy import).
INHERITS = "inherits"
IMPLEMENTS = "implements"
COMPOSITION = "composition"
AGGREGATION = "aggregation"
ASSOCIATION = "association"
DEPENDENCY = "dependency"
IMPORT = "import"
CONTRACT = "contract"  # cross-language: same concept named in two languages
CALLS = "calls"  # a function calls another function (module/function graph)

# Node kinds.
CLASS = "class"
ABSTRACT = "abstract"
INTERFACE = "interface"
STRUCT = "struct"
FUNCTION = "function"  # a standalone (module-level) function, for the call graph


def node_key(module: str, name: str) -> str:
    """The stable identity of a class: ``module#Name``.

    Stable across re-scans (unlike an ordinal index), so the canvas app can keep a
    hand-placed box attached to the right class after the code changes.
    """
    return f"{module}#{name}"


@dataclass(frozen=True, slots=True)
class Method:
    name: str
    doc: str = ""  # docstring / leading comment, extracted verbatim from the source
    source: str = ""  # the method's own source text, shown in the detail popup


@dataclass(frozen=True, slots=True)
class Node:
    key: str
    name: str
    module: str
    kind: str  # CLASS | ABSTRACT | INTERFACE | STRUCT
    lang: str = ""  # python | typescript | go — set by the build from the file extension
    doc: str = ""  # the class docstring
    attributes: tuple[tuple[str, str], ...] = ()  # (name, type-as-written)
    methods: tuple[Method, ...] = ()


@dataclass(frozen=True, slots=True)
class Reference:
    """An edge a frontend saw but could not resolve — ``dst_name`` is a bare name."""

    src: str  # source node key
    dst_name: str  # referenced simple name, resolved later against the whole scan
    kind: str
    lazy: bool = False


@dataclass(frozen=True, slots=True)
class Relation:
    """A resolved edge: both endpoints are node keys."""

    src: str
    dst: str
    kind: str
    lazy: bool = False


@dataclass(frozen=True, slots=True)
class Seed:
    version: int = 1
    nodes: tuple[Node, ...] = ()
    relations: tuple[Relation, ...] = field(default=())

    def to_json(self) -> dict[str, object]:
        return {
            "version": self.version,
            "nodes": [
                {
                    "key": n.key,
                    "name": n.name,
                    "module": n.module,
                    "kind": n.kind,
                    "lang": n.lang,
                    "doc": n.doc,
                    "attributes": [list(a) for a in n.attributes],
                    "methods": [
                        {"name": m.name, "doc": m.doc, "source": m.source} for m in n.methods
                    ],
                }
                for n in self.nodes
            ],
            "relations": [
                {"src": r.src, "dst": r.dst, "kind": r.kind, "lazy": r.lazy}
                for r in self.relations
            ],
        }
