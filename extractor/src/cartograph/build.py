"""Walk a path, run each file through its frontend, and assemble the seed.

The module path stored on every node is relative to the scanned root and uses
forward slashes, so a board is portable across machines and the node key
(``module#Name``) is stable regardless of where the project lives on disk.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
from fnmatch import fnmatchcase
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


def build_seed(root: Path, exclude: Iterable[str] = ()) -> Seed:
    """Scan ``root`` (a file or a directory) into a seed.

    ``exclude`` holds glob patterns; see ``is_excluded`` for how they match.
    """
    root = root.resolve()
    # For a single-file scan the module name is just the filename; for a directory
    # it is the path relative to that directory.
    base = root.parent if root.is_file() else root
    nodes: list[Node] = []
    refs: list[Reference] = []
    for path in _iter_source_files(root, tuple(exclude)):
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
    # Scanning a package folder itself (``recsys/``) leaves its own imports (``recsys.x``)
    # unresolved; its name marks them as this project's code, not a library.
    own = frozenset({base.name if root.is_file() else root.name})
    relations = classgraph.resolve(nodes, refs, own)
    nodes = classgraph.mark_metaclasses(nodes, relations)
    nodes += classgraph.external_nodes(nodes, relations)
    return Seed(version=1, nodes=tuple(nodes), relations=relations)


def is_excluded(rel: str, patterns: Iterable[str]) -> bool:
    """Whether the posix path ``rel`` (relative to the scanned root) is excluded.

    A pattern without ``/`` matches any single path component, so ``tests`` drops
    every ``tests`` directory and ``*_demo.py`` every such file. A pattern with
    ``/`` matches from the root: ``app/tests`` drops only that directory.
    """
    parts = rel.split("/")
    for pattern in patterns:
        if "/" in pattern.strip("/"):
            prefixes = ("/".join(parts[: i + 1]) for i in range(len(parts)))
            if any(fnmatchcase(p, pattern.strip("/")) for p in prefixes):
                return True
        elif any(fnmatchcase(part, pattern.strip("/")) for part in parts):
            return True
    return False


def _iter_source_files(root: Path, exclude: tuple[str, ...] = ()) -> list[Path]:
    if root.is_file():
        return [root]
    exts = registry.supported_extensions()
    out: list[Path] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix not in exts:
            continue
        rel = path.relative_to(root)
        if _SKIP_DIRS & set(rel.parts) or is_excluded(rel.as_posix(), exclude):
            continue
        out.append(path)
    return out


def _module_path(path: Path, base: Path) -> str:
    return path.relative_to(base).as_posix()
