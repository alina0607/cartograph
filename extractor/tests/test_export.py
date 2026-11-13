"""``--html``: a seed poured into the bundled viewer."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from cartograph.cli import main
from cartograph.export import app_sources_hash, empty_overlay, export_html, viewer_template

APP = Path(__file__).resolve().parents[2] / "app"
PKG = Path(__file__).resolve().parents[1] / "src" / "cartograph"
SLOT = re.compile(r'<script id="cartograph-doc" type="application/json">(.*?)</script>', re.S)

SEED = {"version": 1, "nodes": [], "relations": []}


def _embedded(html: str) -> dict[str, object]:
    found = SLOT.findall(html)
    assert len(found) == 1
    doc: dict[str, object] = json.loads(found[0])
    return doc


def test_template_has_exactly_one_empty_slot() -> None:
    assert SLOT.findall(viewer_template()) == ["null"]


def test_export_embeds_the_document_the_app_loads() -> None:
    doc = _embedded(export_html(SEED, "myproj"))
    assert doc == {"version": 1, "scope": "myproj", "seed": SEED, "overlay": empty_overlay()}


def test_closing_script_tag_in_source_cannot_end_the_slot_early() -> None:
    seed = {"version": 1, "relations": [], "nodes": [{"doc": "ends with </script> here"}]}
    html = export_html(seed, "p")
    assert "</script> here" not in html
    assert _embedded(html)["seed"] == seed


def test_cli_writes_seed_and_board(tmp_path: Path) -> None:
    (tmp_path / "proj").mkdir()
    (tmp_path / "proj" / "core.py").write_text("class Core:\n    pass\n")
    seed_file, board = tmp_path / "seed.json", tmp_path / "board.html"
    assert main([str(tmp_path / "proj"), "-o", str(seed_file), "--html", str(board)]) == 0
    doc = _embedded(board.read_text(encoding="utf-8"))
    assert doc["scope"] == "proj"
    assert doc["seed"] == json.loads(seed_file.read_text(encoding="utf-8"))


@pytest.mark.skipif(not APP.is_dir(), reason="needs the app sources next to the extractor")
def test_bundled_viewer_was_built_from_the_current_app() -> None:
    recorded = (PKG / "viewer.sources.sha256").read_text().strip()
    assert recorded == app_sources_hash(APP), (
        "app sources changed since viewer.html was bundled: run `npm run build:viewer` in app/"
    )
