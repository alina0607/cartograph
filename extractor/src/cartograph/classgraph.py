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

import sys
from collections import defaultdict
from dataclasses import replace

from cartograph.model import (
    AGGREGATION,
    ASSOCIATION,
    CALLS,
    COMPOSITION,
    CONTRACT,
    DEPENDENCY,
    FUNCTION,
    IMPLEMENTS,
    INHERITS,
    INSTANCE_OF,
    INTERFACE,
    LIBRARY,
    METACLASS,
    ML,
    ML_PACKAGES,
    STDLIB,
    Node,
    Reference,
    Relation,
    node_key,
)

_HAS_A = (COMPOSITION, AGGREGATION, ASSOCIATION)
_TREE = (INHERITS, IMPLEMENTS)
# Relations that may point outside the scan (to a stdlib or third-party class).
_EXTERNAL_OK = (INHERITS, INSTANCE_OF, COMPOSITION)


def resolve(
    nodes: list[Node], refs: list[Reference], local_packages: frozenset[str] = frozenset()
) -> tuple[Relation, ...]:
    """Resolve references to relations. ``local_packages`` are extra top-level package names
    that are this project's own (the scanned folder's name, when it is itself a package)."""
    by_name: dict[str, list[str]] = defaultdict(list)
    for n in nodes:
        by_name[n.name].append(n.key)
    kind_of = {n.key: n.kind for n in nodes}
    module_of = {n.key: n.module for n in nodes}
    lang_of = {n.key: n.lang for n in nodes}

    structural: list[Relation] = []
    structural_pairs: set[tuple[str, str]] = set()
    dep_refs: list[Reference] = []
    calls_refs: list[Reference] = []
    seen: set[tuple[str, str, str, bool]] = set()

    local_tops = {_top_package(m) for m in module_of.values()} | local_packages

    for ref in refs:
        if ref.kind == DEPENDENCY:
            dep_refs.append(ref)
            continue
        if ref.kind == CALLS:
            calls_refs.append(ref)
            continue
        # An explicit import from outside the project (``from collections import Counter``)
        # names that class, even when the scan also has a class of the same name elsewhere.
        # A bare builtin name only counts when nothing in the scan matches.
        dst = None if ref.qualname.startswith("builtins.") else _external_key(ref, local_tops)
        if dst is None:
            dst = _resolve_one(ref, by_name, module_of, lang_of, kind_of)
        if dst is None:
            dst = _external_key(ref, local_tops)
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
    edges += _dependency_edges(
        dep_refs, structural_pairs, seen, by_name, module_of, lang_of, kind_of
    )
    edges = _drop_inherited_has_a(edges)
    edges += _call_edges(calls_refs, by_name, module_of, lang_of, kind_of, seen)
    edges += _contract_edges(nodes)
    edges.sort(key=lambda r: (r.src, r.dst, r.kind, r.lazy))
    return tuple(edges)


def _dependency_edges(
    dep_refs: list[Reference],
    structural_pairs: set[tuple[str, str]],
    seen: set[tuple[str, str, str, bool]],
    by_name: dict[str, list[str]],
    module_of: dict[str, str],
    lang_of: dict[str, str],
    kind_of: dict[str, str],
) -> list[Relation]:
    """Keep a transient construction only when the target is a local class in the same
    package and the pair is not already joined by a structural edge."""
    out: list[Relation] = []
    for ref in dep_refs:
        dst = _resolve_one(ref, by_name, module_of, lang_of, kind_of)
        if dst is None or dst == ref.src or (ref.src, dst) in structural_pairs:
            continue
        if _pkg_dir(module_of[ref.src]) != _pkg_dir(module_of.get(dst, "")):
            continue
        sig = (ref.src, dst, DEPENDENCY, False)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(Relation(src=ref.src, dst=dst, kind=DEPENDENCY))
    return out


def _call_edges(
    calls_refs: list[Reference],
    by_name: dict[str, list[str]],
    module_of: dict[str, str],
    lang_of: dict[str, str],
    kind_of: dict[str, str],
    seen: set[tuple[str, str, str, bool]],
) -> list[Relation]:
    """A ``calls`` edge for each function that invokes another local function by name."""
    out: list[Relation] = []
    for ref in calls_refs:
        dst = _resolve_one(ref, by_name, module_of, lang_of, kind_of, want=FUNCTION)
        if dst is None or dst == ref.src:
            continue
        sig = (ref.src, dst, CALLS, False)
        if sig in seen:
            continue
        seen.add(sig)
        out.append(Relation(src=ref.src, dst=dst, kind=CALLS))
    return out


