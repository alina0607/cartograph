// Source -> HTML with JetBrains-style colour classes (`hl-*`, styled in index.html like PyCharm's
// default light theme). A small hand-written lexer per language, no dependency: the popup only
// needs to look like the editor, not to parse. Every character is escaped; the only markup added
// is `<span class="hl-…">`.

import { escapeHtml } from "./docfmt";

type Kind =
  | "kw" // keyword
  | "str" // string literal
  | "doc" // docstring / doc comment
  | "com" // comment
  | "num" // number
  | "deco" // decorator
  | "fn" // the declared function's name
  | "self" // self / cls
  | "bi" // builtin name
  | "dunder" // __magic__
  | "kwarg" // keyword argument at a call site: f(x=1)
  | "";

interface Token {
  text: string;
  kind: Kind;
}

const PY_KW = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except " +
    "finally for from global if import in is lambda nonlocal not or pass raise return try while " +
    "with yield"
  ).split(" "),
);
const PY_BUILTINS = new Set(
  (
    "abs all any bool bytearray bytes callable chr classmethod dict dir divmod enumerate filter " +
    "float format frozenset getattr hasattr hash id input int isinstance issubclass iter len list " +
    "map max min next object open ord pow print property range repr reversed round set setattr " +
    "slice sorted staticmethod str sum super tuple type vars zip NotImplemented Ellipsis " +
    "Exception BaseException ValueError TypeError KeyError IndexError RuntimeError " +
    "AttributeError StopIteration NotImplementedError OSError ImportError LookupError " +
    "ZeroDivisionError AssertionError FileNotFoundError"
  ).split(" "),
);
const TS_KW = new Set(
  (
    "abstract any as async await boolean break case catch class const continue declare default " +
    "delete do else enum export extends false finally for from function get if implements import " +
    "in instanceof interface keyof let never new null number of private protected public readonly " +
    "return set static string super switch this throw true try type typeof undefined unknown var " +
    "void while yield"
  ).split(" "),
);
const GO_KW = new Set(
  (
    "break case chan const continue default defer else fallthrough for func go goto if import " +
    "interface map package range return select struct switch type var true false nil iota bool " +
    "byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint " +
    "uint8 uint16 uint32 uint64 uintptr any"
  ).split(" "),
);
const GO_BUILTINS = new Set(
  "append cap clear close complex copy delete imag len make max min new panic print println real recover".split(
    " ",
  ),
);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*/;
const NUMBER =
  /^(?:0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJn]?)/;

/**
 * The source without its docstring, for when the popup already shows the docstring above it.
 * The docstring's own lines go, and so does one blank line after it. Only Python keeps the
 * docstring inside the method; TypeScript and Go put it in a comment before, outside the source.
 */
export function withoutDocstring(source: string, lang: string): string {
  if (lang !== "python") return source;
  let at = 0;
  for (const t of lexPython(source)) {
    if (t.kind === "doc") {
      const start = source.lastIndexOf("\n", at - 1) + 1; // the docstring's line
      let end = at + t.text.length;
      if (source.slice(start, at).trim()) return source; // code before it on the line: keep it
      const eol = source.indexOf("\n", end);
      if (source.slice(end, eol < 0 ? undefined : eol).trim()) return source; // code after it
      end = eol < 0 ? source.length : eol + 1;
      const next = source.indexOf("\n", end);
      if (next >= 0 && !source.slice(end, next).trim()) end = next + 1; // one blank line after
      return (source.slice(0, start) + source.slice(end)).replace(/\n+$/, "");
    }
    at += t.text.length;
  }
  return source;
}

/** `name` is the method being shown: its declaration is coloured like the editor's. */
export function highlightCode(source: string, lang: string, name = ""): string {
  const tokens = lang === "python" ? lexPython(source) : lexCLike(source, lang, name);
  return tokens
    .map((t) =>
      t.kind ? `<span class="hl-${t.kind}">${escapeHtml(t.text)}</span>` : escapeHtml(t.text),
    )
    .join("");
}

