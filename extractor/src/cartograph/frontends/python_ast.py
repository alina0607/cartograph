"""Python frontend built on the standard-library ``ast`` — zero external dependencies.

Extracts one :class:`Node` per class and references for what each class touches:
inheritance from bases, and has-a edges from annotated attribute types (a bare
type is an association, a type inside a container is an aggregation). Reference
targets are left as names; :mod:`cartograph.classgraph` keeps only those
that resolve to a class in the same scan, so stdlib/builtin types drop out.
"""

from __future__ import annotations

import ast
import builtins
import textwrap
from collections.abc import Callable

from cartograph.model import (
    ABSTRACT,
    AGGREGATION,
    ASSOCIATION,
    CALLS,
    CLASS,
    COMPOSITION,
    DEPENDENCY,
    FUNCTION,
    INHERITS,
    INSTANCE_OF,
    INTERFACE,
    METACLASS,
    Method,
    Node,
    Reference,
    node_key,
)

EXTENSIONS = (".py",)

# Container types: a class named inside one of these is held as a collection -> aggregation.
_CONTAINERS = frozenset(
    {
        "list", "set", "frozenset", "tuple", "dict", "deque", "List", "Set",
        "FrozenSet", "Tuple", "Dict", "Deque", "Sequence", "MutableSequence",
        "Iterable", "Iterator", "Mapping", "MutableMapping", "Collection",
    }
)
# Typing constructs that wrap a type without changing has-a strength.
_WRAPPERS = frozenset(
    {"Optional", "Union", "Annotated", "Final", "ClassVar", "Type", "type", "Awaitable"}
)
# Names that are never a user class worth an edge.
_NON_TYPES = frozenset(
    {
        "str", "int", "float", "bool", "bytes", "complex", "None", "object",
        "Any", "Callable", "Literal", "Self", "TypeVar",
    }
)
# Bases that only mark abstractness/genericity, not a real parent to draw.
# ``ABCMeta`` is not a marker: only a metaclass derives from it, and that parent is worth drawing.
_MARKER_BASES = frozenset({"object", "ABC", "Generic", "Protocol"})
# Standard-library metaclasses: a class deriving from one of these is itself a metaclass.
_METACLASS_BASES = frozenset({"type", "ABCMeta", "EnumMeta", "EnumType"})
# Methods that return the object they are called on (``torch.nn.Module`` and tensors), so
# ``self.net = Net().to(device)`` still stores the ``Net`` it built. Any other chained call
# may return something else (``Builder().build()``), so it is not seen through.
_RETURNS_SELF = frozenset(
    {"to", "cpu", "cuda", "eval", "train", "float", "half", "double", "bfloat16", "requires_grad_"}
)


def extract(source: str, module: str) -> tuple[list[Node], list[Reference]]:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return [], []
    nodes: list[Node] = []
    refs: list[Reference] = []
    imports = _imports(tree)
    for cls in _iter_classes(tree):
        node, cls_refs = _class(cls, module, source, imports)
        nodes.append(node)
        refs.extend(cls_refs)
    for fn in tree.body:  # module-level functions (not methods) for the call graph
        if isinstance(fn, ast.FunctionDef | ast.AsyncFunctionDef):
            node, fn_refs = _function(fn, module)
            nodes.append(node)
            refs.extend(fn_refs)
    return nodes, refs


def _function(
    fn: ast.FunctionDef | ast.AsyncFunctionDef, module: str
) -> tuple[Node, list[Reference]]:
    """A standalone function node plus a ``calls`` edge for each function it invokes by name."""
    key = node_key(module, fn.name)
    seen: set[str] = set()
    refs: list[Reference] = []
    for sub in ast.walk(fn):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name):
            target = sub.func.id
            if target not in seen and target != fn.name:
                seen.add(target)
                refs.append(Reference(src=key, dst_name=target, kind=CALLS))
    node = Node(
        key=key, name=fn.name, module=module, kind=FUNCTION, doc=ast.get_docstring(fn) or ""
    )
    return node, refs


def _iter_classes(tree: ast.Module) -> list[ast.ClassDef]:
    """Every ``ClassDef`` in the file, including nested ones (they are real types too)."""
    return [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]


def _imports(tree: ast.Module) -> dict[str, str]:
    """Local name -> what it was imported as: ``from torch import nn`` gives ``nn -> torch.nn``.

    Relative imports (``from .x import Y``) are left out: they name this project's own code.
    """
    out: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.asname:
                    out[a.asname] = a.name
                else:  # ``import a.b`` binds ``a``
                    top = a.name.split(".", 1)[0]
                    out[top] = top
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            for a in node.names:
                out[a.asname or a.name] = f"{node.module}.{a.name}"
    return out


