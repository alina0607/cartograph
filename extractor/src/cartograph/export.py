"""Pour a seed into the bundled single-file viewer: a board that opens anywhere.

``viewer.html`` is the app's own ``npm run build:viewer`` output, copied into this
package so exporting needs no Node. It is the same page the app's **export html**
button fills, so a board exported here cannot drift from the live canvas.
"""

from __future__ import annotations

import hashlib
import json
import re
from importlib.resources import files
from pathlib import Path
from typing import Any

_SLOT = re.compile(r'(<script id="cartograph-doc" type="application/json">)(.*?)(</script>)', re.S)

# The files ``build-viewer.mjs`` hashes besides everything under ``app/src``.
SOURCE_FILES = ("index.html", "package-lock.json", "vite.config.ts", "scripts/build-viewer.mjs")


def empty_overlay() -> dict[str, Any]:
    """The hand-made layer of a board nobody has arranged yet (``emptyOverlay`` in the app)."""
    return {"boxes": {}, "edges": {}, "collapsed": {}, "notes": [], "images": [], "groups": [],
            "docNotes": {}}


def viewer_template() -> str:
    return files("cartograph").joinpath("viewer.html").read_text(encoding="utf-8")


def export_html(seed: dict[str, Any], scope: str) -> str:
    """Return a self-contained HTML page showing ``seed`` with the app's default layout."""
    doc = {"version": 1, "scope": scope, "seed": seed, "overlay": empty_overlay()}
    # ``<`` escaped: a docstring or method source may contain ``</script>``.
    payload = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    filled, n = _SLOT.subn(lambda m: m.group(1) + payload + m.group(3), viewer_template(), count=1)
    if n != 1:
        raise RuntimeError("bundled viewer.html has no document slot; run `npm run build:viewer`")
    return filled


def app_sources_hash(app_dir: Path) -> str:
    """The hash ``build-viewer.mjs`` records: sha256 over path, NUL, bytes, NUL per file."""
    rels = list(SOURCE_FILES)
    rels += [p.relative_to(app_dir).as_posix() for p in (app_dir / "src").rglob("*") if p.is_file()]
    digest = hashlib.sha256()
    for rel in sorted(rels):
        digest.update(rel.encode() + b"\0")
        digest.update((app_dir / rel).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()
