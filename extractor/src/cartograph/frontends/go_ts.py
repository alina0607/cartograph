"""Go frontend built on tree-sitter.

Go has no classes, so it maps to UML the standard way: a ``struct`` (plus the methods
whose receiver is that struct) is a class; an ``interface`` is an interface. An embedded
(anonymous) field is embedding — drawn as inheritance. A named field's type gives a has-a
edge: a value type is composition (owned), a pointer is association (a reference), and a
slice/array/map is aggregation (a held collection). A composite literal built inside a
method becomes a dependency. Targets are names; the class graph keeps only local ones.
"""

from __future__ import annotations

import tree_sitter_go as tsg
from tree_sitter import Language, Parser
from tree_sitter import Node as TSNode

from cartograph.model import (
    AGGREGATION,
    ASSOCIATION,
    CALLS,
    COMPOSITION,
    DEPENDENCY,
    FUNCTION,
    INHERITS,
    INTERFACE,
    STRUCT,
    Method,
    Node,
    Reference,
    node_key,
)

EXTENSIONS = (".go",)

_PARSER = Parser(Language(tsg.language()))


def extract(source: str, module: str) -> tuple[list[Node], list[Reference]]:
    src = source.encode("utf-8")
    root = _PARSER.parse(src).root_node

    # First pass: every named struct/interface becomes a type record.
    types: dict[str, _Type] = {}
    for spec in _find(root, "type_spec"):
        rec = _type_spec(spec, module, src)
        if rec is not None:
            types[rec.name] = rec

    # Second pass: attach methods (declared apart from the type) to their receiver.
    for md in _find(root, "method_declaration"):
        recv = _receiver_type(md, src)
        rec = types.get(recv)
        if rec is None:
            continue
        name_node = md.child_by_field_name("name")
        if name_node is not None:
            rec.methods.append(
                Method(name=_text(name_node, src), doc=_leading_doc(md, src), source=_text(md, src))
            )
        _scan_composite(md, src, rec.constructs)

    nodes: list[Node] = []
    refs: list[Reference] = []
    for rec in types.values():
        structural = {r.dst_name for r in rec.refs}
        for ctor in sorted(rec.constructs):
            if ctor != rec.name and ctor not in structural:
                rec.refs.append(Reference(rec.key, ctor, DEPENDENCY))
        nodes.append(
            Node(
                key=rec.key,
                name=rec.name,
                module=module,
                kind=rec.kind,
                doc=rec.doc,
                attributes=tuple(rec.attributes),
                methods=tuple(rec.methods),
            )
        )
        refs.extend(rec.refs)

    for fd in _find(root, "function_declaration"):  # standalone funcs (methods handled above)
        node, frefs = _function_node(fd, module, src)
        nodes.append(node)
        refs.extend(frefs)
    return nodes, refs


def _function_node(fd: TSNode, module: str, src: bytes) -> tuple[Node, list[Reference]]:
    name_node = fd.child_by_field_name("name")
    name = _text(name_node, src) if name_node is not None else ""
    key = node_key(module, name)
    seen: set[str] = set()
    refs: list[Reference] = []
    for call in _find(fd, "call_expression"):
        callee = call.child_by_field_name("function")
        if callee is not None and callee.type == "identifier":
            target = _text(callee, src)
            if target and target != name and target not in seen:
                seen.add(target)
                refs.append(Reference(src=key, dst_name=target, kind=CALLS))
    node = Node(key=key, name=name, module=module, kind=FUNCTION, doc=_leading_doc(fd, src))
    return node, refs


class _Type:
    def __init__(self, name: str, key: str, kind: str, doc: str = "") -> None:
        self.name = name
        self.key = key
        self.kind = kind
        self.doc = doc
        self.attributes: list[tuple[str, str]] = []
        self.methods: list[Method] = []
        self.refs: list[Reference] = []
        self.constructs: set[str] = set()


def _type_spec(spec: TSNode, module: str, src: bytes) -> _Type | None:
    name_node = _first(spec, "type_identifier")
    body = _first(spec, "struct_type") or _first(spec, "interface_type")
    if name_node is None or body is None:
        return None
    name = _text(name_node, src)
    key = node_key(module, name)
    doc = _doc_for_type(spec, src)
    if body.type == "interface_type":
        rec = _Type(name, key, INTERFACE, doc)
        for child in body.named_children:
            if child.type == "method_elem":
                mn = _first(child, "field_identifier")
                if mn is not None:
                    rec.methods.append(Method(name=_text(mn, src)))
            elif child.type in ("type_identifier", "qualified_type"):  # embedded interface
                rec.refs.append(Reference(key, _base_name(child, src), INHERITS))
        return rec

    rec = _Type(name, key, STRUCT, doc)
    fields = _first(body, "field_declaration_list")
    for fd in fields.named_children if fields else ():
        if fd.type != "field_declaration":
            continue
        fid = _first(fd, "field_identifier")
        type_node = _field_type(fd)
        if fid is None:  # embedded struct -> inheritance
            base = _base_name(type_node, src) if type_node else ""
            if base:
                rec.refs.append(Reference(key, base, INHERITS))
            continue
        if type_node is None:
            continue
        rec.attributes.append((_text(fid, src), _text(type_node, src)))
        target = _has_a(type_node, src)
        if target is not None:
            dst_name, kind = target
            rec.refs.append(Reference(key, dst_name, kind))
    return rec