def _qualname(expr: ast.expr, imports: dict[str, str]) -> str:
    """The fully qualified name an expression refers to, or "" if it is not imported.

    ``nn.Module`` with ``from torch import nn`` -> ``torch.nn.Module``; a bare builtin class
    such as ``ValueError`` -> ``builtins.ValueError``.
    """
    if isinstance(expr, ast.Name):
        if expr.id in imports:
            return imports[expr.id]
        return f"builtins.{expr.id}" if isinstance(getattr(builtins, expr.id, None), type) else ""
    if isinstance(expr, ast.Attribute):
        root = _qualname(expr.value, imports)
        return f"{root}.{expr.attr}" if root else ""
    if isinstance(expr, ast.Subscript):
        return _qualname(expr.value, imports)
    if isinstance(expr, ast.Call):
        return _qualname(expr.func, imports)
    return ""


def _class(
    cls: ast.ClassDef, module: str, source: str, imports: dict[str, str]
) -> tuple[Node, list[Reference]]:
    key = node_key(module, cls.name)
    base_names = [n for n in (_name_of(b) for b in cls.bases) if n]
    kind = _kind(cls, base_names)

    methods = _methods(cls, source)
    attributes = _attributes(cls)
    refs = _relations(key, cls, base_names, attributes, imports)

    node = Node(
        key=key,
        name=cls.name,
        module=module,
        kind=kind,
        doc=ast.get_docstring(cls) or "",
        attributes=attributes,
        methods=methods,
    )
    return node, refs


def _methods(cls: ast.ClassDef, source: str) -> tuple[Method, ...]:
    """Direct methods of the class, each with its docstring and own source text."""
    out: list[Method] = []
    lines = source.splitlines(keepends=True)
    for m in cls.body:
        if isinstance(m, ast.FunctionDef | ast.AsyncFunctionDef):
            out.append(
                Method(
                    name=m.name,
                    doc=ast.get_docstring(m) or "",
                    source=_method_source(lines, m),
                )
            )
    return tuple(out)


def _method_source(lines: list[str], m: ast.FunctionDef | ast.AsyncFunctionDef) -> str:
    """The method as it reads in the file: decorators included, the class's indent removed."""
    first = min([d.lineno for d in m.decorator_list] + [m.lineno]) - 1
    last = m.end_lineno or m.lineno
    return textwrap.dedent("".join(lines[first:last])).rstrip("\n")


def _relations(
    key: str,
    cls: ast.ClassDef,
    base_names: list[str],
    attributes: tuple[tuple[str, str], ...],
    imports: dict[str, str],
) -> list[Reference]:
    """The six UML relation kinds this class originates, before name resolution.

    Priority composition > aggregation > association: a member the class both constructs
    and type-annotates is ownership, not a peer link. A dependency is a bare construction
    that is none of those; classgraph further keeps it only within the same package.
    """
    agg: set[str] = set()
    assoc: set[str] = set()
    for _name, type_str in attributes:
        for type_name, in_container in _types_in(type_str):
            (agg if in_container else assoc).add(type_name)

    composes, constructs, composed_as = _constructions(cls, imports)
    agg -= composes
    assoc -= composes | agg
    constructs -= composes | agg | assoc

    refs: list[Reference] = [
        Reference(src=key, dst_name=name, kind=INHERITS, qualname=_qualname(expr, imports))
        for expr in cls.bases
        if (name := _name_of(expr)) and name not in _MARKER_BASES
    ]
    meta = _metaclass_keyword(cls)
    meta_name = _name_of(meta) if meta is not None else None
    # ``metaclass=ABCMeta`` already shows as the abstract colour; an edge would only repeat it.
    if meta is not None and meta_name and meta_name != "ABCMeta":
        refs.append(Reference(key, meta_name, INSTANCE_OF, qualname=_qualname(meta, imports)))
    refs += [
        Reference(key, n, COMPOSITION, qualname=composed_as.get(n, "")) for n in sorted(composes)
    ]
    refs += [Reference(key, n, AGGREGATION) for n in sorted(agg)]
    refs += [Reference(key, n, ASSOCIATION) for n in sorted(assoc)]
    refs += [Reference(key, n, DEPENDENCY) for n in sorted(constructs)]
    return refs


