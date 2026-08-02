"""Resolve frontend :class:`Reference`s (edges to a *name*) into :class:`Relation`s
(edges to a node key), keeping only references that hit a class in this scan.

Two kinds get special treatment, mirroring how a UML tool reads a codebase:

* A base that resolves to an interface is *realization* (``implements``), not inheritance.
* A ``dependency`` (a transient construction) is kept only when the target is a local
  class in the SAME package and the pair is not already joined by a structural edge —
  so intra-package collaboration shows without cross-cutting utility noise.

Finally, a has-a edge that an ancestor already declares to the same target is dropped:
UML draws an inherited relationship once, at the superclass.
"""

from __future__ import annotations

from collections import defaultdict

from cartograph.model import (
    AGGREGATION,
    ASSOCIATION,
    COMPOSITION,
    DEPENDENCY,
    IMPLEMENTS,
    INHERITS,
    INTERFACE,
    Node,
    Reference,
    Relation,
)

_HAS_A = (COMPOSITION, AGGREGATION, ASSOCIATION)
_TREE = (INHERITS, IMPLEMENTS)


def resolve(nodes: list[Node], refs: list[Reference]) -> tuple[Relation, ...]:
    by_name: dict[str, list[str]] = defaultdict(list)
    for n in nodes:
        by_name[n.name].append(n.key)
    kind_of = {n.key: n.kind for n in nodes}
    module_of = {n.key: n.module for n in nodes}

    structural: list[Relation] = []
    structural_pairs: set[tuple[str, str]] = set()
    dep_refs: list[Reference] = []
    seen: set[tuple[str, str, str, bool]] = set()

    for ref in refs:
        if ref.kind == DEPENDENCY:
            dep_refs.append(ref)
            continue
        dst = _resolve_one(ref, by_name, module_of)
        if dst is None or dst == ref.src:
            continue
        kind = IMPLEMENTS if ref.kind == INHERITS and kind_of.get(dst) == INTERFACE else ref.kind
        sig = (ref.src, dst, kind, ref.lazy)
        if sig in seen:
            continue
        seen.add(sig)
        structural.append(Relation(src=ref.src, dst=dst, kind=kind, lazy=ref.lazy))
        structural_pairs.add((ref.src, dst))

    edges = structural
    for ref in dep_refs:
        dst = _resolve_one(ref, by_name, module_of)
        if dst is None or dst == ref.src or (ref.src, dst) in structural_pairs:
            continue
        if _pkg_dir(module_of[ref.src]) != _pkg_dir(module_of.get(dst, "")):
            continue
        sig = (ref.src, dst, DEPENDENCY, False)
        if sig in seen:
            continue
        seen.add(sig)
        edges.append(Relation(src=ref.src, dst=dst, kind=DEPENDENCY))

    edges = _drop_inherited_has_a(edges)
    edges.sort(key=lambda r: (r.src, r.dst, r.kind, r.lazy))
    return tuple(edges)


def _resolve_one(
    ref: Reference, by_name: dict[str, list[str]], module_of: dict[str, str]
) -> str | None:
    candidates = by_name.get(ref.dst_name)
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]
    src_module = module_of.get(ref.src)
    same_module = [c for c in candidates if module_of.get(c) == src_module]
    if len(same_module) == 1:
        return same_module[0]
    return min(same_module or candidates)


def _drop_inherited_has_a(edges: list[Relation]) -> list[Relation]:
    """Drop a has-a edge whose same-kind, same-target twin is declared by an ancestor.

    The member is inherited; the generalization arrow already carries it down, so the
    subclass need not repeat it. A different kind on the descendant is a genuine override
    and is kept.
    """
    parents: dict[str, list[str]] = defaultdict(list)
    has_by_src: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for e in edges:
        if e.kind in _TREE:
            parents[e.src].append(e.dst)
        elif e.kind in _HAS_A:
            has_by_src[e.src].add((e.kind, e.dst))

    def ancestor_has(cls: str, key: tuple[str, str], seen: set[str]) -> bool:
        for p in parents.get(cls, ()):
            if p in seen:
                continue
            seen.add(p)
            if key in has_by_src.get(p, ()) or ancestor_has(p, key, seen):
                return True
        return False

    kept: list[Relation] = []
    for e in edges:
        if e.kind in _HAS_A and ancestor_has(e.src, (e.kind, e.dst), set()):
            continue
        kept.append(e)
    return kept


def _pkg_dir(module: str) -> str:
    """The package a class lives in = its file's directory; same dir == same package."""
    return module.rsplit("/", 1)[0] if "/" in module else ""
