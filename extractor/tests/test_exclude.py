"""``--exclude`` patterns: which files a scan skips."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from cartograph.build import build_seed, is_excluded
from cartograph.cli import main


@pytest.mark.parametrize(
    ("rel", "patterns", "expected"),
    [
        ("tests/test_a.py", ["tests"], True),
        ("pkg/tests/test_a.py", ["tests"], True),  # no slash: any component
        ("pkg/tests/test_a.py", ["tests/*"], False),  # slash: anchored at the root
        ("tests/test_a.py", ["tests/*"], True),
        ("pkg/a_demo.py", ["*_demo.py"], True),
        ("pkg/core.py", ["tests", "*_demo.py"], False),
        ("tests_util.py", ["tests"], False),  # whole components only
        ("pkg/core.py", [], False),
    ],
)
def test_is_excluded(rel: str, patterns: list[str], expected: bool) -> None:
    assert is_excluded(rel, patterns) is expected


def _project(tmp_path: Path) -> Path:
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "core.py").write_text("class Core:\n    pass\n")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_core.py").write_text(
        "from pkg.core import Core\n\nclass FakeCore(Core):\n    pass\n"
    )
    return tmp_path


def test_scan_skips_excluded_directories(tmp_path: Path) -> None:
    root = _project(tmp_path)
    assert {n.name for n in build_seed(root).nodes} == {"Core", "FakeCore"}
    assert {n.name for n in build_seed(root, exclude=["tests"]).nodes} == {"Core"}


def test_cli_exclude_is_repeatable(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    root = _project(tmp_path)
    (root / "pkg" / "a_demo.py").write_text("class Demo:\n    pass\n")
    assert main([str(root), "--exclude", "tests", "--exclude", "*_demo.py"]) == 0
    names = {n["name"] for n in json.loads(capsys.readouterr().out)["nodes"]}
    assert names == {"Core"}
