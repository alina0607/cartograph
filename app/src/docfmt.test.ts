import { describe, expect, it } from "vitest";
import { renderDocstring } from "./docfmt";

describe("renderDocstring", () => {
  it("renders a Google-style docstring: summary, sections, entries", () => {
    const html = renderDocstring(
      [
        "Record how long each call takes.",
        "",
        "Calls that raise are not recorded.",
        "",
        "Args:",
        "    func (Callable): The function to wrap. It may take",
        "        any arguments.",
        "    *args: Passed through.",
        "",
        "Returns:",
        "    A wrapper that adds one entry to the active `RunLog`.",
        "",
        "Raises:",
        "    RuntimeError: If no run is active.",
      ].join("\n"),
    );
    expect(html).toBe(
      "<p>Record how long each call takes.</p>" +
        "<p>Calls that raise are not recorded.</p>" +
        '<div class="ds-sec">Args</div><dl>' +
        '<dt><code>func</code> <span class="ds-type">Callable</span></dt>' +
        "<dd>The function to wrap. It may take any arguments.</dd>" +
        "<dt><code>*args</code></dt><dd>Passed through.</dd></dl>" +
        '<div class="ds-sec">Returns</div>' +
        "<p>A wrapper that adds one entry to the active <code>RunLog</code>.</p>" +
        '<div class="ds-sec">Raises</div>' +
        "<dl><dt><code>RuntimeError</code></dt><dd>If no run is active.</dd></dl>",
    );
  });

  it("renders NumPy sections (a name over a line of dashes)", () => {
    const html = renderDocstring(
      [
        "Sum two numbers.",
        "",
        "Parameters",
        "----------",
        "a : int",
        "    The first.",
        "",
        "Returns",
        "-------",
        "int",
      ].join("\n"),
    );
    expect(html).toBe(
      "<p>Sum two numbers.</p>" +
        '<div class="ds-sec">Args</div><dl>' +
        '<dt><code>a</code> <span class="ds-type">int</span></dt><dd>The first.</dd></dl>' +
        '<div class="ds-sec">Returns</div><p>int</p>',
    );
  });

  it("keeps doctest and fenced code as code blocks", () => {
    expect(renderDocstring("Use it:\n\n>>> add(1, 2)\n3")).toBe(
      "<p>Use it:</p><pre><code>&gt;&gt;&gt; add(1, 2)\n3</code></pre>",
    );
    expect(renderDocstring("```\nx = 1\n```")).toBe("<pre><code>x = 1</code></pre>");
  });

  it("formats inline code (single and double backticks), bold, italic and bullets", () => {
    expect(renderDocstring("Use `fit` or ``evaluate``, **not** *this*.\n\n- one\n- two")).toBe(
      "<p>Use <code>fit</code> or <code>evaluate</code>, <strong>not</strong> <em>this</em>.</p>" +
        "<ul><li>one</li><li>two</li></ul>",
    );
  });

  it("escapes everything in the docstring, so it cannot inject markup", () => {
    const html = renderDocstring('Bad <script>alert(1)</script> and `<b>x</b>` & "q"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<code>&lt;b&gt;x&lt;/b&gt;</code>");
  });

  it("leaves a plain docstring as paragraphs, joining wrapped lines", () => {
    expect(renderDocstring("One line\nwrapped.\n\nSecond paragraph.")).toBe(
      "<p>One line wrapped.</p><p>Second paragraph.</p>",
    );
  });
});
