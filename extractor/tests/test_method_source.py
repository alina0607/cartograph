"""The source shown when a method is clicked reads as it does in the file: its decorators
included and the class's indent removed, so every line lines up."""

from __future__ import annotations

from cartograph.frontends import python_ast, typescript_ts

PY = '''\
class Model:
    @property
    @functools.cache
    def size(self) -> int:
        """How big."""
        if self.n:
            return 1
        return 0

    def plain(self):
        return 2
'''

TS = """\
class Model {
  @log()
  @trace
  run(x: number): void {
    if (x) {
      return;
    }
  }

  plain(): number {
    return 2;
  }
}
"""


def _sources(extract: object, source: str) -> dict[str, str]:
    nodes, _ = extract(source, "m")  # type: ignore[operator]
    return {m.name: m.source for m in nodes[0].methods}


def test_python_method_source_has_decorators_and_no_class_indent() -> None:
    src = _sources(python_ast.extract, PY)
    assert src["size"] == (
        "@property\n"
        "@functools.cache\n"
        "def size(self) -> int:\n"
        '    """How big."""\n'
        "    if self.n:\n"
        "        return 1\n"
        "    return 0"
    )
    assert src["plain"] == "def plain(self):\n    return 2"


def test_typescript_method_source_has_decorators_and_no_class_indent() -> None:
    src = _sources(typescript_ts.extract, TS)
    assert src["run"] == (
        "@log()\n@trace\nrun(x: number): void {\n  if (x) {\n    return;\n  }\n}"
    )
    assert src["plain"] == "plain(): number {\n  return 2;\n}"


def test_typescript_method_sharing_a_line_keeps_the_bare_span() -> None:
    src = _sources(typescript_ts.extract, "class A { f(): void { g(); } }\n")
    assert src["f"] == "f(): void { g(); }"