def _resolve_one(
    ref: Reference,
    by_name: dict[str, list[str]],
    module_of: dict[str, str],
    lang_of: dict[str, str],
    kind_of: dict[str, str],
    want: str | None = None,
) -> str | None:
    # ``want`` restricts to one node kind (functions for calls); otherwise structural edges
    # target class-like nodes, never functions.
    names = by_name.get(ref.dst_name, [])
    if want is not None:
        candidates = [c for c in names if kind_of.get(c) == want]
    else:
        candidates = [c for c in names if kind_of.get(c) != FUNCTION]
    if not candidates:
        return None
    # A structural edge (inherits/has-a/...) stays within one language — a Python class
    # never extends a TypeScript one. Cross-language links are handled separately.
    src_lang = lang_of.get(ref.src, "")
    pool = [c for c in candidates if lang_of.get(c, "") == src_lang] if src_lang else candidates
    if not pool:
        return None
    if len(pool) == 1:
        return pool[0]
    src_module = module_of.get(ref.src)
    same_module = [c for c in pool if module_of.get(c) == src_module]
    if len(same_module) == 1:
        return same_module[0]
    return min(same_module or pool)


def _contract_edges(nodes: list[Node]) -> list[Relation]:
    """Cross-language contracts: a type named the same in two languages is the same concept
    across the boundary (e.g. a ``User`` model in both a Python service and its TS client)."""
    by_name: dict[str, list[Node]] = defaultdict(list)
    for n in nodes:
        if n.kind != FUNCTION:  # cross-language concepts are types, not functions
            by_name[n.name].append(n)
    out: list[Relation] = []
    for group in by_name.values():
        langs = {n.lang for n in group if n.lang}
        if len(langs) < 2:
            continue
        keys = sorted(group, key=lambda n: n.key)
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                if keys[i].lang != keys[j].lang:
                    out.append(Relation(src=keys[i].key, dst=keys[j].key, kind=CONTRACT))
    return out


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


def mark_metaclasses(nodes: list[Node], relations: tuple[Relation, ...]) -> list[Node]:
    """Return the nodes with every subclass of a metaclass marked as a metaclass too.

    The frontend knows only the standard-library metaclasses by name, so ``class Sub(MyMeta)``
    arrives as a plain class; once ``inherits`` edges are resolved, ``Sub`` is a metaclass.
    """
    kind_of = {n.key: n.kind for n in nodes}
    changed = True
    while changed:  # a chain Sub2 -> Sub -> MyMeta needs more than one pass
        changed = False
        for r in relations:
            is_sub = r.kind == INHERITS and kind_of.get(r.dst) == METACLASS
            if is_sub and kind_of[r.src] != METACLASS:
                kind_of[r.src] = METACLASS
                changed = True
    return [replace(n, kind=kind_of[n.key]) if kind_of[n.key] != n.kind else n for n in nodes]


def _top_package(module: str) -> str:
    """``recsys/models/sasrec.py`` -> ``recsys``; ``plugins.py`` -> ``plugins``."""
    return module.split("/", 1)[0].removesuffix(".py")


def _external_key(ref: Reference, local_tops: set[str]) -> str | None:
    """The node key of the outside class a reference names, or None if it is not one.

    Only imported names count, and not ones from this project's own top-level packages:
    an unresolved ``from recsys.x import Y`` is a scan gap, not a library class.
    """
    if ref.kind not in _EXTERNAL_OK or "." not in ref.qualname:
        return None
    if ref.qualname.split(".", 1)[0] in local_tops:
        return None
    module, name = ref.qualname.rsplit(".", 1)
    return node_key(module, name)


def external_nodes(nodes: list[Node], relations: tuple[Relation, ...]) -> list[Node]:
    """A node for every relation target outside the scan, coloured by where it comes from."""
    known = {n.key for n in nodes}
    lang_of = {n.key: n.lang for n in nodes}
    out: dict[str, Node] = {}
    for r in relations:
        if r.dst in known or r.dst in out:
            continue
        module, name = r.dst.split("#", 1)
        top = module.split(".", 1)[0]
        if top == "builtins" or top in sys.stdlib_module_names:
            kind = STDLIB
        elif top in ML_PACKAGES:
            kind = ML
        else:
            kind = LIBRARY
        lang = lang_of.get(r.src, "")
        out[r.dst] = Node(key=r.dst, name=name, module=module, kind=kind, lang=lang)
    return [out[k] for k in sorted(out)]