function lexPython(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let lineStart = true; // only whitespace so far on this line
  let header: "def" | "class" | null = null; // inside a `def …:` / `class …:` line
  let expectDoc = src.trimStart().startsWith('"') || src.trimStart().startsWith("'");
  let nameNext = false; // the identifier right after `def` / `class`
  const depth: boolean[] = []; // per open bracket: is it a def's parameter list?
  const push = (text: string, kind: Kind) => out.push({ text, kind });

  while (i < src.length) {
    const rest = src.slice(i);
    const c = src[i]!;
    if (c === "\n") {
      push(c, "");
      i++;
      lineStart = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\\") {
      const m = /^[ \t\\]+/.exec(rest)![0];
      push(m, "");
      i += m.length;
      continue;
    }
    if (c === "#") {
      const m = /^#[^\n]*/.exec(rest)![0];
      push(m, "com");
      i += m.length;
      continue;
    }
    const str = /^([rRbBuUfF]{0,2})("""|'''|"|')/.exec(rest);
    if (str) {
      const quote = str[2]!;
      let j = str[0].length;
      while (j < rest.length && !rest.startsWith(quote, j)) {
        if (rest[j] === "\\") j++;
        else if (quote.length === 1 && rest[j] === "\n") break; // unterminated: stop at the line
        j++;
      }
      j = Math.min(rest.length, j + (rest.startsWith(quote, j) ? quote.length : 0));
      const text = rest.slice(0, j);
      push(text, expectDoc && lineStart ? "doc" : "str");
      expectDoc = false;
      lineStart = false;
      i += j;
      continue;
    }
    if (c === "@" && lineStart) {
      const m = /^@[A-Za-z_][\w.]*/.exec(rest);
      if (m) {
        push(m[0], "deco");
        i += m[0].length;
        lineStart = false;
        continue;
      }
    }
    const num = /[0-9.]/.test(c) ? NUMBER.exec(rest) : null;
    if (num && num[0] !== ".") {
      push(num[0], "num");
      i += num[0].length;
      lineStart = false;
      expectDoc = false;
      continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      const w = id[0];
      let kind: Kind = "";
      if (nameNext) {
        kind = header === "def" ? (/^__\w+__$/.test(w) ? "dunder" : "fn") : "";
        nameNext = false;
      } else if (PY_KW.has(w)) {
        kind = "kw";
        if (w === "def" || w === "class") {
          header = w;
          nameNext = true;
        }
      } else if (w === "self" || w === "cls") kind = "self";
      else if (/^__\w+__$/.test(w)) kind = "dunder";
      else if (out.length && out[out.length - 1]!.text === ".") kind = "";
      else if (PY_BUILTINS.has(w)) kind = "bi";
      else if (
        depth.length &&
        !depth[depth.length - 1] &&
        /^\s*=(?!=)/.test(src.slice(i + w.length))
      )
        kind = "kwarg";
      push(w, kind);
      i += w.length;
      lineStart = false;
      expectDoc = false;
      continue;
    }
    // punctuation
    if ("([{".includes(c)) depth.push(header === "def" && depth.length === 0);
    else if (")]}".includes(c)) depth.pop();
    else if (c === ":" && header && depth.length === 0) {
      header = null;
      expectDoc = true; // the body's first statement may be its docstring
      push(c, "");
      i++;
      lineStart = false;
      continue;
    }
    push(c, "");
    i++;
    lineStart = false;
    if (c !== ":") expectDoc = false;
  }
  return merge(out);
}

// TypeScript and Go: `//` and `/* */` comments, `/** */` doc comments, quotes and backticks.
function lexCLike(src: string, lang: string, name: string): Token[] {
  const kws = lang === "go" ? GO_KW : TS_KW;
  const builtins = lang === "go" ? GO_BUILTINS : new Set<string>();
  const out: Token[] = [];
  let i = 0;
  let declared = false; // the first `name` is the declaration
  while (i < src.length) {
    const rest = src.slice(i);
    const c = src[i]!;
    let m: RegExpExecArray | null;
    if ((m = /^\/\/[^\n]*/.exec(rest))) out.push({ text: m[0], kind: "com" });
    else if ((m = /^\/\*[\s\S]*?(?:\*\/|$)/.exec(rest))) out.push({ text: m[0], kind: "com" });
    else if (c === '"' || c === "'" || c === "`") {
      let j = 1;
      while (j < rest.length && rest[j] !== c) {
        if (rest[j] === "\\" && c !== "`") j++;
        else if (c !== "`" && rest[j] === "\n") break;
        j++;
      }
      const text = rest.slice(0, Math.min(rest.length, j + 1));
      out.push({ text, kind: "str" });
      i += text.length;
      continue;
    } else if (c === "@" && (m = /^@[A-Za-z_][\w.]*/.exec(rest)))
      out.push({ text: m[0], kind: "deco" });
    else if (/[0-9]/.test(c) && (m = NUMBER.exec(rest))) out.push({ text: m[0], kind: "num" });
    else if ((m = IDENT.exec(rest))) {
      const w = m[0];
      const afterDot = out.length > 0 && out[out.length - 1]!.text === ".";
      let kind: Kind = "";
      if (!declared && w === name) {
        kind = "fn";
        declared = true;
      } else if (kws.has(w) && !afterDot) kind = "kw";
      else if (builtins.has(w) && !afterDot) kind = "bi";
      out.push({ text: w, kind });
    } else {
      out.push({ text: c, kind: "" });
      i++;
      continue;
    }
    i += m[0].length;
  }
  return merge(out);
}

// Adjacent plain tokens become one, so the HTML is not a span per character.
function merge(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (const t of tokens) {
    const last = out[out.length - 1];
    if (last && last.kind === t.kind && t.kind === "") last.text += t.text;
    else out.push({ ...t });
  }
  return out;
}
