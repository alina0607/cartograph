"""TypeScript frontend built on tree-sitter.

Extracts classes and interfaces with the same model the Python frontend produces:
a node per type plus references for inheritance (``extends``), realization
(``implements``), has-a from field types (a collection type is aggregation, a
scalar is association), composition from ``this.x = new Foo()``, and dependency
from a transient ``new Foo()`` in a method. Reference targets are names; the class
graph keeps only those that resolve to a type in the same scan.
"""

from __future__ import annotations

import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser
from tree_sitter import Node as TSNode

from cartograph.model import (
    ABSTRACT,
    AGGREGATION,
    ASSOCIATION,
    CLASS,
    COMPOSITION,
    DEPENDENCY,
    IMPLEMENTS,
    INHERITS,
    INTERFACE,
    Method,
    Node,
    Reference,
    node_key,
)

EXTENSIONS = (".ts", ".tsx", ".mts", ".cts")

_PARSER = Parser(Language(tsts.language_typescript()))
_PARSER_TSX = Parser(Language(tsts.language_tsx()))

_DECLS = frozenset({"class_declaration", "abstract_class_declaration", "interface_declaration"})
# Generic containers whose element type is aggregated (held), not owned.
_CONTAINERS = frozenset(
    {"Array", "ReadonlyArray", "Set", "ReadonlySet", "Map", "ReadonlyMap", "WeakMap", "WeakSet"}
)
# Names that are never a user type worth an edge.
_NON_TYPES = frozenset(
    {
        "string", "number", "boolean", "void", "any", "unknown", "never", "null",
        "undefined", "object", "symbol", "bigint", "this", "Function", "Object",
        "String", "Number", "Boolean", "Date", "RegExp", "Error", "Promise", "JSON",
    }
)


def extract(source: str, module: str) -> tuple[list[Node], list[Reference]]:
    src = source.encode("utf-8")
    parser = _PARSER_TSX if module.endswith(".tsx") else _PARSER
    tree = parser.parse(src)
    nodes: list[Node] = []
    refs: list[Reference] = []
    for decl in _iter_decls(tree.root_node):
        node, drefs = _decl(decl, module, src)
        if node is not None:
            nodes.append(node)
            refs.extend(drefs)
    return nodes, refs


def _iter_decls(root: TSNode) -> list[TSNode]:
    out: list[TSNode] = []
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type in _DECLS:
            out.append(n)
        stack.extend(n.named_children)
    return out


def _decl(decl: TSNode, module: str, src: bytes) -> tuple[Node | None, list[Reference]]:
    name_node = decl.child_by_field_name("name") or _first(decl, "type_identifier")
    if name_node is None:
        return None, []
    name = _text(name_node, src)
    key = node_key(module, name)
    kind = (
        INTERFACE
        if decl.type == "interface_declaration"
        else ABSTRACT if decl.type == "abstract_class_declaration" else CLASS
    )

    inherits, implements = _heritage(decl, src)
    attributes, methods, agg, assoc, composes, constructs = _members(_body(decl), src)
    agg -= composes
    assoc -= composes | agg
    constructs -= composes | agg | assoc

    refs: list[Reference] = [Reference(key, b, INHERITS) for b in inherits]
    refs += [Reference(key, i, IMPLEMENTS) for i in implements]
    refs += [Reference(key, n, COMPOSITION) for n in sorted(composes)]
    refs += [Reference(key, n, AGGREGATION) for n in sorted(agg)]
    refs += [Reference(key, n, ASSOCIATION) for n in sorted(assoc)]
    refs += [Reference(key, n, DEPENDENCY) for n in sorted(constructs)]

    node = Node(
        key=key,
        name=name,
        module=module,
        kind=kind,
        doc=_leading_doc(decl, src),
        attributes=attributes,
        methods=methods,
    )
    return node, refs


def _heritage(decl: TSNode, src: bytes) -> tuple[list[str], list[str]]:
    inherits: list[str] = []
    implements: list[str] = []
    heritage = _first(decl, "class_heritage")
    if heritage is not None:
        for clause in heritage.named_children:
            names = [_base_name(c, src) for c in clause.named_children]
            target = inherits if clause.type == "extends_clause" else implements
            target.extend(n for n in names if n)
    ext = _first(decl, "extends_type_clause")  # interface extends interface
    if ext is not None:
        inherits.extend(n for n in (_base_name(c, src) for c in ext.named_children) if n)
    return inherits, implements


def _members(
    body: TSNode | None, src: bytes
) -> tuple[tuple[tuple[str, str], ...], tuple[Method, ...], set[str], set[str], set[str], set[str]]:
    attrs: dict[str, str] = {}
    methods: list[Method] = []
    agg: set[str] = set()
    assoc: set[str] = set()
    composes: set[str] = set()
    constructs: set[str] = set()
    if body is None:
        return (), (), agg, assoc, composes, constructs

    for m in body.named_children:
        if m.type in ("public_field_definition", "property_signature"):
            nm = _member_name(m)
            if nm is None:
                continue
            ann = _first(m, "type_annotation")
            type_node = _type_of(ann)
            attrs[_text(nm, src)] = _text(type_node, src) if type_node else ""
            for type_name, in_container in _types_in(ann, src):
                (agg if in_container else assoc).add(type_name)
        elif m.type in ("method_definition", "method_signature", "abstract_method_signature"):
            nm = _member_name(m)
            if nm is None:
                continue
            source = _text(m, src) if m.type == "method_definition" else ""
            methods.append(Method(name=_text(nm, src), doc=_leading_doc(m, src), source=source))
            _scan_constructions(m, src, composes, constructs)

    return tuple(attrs.items()), tuple(methods), agg, assoc, composes, constructs


