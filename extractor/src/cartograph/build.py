"""Walk a path, run each file through its frontend, and assemble the seed.

The module path stored on every node is relative to the scanned root and uses
forward slashes, so a board is portable across machines and the node key
(``module#Name``) is stable regardless of where the project lives on disk.
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from cartograph import classgraph
from cartograph.frontends import registry
from cartograph.model import Node, Reference, Seed

# Directories that never hold source worth charting.
_SKIP_DIRS = frozenset(
    {".git", ".venv", "venv", "node_modules", "__pycache__", ".mypy_cache",
     ".ruff_cache", ".pytest_cache", "dist", "build", ".tox"}
)

# File extension -> language label, stamped on every node so resolution can stay
# within a language and cross-language links can be found between languages.
_LANG_OF = {
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".go": "go",
}


def build_seed(root: Path) -> Seed:
    root = root.resolve()
    # For a single-file scan the module name is just the filename; for a directory
    # it is the path relative to that directory.
    base = root.parent if root.is_file() else root
    nodes: list[Node] = []
    refs: list[Reference] = []
    for path in _iter_source_files(root):
        extractor = registry.frontend_for(path.suffix)
        if extractor is None:
            continue
        module = _module_path(path, base)
        try:
            source = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        file_nodes, file_refs = extractor(source, module)
        lang = _LANG_OF.get(path.suffix, "")
        nodes.extend(replace(n, lang=lang) for n in file_nodes)
        refs.extend(file_refs)

    nodes.sort(key=lambda n: n.key)
    relations = classgraph.resolve(nodes, refs)
    nodes = classgraph.mark_metaclasses(nodes, relations)
    return Seed(version=1, nodes=tuple(nodes), relations=relations)


def _iter_source_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root]
    exts = registry.supported_extensions()
    out: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in exts:
            continue
        if _SKIP_DIRS & set(path.relative_to(root).parts):
            continue
        out.append(path)
    return out


def _module_path(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()