def _constructions(
    cls: ast.ClassDef, imports: dict[str, str]
) -> tuple[set[str], set[str], dict[str, str]]:
    """(composes, constructs, composed_as): class-like types instantiated in the class's methods.

    ``composes`` = a construction stored on ``self`` (owned). ``constructs`` = every
    construction, stored or not; the transient ones become dependency candidates.
    ``composed_as`` maps each owned name to its imported qualified name, when it has one.
    """
    composes: set[str] = set()
    constructs: set[str] = set()
    composed_as: dict[str, str] = {}

    def owned(call: ast.Call) -> None:
        name = _name_of(call.func)
        if name:
            composes.add(name)
            q = _qualname(call, imports)
            if q:
                composed_as[name] = q

    for method in cls.body:
        if not isinstance(method, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        for sub in ast.walk(method):
            if isinstance(sub, ast.Call):
                name = _name_of(sub.func)
                if name and _is_ctor_name(name):
                    constructs.add(name)
                for handed in _handed_to_base_init(sub):
                    owned(handed)
            if isinstance(sub, ast.Assign | ast.AnnAssign):
                stored = _stored_construction(sub)
                if stored is not None:
                    owned(stored)
    return composes, constructs, composed_as


def _handed_to_base_init(call: ast.Call) -> list[ast.Call]:
    """Constructions passed to ``super().__init__(...)``.

    The base's initializer keeps its arguments on the same ``self``, so a subclass that
    builds the object it hands over owns it, as if it had stored it itself:
    ``super().__init__(config or Config())``.
    """
    func = call.func
    if not (
        isinstance(func, ast.Attribute)
        and func.attr == "__init__"
        and isinstance(func.value, ast.Call)
        and _name_of(func.value.func) == "super"
    ):
        return []
    args = [*call.args, *(kw.value for kw in call.keywords)]
    return [built for arg in args if (built := _construction(arg)) is not None]


def _stored_construction(node: ast.Assign | ast.AnnAssign) -> ast.Call | None:
    if node.value is None:
        return None
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    if not any(_self_attr_name(t) for t in targets):
        return None
    return _construction(node.value)


def _construction(value: ast.expr) -> ast.Call | None:
    """The constructor call a stored value comes from, or None.

    Besides ``Cls(...)`` itself this sees the default-or-given idioms, where the class still
    builds the object it holds whenever the caller passes none: ``x or Cls()`` and
    ``Cls() if x is None else x``; and calls that hand the same object back, such as
    ``Cls(...).to(device)`` (``_RETURNS_SELF``).
    """
    if isinstance(value, ast.Call):
        return _constructor_call(value)
    branches: list[ast.expr] = []
    if isinstance(value, ast.BoolOp) and isinstance(value.op, ast.Or):
        branches = value.values
    elif isinstance(value, ast.IfExp):
        branches = [value.body, value.orelse]
    for branch in branches:
        call = _construction(branch)
        if call is not None:
            return call
    return None


def _constructor_call(call: ast.Call) -> ast.Call | None:
    """``Cls(...)`` itself, or the ``Cls(...)`` under ``Cls(...).to(device)``; else None."""
    name = _name_of(call.func)
    if name and _is_ctor_name(name):
        return call
    if isinstance(call.func, ast.Attribute) and call.func.attr in _RETURNS_SELF:
        return _construction(call.func.value)
    return None


def _is_ctor_name(name: str) -> bool:
    """A CapWords name that is a plausible class constructor, not a builtin/typing helper."""
    base = name.rsplit(".", 1)[-1]
    return (
        bool(base)
        and base[0].isupper()
        and base not in _NON_TYPES
        and base not in _CONTAINERS
        and base not in _WRAPPERS
    )


def _metaclass_keyword(cls: ast.ClassDef) -> ast.expr | None:
    """The ``M`` expression in ``class X(..., metaclass=M)``, or None when there is none."""
    for kw in cls.keywords:
        if kw.arg == "metaclass":
            return kw.value
    return None


def _kind(cls: ast.ClassDef, base_names: list[str]) -> str:
    if "Protocol" in base_names:
        return INTERFACE
    # Checked before ABSTRACT: ``class M(ABCMeta)`` is a metaclass, not an abstract class.
    if _METACLASS_BASES & set(base_names):
        return METACLASS
    meta = _metaclass_keyword(cls)
    if (
        {"ABC", "ABCMeta"} & set(base_names)
        or (meta is not None and _name_of(meta) == "ABCMeta")
        or _has_abstract_method(cls)
    ):
        return ABSTRACT
    return CLASS


def _has_abstract_method(cls: ast.ClassDef) -> bool:
    for m in cls.body:
        if isinstance(m, ast.FunctionDef | ast.AsyncFunctionDef):
            for dec in m.decorator_list:
                if _name_of(dec) in {"abstractmethod", "abstractproperty"}:
                    return True
    return False


def _attributes(cls: ast.ClassDef) -> tuple[tuple[str, str], ...]:
    """Class-body fields plus ``self.x`` assignments in methods, de-duped by name.

    An annotated declaration wins over a bare assignment for the same name, so a
    later ``self.x = None`` never erases the type from an earlier ``x: Foo``.
    """
    found: dict[str, str] = {}

    def add(name: str, type_str: str) -> None:
        if name not in found or (type_str and not found[name]):
            found[name] = type_str

    _class_body_attrs(cls, add)
    _instance_attrs(cls, add)
    return tuple(found.items())


def _class_body_attrs(cls: ast.ClassDef, add: Callable[[str, str], None]) -> None:
    for stmt in cls.body:
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            add(stmt.target.id, _unparse(stmt.annotation))
        elif isinstance(stmt, ast.Assign):
            for tgt in stmt.targets:
                if isinstance(tgt, ast.Name):
                    add(tgt.id, "")


def _instance_attrs(cls: ast.ClassDef, add: Callable[[str, str], None]) -> None:
    for method in cls.body:
        if isinstance(method, ast.FunctionDef | ast.AsyncFunctionDef):
            for sub in ast.walk(method):
                _self_assign(sub, add)


def _self_assign(sub: ast.AST, add: Callable[[str, str], None]) -> None:
    if isinstance(sub, ast.AnnAssign):
        attr = _self_attr_name(sub.target)
        if attr:
            add(attr, _unparse(sub.annotation))
    elif isinstance(sub, ast.Assign):
        for tgt in sub.targets:
            attr = _self_attr_name(tgt)
            if attr:
                add(attr, "")


def _self_attr_name(target: ast.expr) -> str | None:
    """The ``X`` of a ``self.X`` assignment target, else ``None``."""
    if (
        isinstance(target, ast.Attribute)
        and isinstance(target.value, ast.Name)
        and target.value.id == "self"
    ):
        return target.attr
    return None


def _types_in(annotation: str) -> list[tuple[str, bool]]:
    """Class names referenced by a type annotation, each flagged if inside a container.

    Returns ``(name, in_container)`` pairs. Parses the annotation string back to an
    AST so nested generics (``dict[str, list[Foo]]``) are handled structurally
    rather than by fragile string matching.
    """
    if not annotation:
        return []
    try:
        expr = ast.parse(annotation, mode="eval").body
    except SyntaxError:
        return []
    out: list[tuple[str, bool]] = []
    _walk_annotation(expr, in_container=False, out=out)
    # Preserve first-seen order, drop duplicates.
    seen: set[tuple[str, bool]] = set()
    unique: list[tuple[str, bool]] = []
    for pair in out:
        if pair not in seen:
            seen.add(pair)
            unique.append(pair)
    return unique


def _walk_annotation(node: ast.expr, *, in_container: bool, out: list[tuple[str, bool]]) -> None:
    if isinstance(node, ast.Subscript):
        base = _name_of(node.value)
        if base in _CONTAINERS:
            _walk_slice(node.slice, in_container=True, out=out)
        elif base in _WRAPPERS:
            _walk_slice(node.slice, in_container=in_container, out=out)
        else:  # a user generic like Repository[User]: the base itself is a real type
            _record(base, in_container, out)
            _walk_slice(node.slice, in_container=in_container, out=out)
    elif isinstance(node, ast.BinOp):  # X | Y unions
        _walk_annotation(node.left, in_container=in_container, out=out)
        _walk_annotation(node.right, in_container=in_container, out=out)
    elif isinstance(node, ast.Name | ast.Attribute):
        _record(_name_of(node), in_container, out)


def _walk_slice(node: ast.expr, *, in_container: bool, out: list[tuple[str, bool]]) -> None:
    if isinstance(node, ast.Tuple):
        for elt in node.elts:
            _walk_annotation(elt, in_container=in_container, out=out)
    else:
        _walk_annotation(node, in_container=in_container, out=out)


def _record(name: str | None, in_container: bool, out: list[tuple[str, bool]]) -> None:
    if name and name not in _NON_TYPES and name not in _WRAPPERS and name not in _CONTAINERS:
        out.append((name, in_container))


def _name_of(expr: ast.expr) -> str | None:
    """The simple name an expression denotes: ``Foo`` / ``pkg.Foo`` / ``Foo[T]`` -> ``Foo``."""
    if isinstance(expr, ast.Name):
        return expr.id
    if isinstance(expr, ast.Attribute):
        return expr.attr
    if isinstance(expr, ast.Subscript):
        return _name_of(expr.value)
    if isinstance(expr, ast.Call):
        return _name_of(expr.func)
    return None


def _unparse(node: ast.expr) -> str:
    try:
        return ast.unparse(node)
    except Exception:  # noqa: BLE001 - annotation may be exotic; degrade to no type
        return ""