def _scan_constructions(node: TSNode, src: bytes, composes: set[str], constructs: set[str]) -> None:
    stack = [node]
    while stack:
        n = stack.pop()
        if n.type == "new_expression":
            ctor = _base_name(n.child_by_field_name("constructor"), src)
            if ctor and _is_ctor(ctor):
                constructs.add(ctor)
        elif n.type == "assignment_expression":
            left = n.child_by_field_name("left")
            right = n.child_by_field_name("right")
            if (
                left is not None
                and left.type == "member_expression"
                and _is_this(left)
                and right is not None
                and right.type == "new_expression"
            ):
                ctor = _base_name(right.child_by_field_name("constructor"), src)
                if ctor and _is_ctor(ctor):
                    composes.add(ctor)
        stack.extend(n.named_children)


def _types_in(ann: TSNode | None, src: bytes) -> list[tuple[str, bool]]:
    out: list[tuple[str, bool]] = []
    _walk_type(_type_of(ann), False, out, src)
    seen: set[tuple[str, bool]] = set()
    unique: list[tuple[str, bool]] = []
    for pair in out:
        if pair not in seen:
            seen.add(pair)
            unique.append(pair)
    return unique


def _walk_type(
    node: TSNode | None, in_container: bool, out: list[tuple[str, bool]], src: bytes
) -> None:
    if node is None:
        return
    if node.type == "array_type":
        for c in node.named_children:
            _walk_type(c, True, out, src)
    elif node.type == "generic_type":
        base = _first(node, "type_identifier")
        args = _first(node, "type_arguments")
        name = _text(base, src) if base else ""
        if name in _CONTAINERS:
            if args:
                for c in args.named_children:
                    _walk_type(c, True, out, src)
        else:
            _record(name, in_container, out)
            if args:
                for c in args.named_children:
                    _walk_type(c, in_container, out, src)
    elif node.type == "union_type":
        for c in node.named_children:
            _walk_type(c, in_container, out, src)
    elif node.type == "type_identifier":
        _record(_text(node, src), in_container, out)
    elif node.type == "predefined_type":
        return
    else:
        for c in node.named_children:
            _walk_type(c, in_container, out, src)


def _record(name: str, in_container: bool, out: list[tuple[str, bool]]) -> None:
    if name and name not in _NON_TYPES and name not in _CONTAINERS:
        out.append((name, in_container))


def _is_ctor(name: str) -> bool:
    base = name.rsplit(".", 1)[-1]
    return bool(base) and base[0].isupper() and base not in _NON_TYPES and base not in _CONTAINERS


def _is_this(member: TSNode) -> bool:
    obj = member.child_by_field_name("object")
    return obj is not None and obj.type == "this"


def _body(decl: TSNode) -> TSNode | None:
    return (
        decl.child_by_field_name("body")
        or _first(decl, "class_body")
        or _first(decl, "interface_body")
        or _first(decl, "object_type")
    )


def _member_name(m: TSNode) -> TSNode | None:
    return m.child_by_field_name("name") or _first(m, "property_identifier")


def _type_of(ann: TSNode | None) -> TSNode | None:
    if ann is None:
        return None
    return next((c for c in ann.named_children), None)


def _base_name(node: TSNode | None, src: bytes) -> str:
    """The head type name of an expression: ``Foo`` / ``Foo<T>`` / ``ns.Foo`` -> ``Foo``."""
    if node is None:
        return ""
    if node.type in ("type_identifier", "identifier", "property_identifier"):
        return _text(node, src)
    if node.type == "generic_type":
        return _base_name(_first(node, "type_identifier"), src)
    if node.type == "member_expression":
        return _base_name(node.child_by_field_name("property"), src)
    if node.type == "nested_type_identifier":
        return _base_name(node.named_children[-1] if node.named_children else None, src)
    return _text(node, src)


def _leading_doc(node: TSNode, src: bytes) -> str:
    """The JSDoc/line comment directly above a declaration, cleaned to plain text."""
    c = node.prev_sibling
    if c is None or c.type != "comment" or node.start_point[0] - c.end_point[0] > 1:
        return ""
    return _clean_comment(_text(c, src))


def _clean_comment(text: str) -> str:
    t = text.strip()
    if t.startswith("/*"):
        body = t[2:].removesuffix("*/")
        lines = [ln.strip().lstrip("*").strip() for ln in body.splitlines()]
        return " ".join(ln for ln in lines if ln).strip()
    if t.startswith("//"):
        return t.lstrip("/").strip()
    return t


def _first(node: TSNode, type_: str) -> TSNode | None:
    return next((c for c in node.named_children if c.type == type_), None)


def _text(node: TSNode, src: bytes) -> str:
    return src[node.start_byte : node.end_byte].decode("utf-8", "replace")
