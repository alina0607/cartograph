import { describe, expect, it } from "vitest";
import { highlightCode } from "./highlight";

// The spans a piece of source gets, as [kind, text] pairs (plain text left out).
function spans(html: string): [string, string][] {
  return [...html.matchAll(/<span class="hl-(\w+)">([\s\S]*?)<\/span>/g)].map((m) => [
    m[1]!,
    unescape(m[2]!),
  ]);
}

function unescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

describe("highlightCode: Python", () => {
  const src = [
    "@functools.wraps(func)",
    "def __init__(self, n: int = 3) -> None:",
    '    """Make one.',
    "",
    "    Args:",
    '        n: How many."""',
    "    # keep it short",
    "    total = len(range(n)) + 0x1F  # trailing",
    "    self.name = f'{n}'",
    "    return dict(a=1, b=total == 2)",
  ].join("\n");
  const got = spans(highlightCode(src, "python"));

  it("colours each token like the editor", () => {
    expect(got).toEqual([
      ["deco", "@functools.wraps"],
      ["kw", "def"],
      ["dunder", "__init__"],
      ["self", "self"],
      ["bi", "int"],
      ["num", "3"],
      ["kw", "None"],
      ["doc", '"""Make one.\n\n    Args:\n        n: How many."""'],
      ["com", "# keep it short"],
      ["bi", "len"],
      ["bi", "range"],
      ["num", "0x1F"],
      ["com", "# trailing"],
      ["self", "self"],
      ["str", "f'{n}'"],
      ["kw", "return"],
      ["bi", "dict"],
      ["kwarg", "a"],
      ["num", "1"],
      ["kwarg", "b"],
      ["num", "2"],
    ]);
  });

  it("does not take a parameter default or `==` for a keyword argument", () => {
    expect(got.filter(([k]) => k === "kwarg").map(([, t]) => t)).toEqual(["a", "b"]);
  });

  it("names an ordinary def with the function colour", () => {
    expect(spans(highlightCode("def fit(x):\n    return x", "python"))[1]).toEqual(["fn", "fit"]);
  });

  it("treats a string that is not the first statement as a plain string", () => {
    expect(spans(highlightCode('def f():\n    x = 1\n    "not a doc"', "python")).at(-1)).toEqual([
      "str",
      '"not a doc"',
    ]);
  });

  it("escapes the source", () => {
    const html = highlightCode('x = "<script>"  # </span>', "python");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;/span&gt;");
  });

  it("gives back exactly the source text", () => {
    expect(unescape(highlightCode(src, "python").replace(/<[^>]+>/g, ""))).toBe(src);
  });
});

describe("highlightCode: TypeScript and Go", () => {
  it("TypeScript: doc comment, keywords, the declared name, strings", () => {
    const src =
      "/** Load it. */\nasync load(path: string): Promise<void> {\n  // go\n  return `x`;\n}";
    expect(spans(highlightCode(src, "typescript", "load"))).toEqual([
      ["com", "/** Load it. */"],
      ["kw", "async"],
      ["fn", "load"],
      ["kw", "string"],
      ["kw", "void"],
      ["com", "// go"],
      ["kw", "return"],
      ["str", "`x`"],
    ]);
  });

  it("Go: keywords, builtins, numbers", () => {
    const src = "func (s *Store) Len() int {\n\treturn len(s.items) + 1 // n\n}";
    expect(spans(highlightCode(src, "go", "Len"))).toEqual([
      ["kw", "func"],
      ["fn", "Len"],
      ["kw", "int"],
      ["kw", "return"],
      ["bi", "len"],
      ["num", "1"],
      ["com", "// n"],
    ]);
  });
});