def _field_type(fd: TSNode) -> TSNode | None:
    # The type of a field_declaration is its last named child (name comes first).
    for child in reversed(fd.named_children):
        if child.type != "field_identifier":
            return child
    return None


def _has_a(type_node: TSNode, src: bytes) -> tuple[str, str] | None:
    t = type_node.type
    if t == "type_identifier":
        return _text(type_node, src), COMPOSITION
    if t == "pointer_type":
        inner = _first(type_node, "type_identifier")
        return (_text(inner, src), ASSOCIATION) if inner else None
    if t in ("slice_type", "array_type"):
        inner = _first(type_node, "type_identifier")
        return (_text(inner, src), AGGREGATION) if inner else None
    if t == "map_type":
        vals = [c for c in type_node.named_children if c.type == "type_identifier"]
        return (_text(vals[-1], src), AGGREGATION) if vals else None
    if t == "qualified_type":  # pkg.Type — external, dropped unless a local shares the name
        return _base_name(type_node, src), ASSOCIATION
    return None


def _receiver_type(md: TSNode, src: bytes) -> str:
    recv = _first(md, "parameter_list")
    if recv is None:
        return ""
    decl = _first(recv, "parameter_declaration")
    if decl is None:
        return ""
    type_node = _field_type(decl) or (decl.named_children[-1] if decl.named_children else None)
    return _base_name(type_node, src) if type_node else ""


def _scan_composite(node: TSNode, src: bytes, constructs: set[str]) -> None:
    stack = [node]
    while stack:
        n = stack.pop()
        if n.type == "composite_literal":
            t = n.child_by_field_name("type") or _first(n, "type_identifier")
            base = _base_name(t, src) if t is not None else ""
            if base:
                constructs.add(base)
        stack.extend(n.named_children)


def _base_name(node: TSNode | None, src: bytes) -> str:
    if node is None:
        return ""
    if node.type in ("type_identifier", "field_identifier", "identifier", "package_identifier"):
        return _text(node, src)
    if node.type == "pointer_type":
        return _base_name(_first(node, "type_identifier"), src)
    if node.type == "qualified_type":  # pkg.Type -> Type
        ids = [
            c for c in node.named_children if c.type in ("type_identifier", "package_identifier")
        ]
        return _text(ids[-1], src) if ids else ""
    if node.type == "generic_type":
        return _base_name(_first(node, "type_identifier"), src)
    return ""


def _doc_for_type(spec: TSNode, src: bytes) -> str:
    # A type's doc comment sits above its `type` declaration; a grouped spec has it above the spec.
    decl = spec.parent
    if decl is not None and decl.type == "type_declaration":
        return _leading_doc(decl, src)
    return _leading_doc(spec, src)


def _leading_doc(node: TSNode, src: bytes) -> str:
    """Consecutive Go ``//`` (or a ``/* */``) doc lines immediately above a declaration."""
    lines: list[str] = []
    c = node.prev_sibling
    row = node.start_point[0]
    while c is not None and c.type == "comment" and c.end_point[0] == row - 1:
        lines.append(_clean_line(_text(c, src)))
        row = c.start_point[0]
        c = c.prev_sibling
    lines.reverse()
    return " ".join(ln for ln in lines if ln).strip()


def _clean_line(text: str) -> str:
    t = text.strip()
    if t.startswith("/*"):
        return " ".join(t[2:].removesuffix("*/").split())
    return t.lstrip("/").strip()


def _find(root: TSNode, type_: str) -> list[TSNode]:
    # Pre-order, document order (push children reversed so they pop left-to-right), so a
    # type's methods keep their source order.
    out: list[TSNode] = []
    stack = [root]
    while stack:
        n = stack.pop()
        if n.type == type_:
            out.append(n)
        stack.extend(reversed(n.named_children))
    return out


def _first(node: TSNode, type_: str) -> TSNode | None:
    return next((c for c in node.named_children if c.type == type_), None)


def _text(node: TSNode, src: bytes) -> str:
    return src[node.start_byte : node.end_byte].decode("utf-8", "replace")
