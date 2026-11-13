// Docstring -> safe HTML for the hover tip and the method popup. No DOM, so it is unit-tested.
//
// Understands Google sections (`Args:`, `Returns:` …), NumPy sections (`Parameters` over a line
// of dashes), Markdown-style inline code / bold / italic, bullet lists, fenced code and doctest
// (`>>>`) blocks. Every character of the docstring is escaped first; the only markup in the
// result is the handful of tags added here, so a docstring can never inject HTML.

const SECTIONS: Record<string, string> = {
  args: "Args",
  arguments: "Args",
  parameters: "Args",
  params: "Args",
  "keyword args": "Keyword args",
  "keyword arguments": "Keyword args",
  "other parameters": "Keyword args",
  returns: "Returns",
  return: "Returns",
  yields: "Yields",
  yield: "Yields",
  raises: "Raises",
  exceptions: "Raises",
  attributes: "Attributes",
  example: "Example",
  examples: "Examples",
  note: "Note",
  notes: "Notes",
  warning: "Warning",
  warnings: "Warning",
  "see also": "See also",
  references: "References",
  todo: "Todo",
};
// Sections whose body is a list of `name (type): description` entries.
const ENTRY_SECTIONS = new Set(["Args", "Keyword args", "Raises", "Attributes"]);

const GOOGLE_HEAD = /^(\s*)([A-Za-z][A-Za-z ]*):\s*$/;
const NUMPY_HEAD = /^\s*([A-Za-z][A-Za-z ]*?)\s*$/;
const DASHES = /^\s*-{3,}\s*$/;
// Google `name (type): text`, NumPy `name : type`; also `*args`, `**kwargs`, `Error:`.
const GOOGLE_ENTRY = /^(\*{0,2}[\w.]+)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/;
const NUMPY_ENTRY = /^(\*{0,2}[\w.]+)\s*:\s*(.+)$/;

export function renderDocstring(doc: string): string {
  return renderBlocks(doc.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function dedent(lines: string[]): string[] {
  const widths = lines.filter((l) => l.trim()).map(indentOf);
  const cut = widths.length ? Math.min(...widths) : 0;
  return lines.map((l) => l.slice(Math.min(cut, indentOf(l))));
}

function sectionName(text: string): string | undefined {
  return SECTIONS[text.trim().toLowerCase()];
}

function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    // ``` fenced code ```
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) body.push(lines[i++]!);
      i++; // the closing fence
      out.push(codeBlock(dedent(body)));
      continue;
    }
    // >>> doctest: the prompt lines and their output, up to a blank line
    if (line.trimStart().startsWith(">>>")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim()) body.push(lines[i++]!);
      out.push(codeBlock(dedent(body)));
      continue;
    }
    // NumPy section: a name, then a line of dashes; the body runs to the next such header
    const numpy = NUMPY_HEAD.exec(line);
    if (numpy && i + 1 < lines.length && DASHES.test(lines[i + 1]!) && sectionName(numpy[1]!)) {
      const title = sectionName(numpy[1]!)!;
      i += 2;
      const body: string[] = [];
      while (i < lines.length && !isNumpyHead(lines, i)) body.push(lines[i++]!);
      out.push(section(title, dedent(body), NUMPY_ENTRY));
      continue;
    }
    // Google section: `Name:` alone on a line; the body is everything indented under it
    const google = GOOGLE_HEAD.exec(line);
    if (google && sectionName(google[2]!)) {
      const head = google[1]!.length;
      i++;
      const body: string[] = [];
      while (i < lines.length && (!lines[i]!.trim() || indentOf(lines[i]!) > head)) {
        body.push(lines[i++]!);
      }
      out.push(section(sectionName(google[2]!)!, dedent(body), GOOGLE_ENTRY));
      continue;
    }
    // - bullet list (an item continues on more-indented lines)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim()) {
        const l = lines[i]!;
        if (/^\s*[-*]\s+/.test(l)) items.push(l.replace(/^\s*[-*]\s+/, ""));
        else items[items.length - 1] += " " + l.trim();
        i++;
      }
      out.push(`<ul>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ul>`);
      continue;
    }
    // a paragraph: consecutive lines up to a blank line or the start of another block
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !(para.length && startsBlock(lines, i))) {
      para.push(lines[i++]!.trim());
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return out.join("");
}

function isNumpyHead(lines: string[], i: number): boolean {
  const m = NUMPY_HEAD.exec(lines[i]!);
  return !!m && i + 1 < lines.length && DASHES.test(lines[i + 1]!) && !!sectionName(m[1]!);
}

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i]!;
  const google = GOOGLE_HEAD.exec(l);
  return (
    l.trim().startsWith("```") ||
    l.trimStart().startsWith(">>>") ||
    /^\s*[-*]\s+/.test(l) ||
    isNumpyHead(lines, i) ||
    (!!google && !!sectionName(google[2]!))
  );
}

function section(title: string, body: string[], entry: RegExp): string {
  const head = `<div class="ds-sec">${escapeHtml(title)}</div>`;
  if (!ENTRY_SECTIONS.has(title)) return head + renderBlocks(body);
  // Entries start at the body's own indent; deeper lines continue the entry above.
  const items: { name: string; type: string; text: string }[] = [];
  const loose: string[] = [];
  for (const l of body) {
    if (!l.trim()) continue;
    const m = indentOf(l) === 0 ? entry.exec(l) : null;
    if (m) {
      // Google: name, (type), text. NumPy: name, type; its text is on the indented lines.
      const numpy = entry === NUMPY_ENTRY;
      items.push({ name: m[1]!, type: m[2] ?? "", text: numpy ? "" : (m[3] ?? "") });
    } else if (items.length) {
      const last = items[items.length - 1]!;
      last.text = (last.text ? last.text + " " : "") + l.trim();
    } else {
      loose.push(l);
    }
  }
  const dl = items.length
    ? `<dl>${items
        .map(
          (it) =>
            `<dt><code>${escapeHtml(it.name)}</code>` +
            (it.type ? ` <span class="ds-type">${inline(it.type)}</span>` : "") +
            `</dt><dd>${inline(it.text)}</dd>`,
        )
        .join("")}</dl>`
    : "";
  return head + renderBlocks(loose) + dl;
}

function codeBlock(lines: string[]): string {
  return `<pre><code>${escapeHtml(lines.join("\n"))}</code></pre>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Inline markup on one escaped line: code spans first, so nothing inside them is touched.
function inline(text: string): string {
  const parts = text.split(/(``[^`]+``|`[^`]+`)/);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return `<code>${escapeHtml(part.replace(/^`+|`+$/g, ""))}</code>`;
      return escapeHtml(part)
        .replace(/\*\*([^*\s][^*]*?)\*\*/g, "<strong>$1</strong>")
        .replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:)!?]|$)/g, "$1<em>$2</em>");
    })
    .join("");
}
